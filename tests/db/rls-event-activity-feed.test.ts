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

describe('RLS on event_activity_feed (Phase 12 Unit 79)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('member can append own activity', async () => {
    const t = await mkTenant(db, 'eaf-aaa');
    const e = await mkEvent(db, t, 'e-a');
    const u = '00000000-0000-0000-0000-000000001200';
    await mkMember(db, t, u, 'm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_id, actor_type, activity_type, description, is_internal)
       VALUES ($1, $2, $3, 'tenant_member', 'task_added', 'Created decor task', FALSE)`, [t, e, u]);
    await asSuperuser(db);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_activity_feed`)).rows[0]!.c).toBe(1);
  });

  it('member cannot spoof someone-else attribution', async () => {
    const t = await mkTenant(db, 'eaf-bbb');
    const e = await mkEvent(db, t, 'e-b');
    const me = '00000000-0000-0000-0000-000000001210';
    const other = '00000000-0000-0000-0000-000000001211';
    await mkMember(db, t, me, 'me@y.dev', 'team_member');
    await mkMember(db, t, other, 'ot@y.dev', 'team_member');
    await setCtx(db, me, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_id, actor_type, activity_type, description, is_internal)
       VALUES ($1, $2, $3, 'tenant_member', 'task_added', 'X', FALSE)`, [t, e, other]); }
    catch (e2) { err = e2 instanceof Error ? e2.message : String(e2); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });

  it('anon sees zero', async () => {
    const t = await mkTenant(db, 'eaf-ccc');
    const e = await mkEvent(db, t, 'e-c');
    await db.query(
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_id, actor_type, activity_type, description, is_internal)
       VALUES ($1, $2, NULL, 'system', 'event_created', 'auto', FALSE)`, [t, e]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM event_activity_feed`)).rows.length);
    expect(n).toBe(0);
  });

  it('team_member cannot DELETE', async () => {
    const t = await mkTenant(db, 'eaf-ddd');
    const e = await mkEvent(db, t, 'e-d');
    const u = '00000000-0000-0000-0000-000000001220';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    const id = (await db.query<{ id: string }>(
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_id, actor_type, activity_type, description, is_internal)
       VALUES ($1, $2, NULL, 'system', 'event_created', 'auto', FALSE) RETURNING id`, [t, e])).rows[0]!.id;
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH d AS (DELETE FROM event_activity_feed WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM d`, [id]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });
});
