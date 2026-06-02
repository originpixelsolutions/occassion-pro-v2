import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, withRole, type TestDb } from '../setup/pg.js';

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

describe('RLS on vendor_event_assignments (Phase 12 Unit 87)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('tenant_member sees own tenant assignments only', async () => {
    const t1 = await mkTenant(db, 'vea-aaa');
    const t2 = await mkTenant(db, 'vea-bbb');
    const e1 = await mkEvent(db, t1, 'e-a');
    const e2 = await mkEvent(db, t2, 'e-b');
    const v1 = await mkVendor(db, 'v1@y.dev');
    const v2 = await mkVendor(db, 'v2@y.dev');
    const u1 = '00000000-0000-0000-0000-000000002100';
    const u2 = '00000000-0000-0000-0000-000000002101';
    await mkMember(db, t1, u1, 'm1@y.dev');
    await mkMember(db, t2, u2, 'm2@y.dev');
    await db.query(`INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category, status, assigned_by) VALUES ($1, $2, $3, 'photography', 'invited', $4)`, [v1, t1, e1, u1]);
    await db.query(`INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category, status, assigned_by) VALUES ($1, $2, $3, 'photography', 'invited', $4)`, [v2, t2, e2, u2]);
    await setCtx(db, u1, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM vendor_event_assignments`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });

  it('vendor sees own assignments only', async () => {
    const t = await mkTenant(db, 'vea-ccc');
    const e = await mkEvent(db, t, 'e-c');
    const me = await mkVendor(db, 'me@y.dev');
    const other = await mkVendor(db, 'other@y.dev');
    const u = '00000000-0000-0000-0000-000000002110';
    await mkMember(db, t, u, 'm@y.dev');
    await db.query(`INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category, status, assigned_by) VALUES ($1, $2, $3, 'photography', 'invited', $4)`, [me, t, e, u]);
    await db.query(`INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category, status, assigned_by) VALUES ($1, $2, $3, 'photography', 'invited', $4)`, [other, t, e, u]);
    await setCtx(db, me, 'vendor', null);
    await asRole(db, 'authenticated');
    const rows = await db.query<{ vendor_account_id: string }>(`SELECT vendor_account_id FROM vendor_event_assignments`);
    await asSuperuser(db);
    expect(rows.rows.map(r => r.vendor_account_id)).toEqual([me]);
  });

  it('anon sees zero', async () => {
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM vendor_event_assignments`)).rows.length);
    expect(n).toBe(0);
  });
});
