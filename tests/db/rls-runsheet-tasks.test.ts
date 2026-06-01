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

describe('RLS on runsheet_tasks (Phase 12 Unit 76)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('member sees own tenant tasks only', async () => {
    const t1 = await mkTenant(db, 'rrt-aaa');
    const t2 = await mkTenant(db, 'rrt-bbb');
    const e1 = await mkEvent(db, t1, 'e-a');
    const e2 = await mkEvent(db, t2, 'e-b');
    await db.query(
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, status, priority, sort_order)
       VALUES ($1, $2, 'Setup decor', 'pending', 'normal', 1)`, [t1, e1]);
    await db.query(
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, status, priority, sort_order)
       VALUES ($1, $2, 'Other tenant', 'pending', 'normal', 1)`, [t2, e2]);
    const u = '00000000-0000-0000-0000-000000000900';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const titles = (await db.query<{ title: string }>(`SELECT title FROM runsheet_tasks`)).rows.map(r => r.title);
    await asSuperuser(db);
    expect(titles).toEqual(['Setup decor']);
  });

  it('anon sees zero', async () => {
    const t = await mkTenant(db, 'rrt-ccc');
    const e = await mkEvent(db, t, 'e-c');
    await db.query(
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, status, priority, sort_order)
       VALUES ($1, $2, 'X', 'pending', 'normal', 1)`, [t, e]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM runsheet_tasks`)).rows.length);
    expect(n).toBe(0);
  });

  it('team_member CAN INSERT a task (broad INSERT)', async () => {
    const t = await mkTenant(db, 'rrt-ddd');
    const e = await mkEvent(db, t, 'e-d');
    const u = '00000000-0000-0000-0000-000000000910';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, status, priority, sort_order)
       VALUES ($1, $2, 'Quick add', 'pending', 'low', 1)`, [t, e]);
    await asSuperuser(db);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM runsheet_tasks WHERE title='Quick add'`)).rows[0]!.c).toBe(1);
  });

  it('team_member can UPDATE status', async () => {
    const t = await mkTenant(db, 'rrt-eee');
    const e = await mkEvent(db, t, 'e-e');
    const u = '00000000-0000-0000-0000-000000000920';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    const id = (await db.query<{ id: string }>(
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, status, priority, sort_order)
       VALUES ($1, $2, 'T', 'pending', 'normal', 1) RETURNING id`, [t, e])).rows[0]!.id;
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE runsheet_tasks SET status='in_progress', actual_start=now() WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`, [id]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });

  it('team_member cannot DELETE', async () => {
    const t = await mkTenant(db, 'rrt-fff');
    const e = await mkEvent(db, t, 'e-f');
    const u = '00000000-0000-0000-0000-000000000930';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    const id = (await db.query<{ id: string }>(
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, status, priority, sort_order)
       VALUES ($1, $2, 'T', 'pending', 'normal', 1) RETURNING id`, [t, e])).rows[0]!.id;
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH d AS (DELETE FROM runsheet_tasks WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM d`, [id]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });
});
