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

describe('RLS on tenant_members (Phase 12 Unit 67)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('member sees roster of own tenant only', async () => {
    const t1 = await mkTenant(db, 'rtm-aaa');
    const t2 = await mkTenant(db, 'rtm-bbb');
    const u1 = '00000000-0000-0000-0000-000000000020';
    const u2 = '00000000-0000-0000-0000-000000000021';
    await mkMember(db, t1, u1, 'm1@y.dev');
    await mkMember(db, t2, u2, 'm2@y.dev');
    await setCtx(db, u1, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const rows = (await db.query<{ id: string }>(`SELECT id FROM tenant_members`)).rows;
    await asSuperuser(db);
    expect(rows.map(r => r.id).sort()).toEqual([u1].sort());
  });

  it('anon sees zero rows', async () => {
    const t = await mkTenant(db, 'rtm-ccc');
    await mkMember(db, t, '00000000-0000-0000-0000-000000000030', 'a@y.dev');
    await setCtx(db, null, null, null);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM tenant_members`)).rows.length);
    expect(n).toBe(0);
  });

  it('super_admin sees all members', async () => {
    const sa = await mkSuperAdmin(db, 'sa@y.dev');
    const t1 = await mkTenant(db, 'rtm-ddd');
    const t2 = await mkTenant(db, 'rtm-eee');
    await mkMember(db, t1, '00000000-0000-0000-0000-000000000040', 'a@y.dev');
    await mkMember(db, t2, '00000000-0000-0000-0000-000000000041', 'b@y.dev');
    await setCtx(db, sa, 'super_admin', null);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM tenant_members`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(2);
  });

  it('owner can INSERT a new member', async () => {
    const t = await mkTenant(db, 'rtm-fff');
    const owner = '00000000-0000-0000-0000-000000000050';
    await mkMember(db, t, owner, 'o@y.dev', 'owner');
    await setCtx(db, owner, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const newId = '00000000-0000-0000-0000-000000000051';
    await db.query(
      `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($1, $2, 'new@y.dev', 'New', 'event_manager')`,
      [newId, t]);
    await asSuperuser(db);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_members WHERE id=$1`, [newId])).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('non-owner member cannot INSERT a new member', async () => {
    const t = await mkTenant(db, 'rtm-ggg');
    const editor = '00000000-0000-0000-0000-000000000060';
    await mkMember(db, t, editor, 'e@y.dev', 'team_member');
    await setCtx(db, editor, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try {
      await db.query(
        `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($1, $2, 'x@y.dev', 'X', 'team_member')`,
        ['00000000-0000-0000-0000-000000000061', t]);
    } catch (e) { err = e instanceof Error ? e.message : String(e); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });

  it('member can UPDATE own row (self-edit)', async () => {
    const t = await mkTenant(db, 'rtm-hhh');
    const uid = '00000000-0000-0000-0000-000000000070';
    await mkMember(db, t, uid, 'h@y.dev', 'team_member');
    await setCtx(db, uid, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE tenant_members SET full_name='Updated' WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`,
      [uid]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });

  it('non-owner cannot UPDATE someone else', async () => {
    const t = await mkTenant(db, 'rtm-iii');
    const editor = '00000000-0000-0000-0000-000000000080';
    const other  = '00000000-0000-0000-0000-000000000081';
    await mkMember(db, t, editor, 'ed@y.dev', 'team_member');
    await mkMember(db, t, other,  'ot@y.dev', 'team_member');
    await setCtx(db, editor, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE tenant_members SET full_name='Hacked' WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`,
      [other]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });

  it('owner CAN UPDATE another member in same tenant', async () => {
    const t = await mkTenant(db, 'rtm-jjj');
    const owner = '00000000-0000-0000-0000-000000000090';
    const other = '00000000-0000-0000-0000-000000000091';
    await mkMember(db, t, owner, 'o@y.dev', 'owner');
    await mkMember(db, t, other, 'ot@y.dev', 'team_member');
    await setCtx(db, owner, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE tenant_members SET full_name='Edited by owner' WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`,
      [other]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });
});
