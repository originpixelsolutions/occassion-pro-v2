import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}

const PW = '$argon2id$v=19$m=65536,t=3,p=4$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`,
    [slug])).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenant: string, code='evt-001'): Promise<string> {
  const ty = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'W', FALSE) RETURNING id`, [tenant])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`, [tenant, ty, code])).rows[0]!.id;
}
async function mkVendor(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO vendor_accounts (email, password_hash) VALUES ($1,$2) RETURNING id`,
    [email, PW])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1,$2,'M','event_manager') RETURNING id`,
    [tenant, email])).rows[0]!.id;
}

describe('vendor_event_assignments — schema correctness (Phase 3 Unit 21)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid invitation', async () => {
    const t = await mkTenant(db, 'vea-aaa');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v1@y.dev');
    const m = await mkMember(db, t, 'm@y.dev');
    await db.query(
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category, contract_value, currency_code, assigned_by)
       VALUES ($1,$2,$3,'catering', 250000.00, 'INR', $4)`, [v, t, e, m]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_event_assignments`)).rows[0]!.c).toBe(1);
  });

  it('partial UNIQUE blocks dupe vendor+event+category', async () => {
    const t = await mkTenant(db, 'vea-bbb');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v2@y.dev');
    await db.query(
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category)
       VALUES ($1,$2,$3,'Catering')`, [v, t, e]);
    const err = await tryExec(db,
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category)
       VALUES ($1,$2,$3,'CATERING')`, [v, t, e]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('value/currency two-way coupling', async () => {
    const t = await mkTenant(db, 'vea-ccc');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v3@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category, contract_value)
       VALUES ($1,$2,$3,'flowers', 50000.00)`, [v, t, e]);
    expect(err).toMatch(/value_currency|check/i);
  });

  it('accepted requires responded_at', async () => {
    const t = await mkTenant(db, 'vea-ddd');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v4@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category, status)
       VALUES ($1,$2,$3,'sound','accepted')`, [v, t, e]);
    expect(err).toMatch(/check/i);
  });

  it('declined requires responded_at + declined_reason', async () => {
    const t = await mkTenant(db, 'vea-eee');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v5@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category, status, responded_at)
       VALUES ($1,$2,$3,'lighting','declined', now())`, [v, t, e]);
    expect(err).toMatch(/check/i);
  });

  it('completed requires completed_at', async () => {
    const t = await mkTenant(db, 'vea-fff');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v6@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category, status, responded_at)
       VALUES ($1,$2,$3,'photo','completed', now())`, [v, t, e]);
    expect(err).toMatch(/check/i);
  });

  it('rating only allowed when completed', async () => {
    const t = await mkTenant(db, 'vea-ggg');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v7@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category, status, performance_rating)
       VALUES ($1,$2,$3,'video','invited', 4.5)`, [v, t, e]);
    expect(err).toMatch(/rating_requires|check/i);
  });

  it('cross-tenant assigner rejected', async () => {
    const t1 = await mkTenant(db, 'vea-ttt');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'vea-uuu');
    const v = await mkVendor(db, 'v8@y.dev');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category, assigned_by)
       VALUES ($1,$2,$3,'av',$4)`, [v, t1, e1, mOther]);
    expect(err).toMatch(/assigned_by|tenant/i);
  });

  it('cross-tenant event rejected', async () => {
    const t1 = await mkTenant(db, 'vea-vvv');
    const t2 = await mkTenant(db, 'vea-www');
    const e2 = await mkEvent(db, t2);
    const v = await mkVendor(db, 'v9@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category)
       VALUES ($1,$2,$3,'decor')`, [v, t1, e2]);
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('soft-delete then re-assign permitted', async () => {
    const t = await mkTenant(db, 'vea-yyy');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'va@y.dev');
    await db.query(
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category, deleted_at)
       VALUES ($1,$2,$3,'catering', now())`, [v, t, e]);
    await db.query(
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category)
       VALUES ($1,$2,$3,'catering')`, [v, t, e]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_event_assignments WHERE deleted_at IS NULL`)).rows[0]!.c).toBe(1);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'vea-zzz');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'vb@y.dev');
    await db.query(
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category)
       VALUES ($1,$2,$3,'av')`, [v, t, e]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM vendor_event_assignments`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM vendor_event_assignments`)).rows.length);
    expect(svc).toBe(1);
  });
});
