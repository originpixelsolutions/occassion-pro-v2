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
async function mkAssignment(
  db: TestDb,
  t: string,
  e: string,
  v: string,
  cat = 'catering',
): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category)
     VALUES ($1,$2,$3,$4) RETURNING id`,
      [v, t, e, cat],
    )
  ).rows[0]!.id;
}
async function mkCrew(db: TestDb, vendor: string, name = 'Ravi'): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO vendor_crew_members (vendor_account_id, full_name) VALUES ($1,$2) RETURNING id`,
      [vendor, name],
    )
  ).rows[0]!.id;
}

describe('vendor_crew_assignments — schema correctness (Phase 3 Unit 40)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid scheduled assignment', async () => {
    const t = await mkTenant(db, 'vca-aaa');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v1@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const m = await mkCrew(db, v);
    await db.query(
      `INSERT INTO vendor_crew_assignments (vendor_assignment_id, crew_member_id, vendor_account_id, tenant_id, event_id, role_on_event, shift_start, shift_end)
       VALUES ($1,$2,$3,$4,$5,'Lead Server', now()+interval '1 day', now()+interval '1 day 8 hours')`,
      [a, m, v, t, e],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_crew_assignments`))
        .rows[0]!.c,
    ).toBe(1);
  });

  it('UNIQUE (assignment, crew) blocks dupe', async () => {
    const t = await mkTenant(db, 'vca-bbb');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v2@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const m = await mkCrew(db, v);
    await db.query(
      `INSERT INTO vendor_crew_assignments (vendor_assignment_id, crew_member_id, vendor_account_id, tenant_id, event_id) VALUES ($1,$2,$3,$4,$5)`,
      [a, m, v, t, e],
    );
    const err = await tryExec(
      db,
      `INSERT INTO vendor_crew_assignments (vendor_assignment_id, crew_member_id, vendor_account_id, tenant_id, event_id) VALUES ($1,$2,$3,$4,$5)`,
      [a, m, v, t, e],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('rejects shift_end <= shift_start', async () => {
    const t = await mkTenant(db, 'vca-ccc');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v3@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const m = await mkCrew(db, v);
    const err = await tryExec(
      db,
      `INSERT INTO vendor_crew_assignments (vendor_assignment_id, crew_member_id, vendor_account_id, tenant_id, event_id, shift_start, shift_end)
       VALUES ($1,$2,$3,$4,$5, now()+interval '2 hours', now()+interval '1 hour')`,
      [a, m, v, t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('checked_in requires checked_in_at', async () => {
    const t = await mkTenant(db, 'vca-ddd');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v4@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const m = await mkCrew(db, v);
    const err = await tryExec(
      db,
      `INSERT INTO vendor_crew_assignments (vendor_assignment_id, crew_member_id, vendor_account_id, tenant_id, event_id, status)
       VALUES ($1,$2,$3,$4,$5,'checked_in')`,
      [a, m, v, t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('checked_out requires both timestamps and ordering', async () => {
    const t = await mkTenant(db, 'vca-eee');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v5@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const m = await mkCrew(db, v);
    const err = await tryExec(
      db,
      `INSERT INTO vendor_crew_assignments (vendor_assignment_id, crew_member_id, vendor_account_id, tenant_id, event_id, status, checked_in_at, checked_out_at)
       VALUES ($1,$2,$3,$4,$5,'checked_out', now(), now() - interval '1 hour')`,
      [a, m, v, t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('cancelled requires cancelled_at + reason', async () => {
    const t = await mkTenant(db, 'vca-fff');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v6@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const m = await mkCrew(db, v);
    const err = await tryExec(
      db,
      `INSERT INTO vendor_crew_assignments (vendor_assignment_id, crew_member_id, vendor_account_id, tenant_id, event_id, status)
       VALUES ($1,$2,$3,$4,$5,'cancelled')`,
      [a, m, v, t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('crew from another vendor rejected', async () => {
    const t = await mkTenant(db, 'vca-ggg');
    const e = await mkEvent(db, t);
    const v1 = await mkVendor(db, 'v7@y.dev');
    const v2 = await mkVendor(db, 'v8@y.dev');
    const a1 = await mkAssignment(db, t, e, v1);
    const mOther = await mkCrew(db, v2);
    const err = await tryExec(
      db,
      `INSERT INTO vendor_crew_assignments (vendor_assignment_id, crew_member_id, vendor_account_id, tenant_id, event_id) VALUES ($1,$2,$3,$4,$5)`,
      [a1, mOther, v1, t, e],
    );
    expect(err).toMatch(/crew_member|does not belong/i);
  });

  it('assignment vendor mismatch rejected', async () => {
    const t = await mkTenant(db, 'vca-hhh');
    const e = await mkEvent(db, t);
    const v1 = await mkVendor(db, 'v9@y.dev');
    const v2 = await mkVendor(db, 'va@y.dev');
    const a1 = await mkAssignment(db, t, e, v1);
    const m2 = await mkCrew(db, v2);
    const err = await tryExec(
      db,
      `INSERT INTO vendor_crew_assignments (vendor_assignment_id, crew_member_id, vendor_account_id, tenant_id, event_id) VALUES ($1,$2,$3,$4,$5)`,
      [a1, m2, v2, t, e],
    );
    expect(err).toMatch(/parents|does not match/i);
  });

  it('cross-tenant event rejected', async () => {
    const t1 = await mkTenant(db, 'vca-iii');
    const e1 = await mkEvent(db, t1);
    const v = await mkVendor(db, 'vb@y.dev');
    const a1 = await mkAssignment(db, t1, e1, v);
    const m = await mkCrew(db, v);
    const t2 = await mkTenant(db, 'vca-jjj');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_crew_assignments (vendor_assignment_id, crew_member_id, vendor_account_id, tenant_id, event_id) VALUES ($1,$2,$3,$4,$5)`,
      [a1, m, v, t2, e1],
    );
    expect(err).toMatch(/parents|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'vca-www');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'vw@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const m = await mkCrew(db, v);
    await db.query(
      `INSERT INTO vendor_crew_assignments (vendor_assignment_id, crew_member_id, vendor_account_id, tenant_id, event_id) VALUES ($1,$2,$3,$4,$5)`,
      [a, m, v, t, e],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM vendor_crew_assignments`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM vendor_crew_assignments`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
