import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkSuperAdmin(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO super_admins (email, role, full_name) VALUES ($1,'owner','SA') RETURNING id`, [email])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenantId: string, uid: string, email: string): Promise<void> {
  await db.query(
    `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($1, $2, $3, 'M', 'owner')`,
    [uid, tenantId, email]);
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on tenants (Phase 12 Unit 66)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('tenant_member sees own tenant only (RLS pair)', async () => {
    const t1 = await mkTenant(db, 'rt-aaa');
    const t2 = await mkTenant(db, 'rt-bbb');
    const uid = '00000000-0000-0000-0000-000000000010';
    await mkMember(db, t1, uid, 'm1@y.dev');
    await setCtx(db, uid, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const rows = (await db.query<{ id: string }>(`SELECT id FROM tenants`)).rows;
    await asSuperuser(db);
    expect(rows.map(r => r.id).sort()).toEqual([t1].sort());
    expect(rows.map(r => r.id)).not.toContain(t2);
  });

  it('anonymous sees zero tenants', async () => {
    await mkTenant(db, 'rt-ccc');
    await setCtx(db, null, null, null);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM tenants`)).rows.length);
    expect(n).toBe(0);
  });

  it('service_role sees all tenants (BYPASSRLS)', async () => {
    await mkTenant(db, 'rt-ddd');
    await mkTenant(db, 'rt-eee');
    const n = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM tenants`)).rows.length);
    expect(n).toBe(2);
  });

  it('super_admin sees all tenants', async () => {
    const sa = await mkSuperAdmin(db, 'sa@y.dev');
    await mkTenant(db, 'rt-fff');
    await mkTenant(db, 'rt-ggg');
    await setCtx(db, sa, 'super_admin', null);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM tenants`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(2);
  });

  it('tenant_member cannot UPDATE a tenant they are not in', async () => {
    const t1 = await mkTenant(db, 'rt-hhh');
    const t2 = await mkTenant(db, 'rt-iii');
    const uid = '00000000-0000-0000-0000-000000000011';
    await mkMember(db, t1, uid, 'm2@y.dev');
    await setCtx(db, uid, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE tenants SET company_name = 'X' WHERE id = $1 RETURNING id)
       SELECT count(*)::int AS c FROM u`, [t2]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0); // RLS blocks the UPDATE silently
  });

  it('tenant_member CAN UPDATE their own tenant', async () => {
    const t = await mkTenant(db, 'rt-jjj');
    const uid = '00000000-0000-0000-0000-000000000012';
    await mkMember(db, t, uid, 'm3@y.dev');
    await setCtx(db, uid, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE tenants SET company_name = 'New' WHERE id = $1 RETURNING id)
       SELECT count(*)::int AS c FROM u`, [t]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });

  it('non-super-admin cannot INSERT a tenant', async () => {
    const uid = '00000000-0000-0000-0000-000000000013';
    await setCtx(db, uid, 'tenant_member', null);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(`INSERT INTO tenants (slug, company_name, billing_currency) VALUES ('blocked','X','INR')`); }
    catch (e) { err = e instanceof Error ? e.message : String(e); }
    await asSuperuser(db);
    expect(err).toMatch(/violates row-level security|policy/i);
  });
});
