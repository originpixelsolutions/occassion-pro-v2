import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, type TestDb } from '../setup/pg.js';

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenantId: string, uid: string, email: string, role = 'owner'): Promise<void> {
  await db.query(
    `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($1, $2, $3, 'M', $4)`,
    [uid, tenantId, email, role]);
}
async function mkVendor(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO vendor_accounts (email, company_name, contact_name, phone, password_hash, mfa_enabled, default_currency, failed_login_count)
     VALUES ($1, 'V Co', 'V', '+919999999999', '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX', FALSE, 'INR', 0) RETURNING id`,
    [email])).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenantId: string, code: string): Promise<string> {
  const etId = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'w-' || $2, 'W', FALSE) RETURNING id`,
    [tenantId, code])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, $3, 'E', '2026-12-01', '2026-12-03', 'INR') RETURNING id`, [tenantId, etId, code])).rows[0]!.id;
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on vendor_accounts (Phase 12 Unit 88)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('vendor sees own row only', async () => {
    const v1 = await mkVendor(db, 'v1@y.dev');
    await mkVendor(db, 'v2@y.dev');
    await setCtx(db, v1, 'vendor', null);
    await asRole(db, 'authenticated');
    const ids = (await db.query<{ id: string }>(`SELECT id FROM vendor_accounts`)).rows.map(r => r.id);
    await asSuperuser(db);
    expect(ids).toEqual([v1]);
  });

  it('tenant_member sees vendors linked into own tenant', async () => {
    const t = await mkTenant(db, 'va-aaa');
    const e = await mkEvent(db, t, 'e-a');
    const u = '00000000-0000-0000-0000-000000002000';
    await mkMember(db, t, u, 'm@y.dev');
    const linked = await mkVendor(db, 'l@y.dev');
    const unlinked = await mkVendor(db, 'u@y.dev');
    await db.query(`INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category, status, assigned_by) VALUES ($1, $2, $3, 'photography', 'invited', $4)`, [linked, t, e, u]);
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const ids = (await db.query<{ id: string }>(`SELECT id FROM vendor_accounts`)).rows.map(r => r.id);
    await asSuperuser(db);
    expect(ids).toContain(linked);
    expect(ids).not.toContain(unlinked);
  });

  it('vendor can UPDATE own row', async () => {
    const v = await mkVendor(db, 'edit@y.dev');
    await setCtx(db, v, 'vendor', null);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE vendor_accounts SET failed_login_count=1 WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`, [v]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });

  it('vendor cannot UPDATE someone-else row', async () => {
    const me = await mkVendor(db, 'me@y.dev');
    const other = await mkVendor(db, 'other@y.dev');
    await setCtx(db, me, 'vendor', null);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE vendor_accounts SET failed_login_count=1 WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`, [other]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });
});
