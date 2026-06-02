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

describe('RLS on event_edit_sessions (Phase 12 Unit 82)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('self can INSERT own edit session', async () => {
    const t = await mkTenant(db, 'ees-aaa');
    const e = await mkEvent(db, t, 'e-a');
    const u = '00000000-0000-0000-0000-000000001500';
    await mkMember(db, t, u, 'm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path, expires_at) VALUES ($1, $2, 'name', now() + interval '5 minutes')`,
      [e, u]);
    await asSuperuser(db);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_edit_sessions`)).rows[0]!.c).toBe(1);
  });

  it('cannot INSERT with someone-else user_id', async () => {
    const t = await mkTenant(db, 'ees-bbb');
    const e = await mkEvent(db, t, 'e-b');
    const me = '00000000-0000-0000-0000-000000001510';
    const other = '00000000-0000-0000-0000-000000001511';
    await mkMember(db, t, me, 'me@y.dev', 'team_member');
    await mkMember(db, t, other, 'ot@y.dev', 'team_member');
    await setCtx(db, me, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path, expires_at) VALUES ($1, $2, 'x', now() + interval '5 minutes')`,
      [e, other]); }
    catch (e2) { err = e2 instanceof Error ? e2.message : String(e2); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });

  it('non-owner cannot UPDATE someone elses session', async () => {
    const t = await mkTenant(db, 'ees-ccc');
    const e = await mkEvent(db, t, 'e-c');
    const holder = '00000000-0000-0000-0000-000000001520';
    const intruder = '00000000-0000-0000-0000-000000001521';
    await mkMember(db, t, holder, 'h@y.dev', 'team_member');
    await mkMember(db, t, intruder, 'i@y.dev', 'team_member');
    const id = (await db.query<{ id: string }>(
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path, expires_at) VALUES ($1, $2, 'name', now() + interval '5 minutes') RETURNING id`,
      [e, holder])).rows[0]!.id;
    await setCtx(db, intruder, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE event_edit_sessions SET released_at=now(), released_reason='hijack' WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`, [id]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });

  it('manager CAN force-release', async () => {
    const t = await mkTenant(db, 'ees-ddd');
    const e = await mkEvent(db, t, 'e-d');
    const holder = '00000000-0000-0000-0000-000000001530';
    const mgr = '00000000-0000-0000-0000-000000001531';
    await mkMember(db, t, holder, 'h@y.dev', 'team_member');
    await mkMember(db, t, mgr, 'm@y.dev', 'event_manager');
    const id = (await db.query<{ id: string }>(
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path, expires_at) VALUES ($1, $2, 'name', now() + interval '5 minutes') RETURNING id`,
      [e, holder])).rows[0]!.id;
    await setCtx(db, mgr, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH d AS (DELETE FROM event_edit_sessions WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM d`, [id]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });
});
