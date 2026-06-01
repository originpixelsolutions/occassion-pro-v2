import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkSuperAdmin(db: TestDb, email: string, role = 'owner'): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO super_admins (email, role, full_name) VALUES ($1, $2, 'SA') RETURNING id`, [email, role])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenantId: string, uid: string, email: string, role = 'owner'): Promise<void> {
  await db.query(
    `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($1, $2, $3, 'M', $4)`,
    [uid, tenantId, email, role]);
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on event_types (Phase 12 Unit 70)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('system rows are visible to any authenticated tenant_member', async () => {
    await db.query(`INSERT INTO event_types (tenant_id, code, name, is_system) VALUES (NULL, 'wedding', 'Wedding', TRUE)`);
    const t = await mkTenant(db, 'ret-aaa');
    const uid = '00000000-0000-0000-0000-000000000300';
    await mkMember(db, t, uid, 'm@y.dev');
    await setCtx(db, uid, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM event_types WHERE tenant_id IS NULL`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });

  it('system rows are NOT visible to anon', async () => {
    await db.query(`INSERT INTO event_types (tenant_id, code, name, is_system) VALUES (NULL, 'wedding', 'Wedding', TRUE)`);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM event_types`)).rows.length);
    expect(n).toBe(0);
  });

  it('tenant rows are scoped to own tenant', async () => {
    const t1 = await mkTenant(db, 'ret-bbb');
    const t2 = await mkTenant(db, 'ret-ccc');
    await db.query(`INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'custom-1', 'Custom 1', FALSE)`, [t1]);
    await db.query(`INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'custom-2', 'Custom 2', FALSE)`, [t2]);
    const uid = '00000000-0000-0000-0000-000000000310';
    await mkMember(db, t1, uid, 'm@y.dev');
    await setCtx(db, uid, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const codes = (await db.query<{ code: string }>(`SELECT code FROM event_types WHERE tenant_id IS NOT NULL`)).rows.map(r => r.code);
    await asSuperuser(db);
    expect(codes).toEqual(['custom-1']);
  });

  it('owner can INSERT a tenant-scoped event_type', async () => {
    const t = await mkTenant(db, 'ret-ddd');
    const uid = '00000000-0000-0000-0000-000000000320';
    await mkMember(db, t, uid, 'o@y.dev', 'owner');
    await setCtx(db, uid, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(`INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'gala', 'Gala', FALSE)`, [t]);
    await asSuperuser(db);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_types WHERE code='gala'`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('tenant_member cannot INSERT a system event_type', async () => {
    const t = await mkTenant(db, 'ret-eee');
    const uid = '00000000-0000-0000-0000-000000000330';
    await mkMember(db, t, uid, 'o@y.dev', 'owner');
    await setCtx(db, uid, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(`INSERT INTO event_types (tenant_id, code, name, is_system) VALUES (NULL, 'sneak', 'Sneak', TRUE)`); }
    catch (e) { err = e instanceof Error ? e.message : String(e); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });

  it('super_admin can INSERT a system event_type', async () => {
    const sa = await mkSuperAdmin(db, 'sa@y.dev', 'owner');
    await setCtx(db, sa, 'super_admin', null);
    await asRole(db, 'authenticated');
    await db.query(`INSERT INTO event_types (tenant_id, code, name, is_system) VALUES (NULL, 'platform-evt', 'Platform Event', TRUE)`);
    await asSuperuser(db);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_types WHERE code='platform-evt'`)).rows[0]!.c;
    expect(c).toBe(1);
  });
});
