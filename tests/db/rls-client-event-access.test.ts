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
async function mkClient(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO client_accounts (email, password_hash, mfa_enabled, failed_login_count) VALUES ($1, '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX', FALSE, 0) RETURNING id`,
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

describe('RLS on client_event_access (Phase 12 Unit 86)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('tenant_member sees own tenant links only', async () => {
    const t1 = await mkTenant(db, 'cea-aaa');
    const t2 = await mkTenant(db, 'cea-bbb');
    const e1 = await mkEvent(db, t1, 'e-a');
    const e2 = await mkEvent(db, t2, 'e-b');
    const c1 = await mkClient(db, 'c1@y.dev');
    const c2 = await mkClient(db, 'c2@y.dev');
    await db.query(`INSERT INTO client_event_access (client_account_id, tenant_id, event_id, role) VALUES ($1, $2, $3, 'primary')`, [c1, t1, e1]);
    await db.query(`INSERT INTO client_event_access (client_account_id, tenant_id, event_id, role) VALUES ($1, $2, $3, 'primary')`, [c2, t2, e2]);
    const u = '00000000-0000-0000-0000-000000001900';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM client_event_access`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });

  it('client sees own access rows only', async () => {
    const t = await mkTenant(db, 'cea-ccc');
    const e = await mkEvent(db, t, 'e-c');
    const me = await mkClient(db, 'me@y.dev');
    const other = await mkClient(db, 'other@y.dev');
    await db.query(`INSERT INTO client_event_access (client_account_id, tenant_id, event_id, role) VALUES ($1, $2, $3, 'primary')`, [me, t, e]);
    await db.query(`INSERT INTO client_event_access (client_account_id, tenant_id, event_id, role) VALUES ($1, $2, $3, 'primary')`, [other, t, e]);
    await setCtx(db, me, 'client', null);
    await asRole(db, 'authenticated');
    const rows = await db.query<{ client_account_id: string }>(`SELECT client_account_id FROM client_event_access`);
    await asSuperuser(db);
    expect(rows.rows.map(r => r.client_account_id)).toEqual([me]);
  });

  it('anon sees zero', async () => {
    const t = await mkTenant(db, 'cea-ddd');
    const e = await mkEvent(db, t, 'e-d');
    const c = await mkClient(db, 'a@y.dev');
    await db.query(`INSERT INTO client_event_access (client_account_id, tenant_id, event_id, role) VALUES ($1, $2, $3, 'primary')`, [c, t, e]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM client_event_access`)).rows.length);
    expect(n).toBe(0);
  });

  it('owner can INSERT', async () => {
    const t = await mkTenant(db, 'cea-eee');
    const e = await mkEvent(db, t, 'e-e');
    const c = await mkClient(db, 'i@y.dev');
    const u = '00000000-0000-0000-0000-000000001910';
    await mkMember(db, t, u, 'o@y.dev', 'owner');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(`INSERT INTO client_event_access (client_account_id, tenant_id, event_id, role) VALUES ($1, $2, $3, 'primary')`, [c, t, e]);
    await asSuperuser(db);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM client_event_access`)).rows[0]!.c).toBe(1);
  });

  it('team_member cannot INSERT', async () => {
    const t = await mkTenant(db, 'cea-fff');
    const e = await mkEvent(db, t, 'e-f');
    const c = await mkClient(db, 'j@y.dev');
    const u = '00000000-0000-0000-0000-000000001920';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(`INSERT INTO client_event_access (client_account_id, tenant_id, event_id, role) VALUES ($1, $2, $3, 'primary')`, [c, t, e]); }
    catch (e2) { err = e2 instanceof Error ? e2.message : String(e2); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });
});
