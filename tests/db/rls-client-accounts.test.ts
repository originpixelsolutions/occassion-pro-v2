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

describe('RLS on client_accounts (Phase 12 Unit 85)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('client sees own row only', async () => {
    const c1 = await mkClient(db, 'c1@y.dev');
    await mkClient(db, 'c2@y.dev');
    await setCtx(db, c1, 'client', null);
    await asRole(db, 'authenticated');
    const ids = (await db.query<{ id: string }>(`SELECT id FROM client_accounts`)).rows.map(r => r.id);
    await asSuperuser(db);
    expect(ids).toEqual([c1]);
  });

  it('tenant_member sees clients linked into own tenant', async () => {
    const t = await mkTenant(db, 'ca-aaa');
    const e = await mkEvent(db, t, 'e-a');
    const u = '00000000-0000-0000-0000-000000001800';
    await mkMember(db, t, u, 'm@y.dev');
    const linkedClient = await mkClient(db, 'linked@y.dev');
    const unlinkedClient = await mkClient(db, 'unlinked@y.dev');
    await db.query(`INSERT INTO client_event_access (client_account_id, tenant_id, event_id, role) VALUES ($1, $2, $3, 'primary')`, [linkedClient, t, e]);
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const ids = (await db.query<{ id: string }>(`SELECT id FROM client_accounts ORDER BY id`)).rows.map(r => r.id);
    await asSuperuser(db);
    expect(ids).toContain(linkedClient);
    expect(ids).not.toContain(unlinkedClient);
  });

  it('revoked link hides client from tenant_member', async () => {
    const t = await mkTenant(db, 'ca-bbb');
    const e = await mkEvent(db, t, 'e-b');
    const u = '00000000-0000-0000-0000-000000001810';
    await mkMember(db, t, u, 'm@y.dev');
    const c = await mkClient(db, 'rev@y.dev');
    await db.query(`INSERT INTO client_event_access (client_account_id, tenant_id, event_id, role, revoked_at, revoked_by, revoked_reason) VALUES ($1, $2, $3, 'primary', now(), $4, 'test')`, [c, t, e, u]);
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const ids = (await db.query<{ id: string }>(`SELECT id FROM client_accounts`)).rows.map(r => r.id);
    await asSuperuser(db);
    expect(ids).not.toContain(c);
  });

  it('client can UPDATE own row', async () => {
    const c = await mkClient(db, 'edit@y.dev');
    await setCtx(db, c, 'client', null);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE client_accounts SET failed_login_count=1 WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`, [c]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });

  it('client cannot UPDATE someone-else row', async () => {
    const me = await mkClient(db, 'me@y.dev');
    const other = await mkClient(db, 'other@y.dev');
    await setCtx(db, me, 'client', null);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE client_accounts SET failed_login_count=1 WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`, [other]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });
});
