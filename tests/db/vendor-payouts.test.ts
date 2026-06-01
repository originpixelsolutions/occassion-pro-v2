import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params);
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
const PW = '$argon2id$v=19$m=65536,t=3,p=4$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);
async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`,
      [slug],
    )
  ).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenant: string, code = 'evt-001'): Promise<string> {
  const ty = (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'W', FALSE) RETURNING id`,
      [tenant],
    )
  ).rows[0]!.id;
  return (
    await db.query<{ id: string }>(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`,
      [tenant, ty, code],
    )
  ).rows[0]!.id;
}
async function mkVendor(db: TestDb, email: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO vendor_accounts (email, password_hash) VALUES ($1,$2) RETURNING id`,
      [email, PW],
    )
  ).rows[0]!.id;
}
async function mkAssignment(db: TestDb, t: string, e: string, v: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category)
     VALUES ($1,$2,$3,'catering') RETURNING id`,
      [v, t, e],
    )
  ).rows[0]!.id;
}
async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1,$2,'M','event_manager') RETURNING id`,
      [tenant, email],
    )
  ).rows[0]!.id;
}

describe('vendor_payouts — schema correctness (Phase 6 Unit 47)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid scheduled payout', async () => {
    const t = await mkTenant(db, 'vpo-aaa');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v1@y.dev');
    const a = await mkAssignment(db, t, e, v);
    await db.query(
      `INSERT INTO vendor_payouts (tenant_id, event_id, vendor_account_id, assignment_id, milestone, milestone_type, amount, currency_code, scheduled_for, bank_account_last4, ifsc_code)
       VALUES ($1,$2,$3,$4,'50% booking advance','booking_advance', 125000, 'INR', now()+interval '3 days', '1234', 'HDFC0000123')`,
      [t, e, v, a],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_payouts`)).rows[0]!.c,
    ).toBe(1);
  });

  it('amount > 0 enforced', async () => {
    const t = await mkTenant(db, 'vpo-bbb');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_payouts (tenant_id, milestone, amount, currency_code) VALUES ($1,'X', 0, 'INR')`,
      [t],
    );
    expect(err).toMatch(/amount_positive|check/i);
  });

  it('rejects bad ifsc_code', async () => {
    const t = await mkTenant(db, 'vpo-ccc');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_payouts (tenant_id, milestone, amount, currency_code, ifsc_code) VALUES ($1,'X', 100, 'INR','BAD123')`,
      [t],
    );
    expect(err).toMatch(/ifsc|check/i);
  });

  it('rejects bad bank_account_last4', async () => {
    const t = await mkTenant(db, 'vpo-ddd');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_payouts (tenant_id, milestone, amount, currency_code, bank_account_last4) VALUES ($1,'X', 100, 'INR','12')`,
      [t],
    );
    expect(err).toMatch(/bank_account_last4|check/i);
  });

  it('rejects bad gateway', async () => {
    const t = await mkTenant(db, 'vpo-eee');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_payouts (tenant_id, milestone, amount, currency_code, gateway) VALUES ($1,'X', 100, 'INR','crypto')`,
      [t],
    );
    expect(err).toMatch(/gateway|check/i);
  });

  it('approved requires approver + approved_at', async () => {
    const t = await mkTenant(db, 'vpo-fff');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_payouts (tenant_id, milestone, amount, currency_code, status) VALUES ($1,'X', 100, 'INR','approved')`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('disbursing requires gateway selection', async () => {
    const t = await mkTenant(db, 'vpo-ggg');
    const m = await mkMember(db, t, 'm@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_payouts (tenant_id, milestone, amount, currency_code, status, approved_at, approved_by)
       VALUES ($1,'X', 100, 'INR','disbursing', now(), $2)`,
      [t, m],
    );
    expect(err).toMatch(/check/i);
  });

  it('disbursed requires approval + disbursed_at + gateway', async () => {
    const t = await mkTenant(db, 'vpo-hhh');
    const m = await mkMember(db, t, 'm@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_payouts (tenant_id, milestone, amount, currency_code, status, approved_at, approved_by, disbursed_at)
       VALUES ($1,'X', 100, 'INR','disbursed', now(), $2, now())`,
      [t, m],
    );
    expect(err).toMatch(/check/i);
  });

  it('failed requires failure_reason', async () => {
    const t = await mkTenant(db, 'vpo-iii');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_payouts (tenant_id, milestone, amount, currency_code, status, failed_at)
       VALUES ($1,'X', 100, 'INR','failed', now())`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('UNIQUE (gateway, gateway_payout_id) blocks dupe', async () => {
    const t = await mkTenant(db, 'vpo-jjj');
    await db.query(
      `INSERT INTO vendor_payouts (tenant_id, milestone, amount, currency_code, gateway, gateway_payout_id)
       VALUES ($1,'X', 100, 'INR','razorpay_x','pyt_R1')`,
      [t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO vendor_payouts (tenant_id, milestone, amount, currency_code, gateway, gateway_payout_id)
       VALUES ($1,'Y', 100, 'INR','razorpay_x','pyt_R1')`,
      [t],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('net_amount generated column', async () => {
    const t = await mkTenant(db, 'vpo-kkk');
    await db.query(
      `INSERT INTO vendor_payouts (tenant_id, milestone, amount, currency_code, fees) VALUES ($1,'X', 10000, 'INR', 150)`,
      [t],
    );
    const n = (await db.query<{ n: string }>(`SELECT net_amount::text AS n FROM vendor_payouts`))
      .rows[0]!.n;
    expect(Number(n)).toBe(9850);
  });

  it('assignment vendor mismatch rejected', async () => {
    const t = await mkTenant(db, 'vpo-lll');
    const e = await mkEvent(db, t);
    const v1 = await mkVendor(db, 'v9@y.dev');
    const v2 = await mkVendor(db, 'va@y.dev');
    const a1 = await mkAssignment(db, t, e, v1);
    const err = await tryExec(
      db,
      `INSERT INTO vendor_payouts (tenant_id, event_id, vendor_account_id, assignment_id, milestone, amount, currency_code)
       VALUES ($1,$2,$3,$4,'X', 100, 'INR')`,
      [t, e, v2, a1],
    );
    expect(err).toMatch(/assignment|vendor|does not match/i);
  });

  it('cross-tenant event rejected', async () => {
    const t1 = await mkTenant(db, 'vpo-ttt');
    const t2 = await mkTenant(db, 'vpo-uuu');
    const e2 = await mkEvent(db, t2);
    const err = await tryExec(
      db,
      `INSERT INTO vendor_payouts (tenant_id, event_id, milestone, amount, currency_code) VALUES ($1,$2,'X', 100, 'INR')`,
      [t1, e2],
    );
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'vpo-www');
    await db.query(
      `INSERT INTO vendor_payouts (tenant_id, milestone, amount, currency_code) VALUES ($1,'X', 100, 'INR')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM vendor_payouts`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM vendor_payouts`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
