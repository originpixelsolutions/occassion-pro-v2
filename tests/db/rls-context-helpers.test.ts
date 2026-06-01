import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../setup/pg.js';

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkSuperAdmin(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO super_admins (email, role, full_name) VALUES ($1,'owner','SA') RETURNING id`, [email])).rows[0]!.id;
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  if (uid === null) await db.query(`SELECT set_config('app.user_id', '', false)`);
  else await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid]);
  if (userType === null) await db.query(`SELECT set_config('app.user_type', '', false)`);
  else await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType]);
  if (tenantId === null) await db.query(`SELECT set_config('app.tenant_id', '', false)`);
  else await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
}

describe('RLS context helpers (Phase 11 Unit 65)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('current_tenant_id() returns NULL when no context', async () => {
    await setCtx(db, null, null, null);
    const r = await db.query<{ current_tenant_id: string | null }>(`SELECT current_tenant_id()`);
    expect(r.rows[0]!.current_tenant_id).toBeNull();
  });

  it('current_tenant_id() reads from app.tenant_id GUC', async () => {
    const t = await mkTenant(db, 'rls-aaa');
    await setCtx(db, null, null, t);
    const r = await db.query<{ current_tenant_id: string | null }>(`SELECT current_tenant_id()`);
    expect(r.rows[0]!.current_tenant_id).toBe(t);
  });

  it('current_tenant_id() returns NULL on malformed UUID', async () => {
    await setCtx(db, null, null, 'not-a-uuid');
    const r = await db.query<{ current_tenant_id: string | null }>(`SELECT current_tenant_id()`);
    expect(r.rows[0]!.current_tenant_id).toBeNull();
  });

  it('current_user_type() defaults to anonymous', async () => {
    await setCtx(db, null, null, null);
    const r = await db.query<{ current_user_type: string }>(`SELECT current_user_type()`);
    expect(r.rows[0]!.current_user_type).toBe('anonymous');
  });

  it('current_user_type() coerces unknown values to anonymous', async () => {
    await setCtx(db, null, 'martian', null);
    const r = await db.query<{ current_user_type: string }>(`SELECT current_user_type()`);
    expect(r.rows[0]!.current_user_type).toBe('anonymous');
  });

  it('is_authenticated() is FALSE when no context', async () => {
    await setCtx(db, null, null, null);
    const r = await db.query<{ is_authenticated: boolean }>(`SELECT is_authenticated()`);
    expect(r.rows[0]!.is_authenticated).toBe(false);
  });

  it('is_authenticated() is TRUE for any valid (uid, user_type)', async () => {
    await setCtx(db, '00000000-0000-0000-0000-000000000001', 'tenant_member', null);
    const r = await db.query<{ is_authenticated: boolean }>(`SELECT is_authenticated()`);
    expect(r.rows[0]!.is_authenticated).toBe(true);
  });

  it('is_super_admin() is TRUE for an active super_admin', async () => {
    const sa = await mkSuperAdmin(db, 'sa@y.dev');
    await setCtx(db, sa, 'super_admin', null);
    const r = await db.query<{ is_super_admin: boolean }>(`SELECT is_super_admin()`);
    expect(r.rows[0]!.is_super_admin).toBe(true);
  });

  it('is_super_admin() is FALSE for deactivated super_admin', async () => {
    const sa = await mkSuperAdmin(db, 'sa@y.dev');
    await db.query(`UPDATE super_admins SET removed_at = now() WHERE id = $1`, [sa]);
    await setCtx(db, sa, 'super_admin', null);
    const r = await db.query<{ is_super_admin: boolean }>(`SELECT is_super_admin()`);
    expect(r.rows[0]!.is_super_admin).toBe(false);
  });

  it('is_super_admin() is FALSE when user_type lies', async () => {
    const sa = await mkSuperAdmin(db, 'sa@y.dev');
    await setCtx(db, sa, 'tenant_member', null);
    const r = await db.query<{ is_super_admin: boolean }>(`SELECT is_super_admin()`);
    expect(r.rows[0]!.is_super_admin).toBe(false);
  });

  it('is_tenant_member() is TRUE for matching, non-revoked member', async () => {
    const t = await mkTenant(db, 'rls-bbb');
    const uid = '00000000-0000-0000-0000-000000000002';
    await db.query(
      `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($2, $1, 'm@y.dev', 'M', 'owner')`, [t, uid]);
    await setCtx(db, uid, 'tenant_member', t);
    const r = await db.query<{ is_tenant_member: boolean }>(`SELECT is_tenant_member($1)`, [t]);
    expect(r.rows[0]!.is_tenant_member).toBe(true);
  });

  it('is_tenant_member() is FALSE for revoked member', async () => {
    const t = await mkTenant(db, 'rls-ccc');
    const uid = '00000000-0000-0000-0000-000000000003';
    await db.query(
      `INSERT INTO tenant_members (id, tenant_id, email, full_name, role, removed_at) VALUES ($2, $1, 'm@y.dev', 'M', 'owner', now())`, [t, uid]);
    await setCtx(db, uid, 'tenant_member', t);
    const r = await db.query<{ is_tenant_member: boolean }>(`SELECT is_tenant_member($1)`, [t]);
    expect(r.rows[0]!.is_tenant_member).toBe(false);
  });

  it('is_tenant_member() is FALSE for wrong tenant', async () => {
    const t = await mkTenant(db, 'rls-ddd');
    const other = await mkTenant(db, 'rls-eee');
    const uid = '00000000-0000-0000-0000-000000000004';
    await db.query(
      `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($2, $1, 'm@y.dev', 'M', 'owner')`, [t, uid]);
    await setCtx(db, uid, 'tenant_member', t);
    const r = await db.query<{ is_tenant_member: boolean }>(`SELECT is_tenant_member($1)`, [other]);
    expect(r.rows[0]!.is_tenant_member).toBe(false);
  });
});
