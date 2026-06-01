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
async function mkEventType(db: TestDb, tenantId: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'wedding', 'Wedding', FALSE) RETURNING id`,
    [tenantId])).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenantId: string, code: string): Promise<string> {
  const etId = await mkEventType(db, tenantId);
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, $3, 'Test Event', '2026-12-01', '2026-12-03', 'INR') RETURNING id`,
    [tenantId, etId, code])).rows[0]!.id;
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on events (Phase 12 Unit 68)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('tenant_member sees own tenant events only', async () => {
    const t1 = await mkTenant(db, 're-aaa');
    const t2 = await mkTenant(db, 're-bbb');
    const uid = '00000000-0000-0000-0000-000000000100';
    await mkMember(db, t1, uid, 'm@y.dev');
    await mkEvent(db, t1, 'evt-1');
    await mkEvent(db, t2, 'evt-2');
    await setCtx(db, uid, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const r = await db.query<{ code: string }>(`SELECT code FROM events`);
    await asSuperuser(db);
    expect(r.rows.map(x => x.code)).toEqual(['evt-1']);
  });

  it('anon sees zero events', async () => {
    const t = await mkTenant(db, 're-ccc');
    await mkEvent(db, t, 'evt-1');
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM events`)).rows.length);
    expect(n).toBe(0);
  });

  it('super_admin sees all events', async () => {
    const sa = await mkSuperAdmin(db, 'sa@y.dev');
    const t1 = await mkTenant(db, 're-ddd');
    const t2 = await mkTenant(db, 're-eee');
    await mkEvent(db, t1, 'evt-1');
    await mkEvent(db, t2, 'evt-2');
    await setCtx(db, sa, 'super_admin', null);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM events`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(2);
  });

  it('owner can INSERT events in own tenant', async () => {
    const t = await mkTenant(db, 're-fff');
    const uid = '00000000-0000-0000-0000-000000000110';
    await mkMember(db, t, uid, 'o@y.dev', 'owner');
    const etId = await mkEventType(db, t);
    await setCtx(db, uid, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
       VALUES ($1, $2, 'evt-new', 'New Event', '2026-12-01', '2026-12-03', 'INR')`, [t, etId]);
    await asSuperuser(db);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM events WHERE code='evt-new'`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('team_member cannot INSERT events', async () => {
    const t = await mkTenant(db, 're-ggg');
    const uid = '00000000-0000-0000-0000-000000000120';
    await mkMember(db, t, uid, 'tm@y.dev', 'team_member');
    const etId = await mkEventType(db, t);
    await setCtx(db, uid, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try {
      await db.query(
        `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
         VALUES ($1, $2, 'evt-x', 'X', '2026-12-01', '2026-12-03', 'INR')`, [t, etId]);
    } catch (e) { err = e instanceof Error ? e.message : String(e); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });

  it('team_member CAN UPDATE existing events (operational edits)', async () => {
    const t = await mkTenant(db, 're-hhh');
    const uid = '00000000-0000-0000-0000-000000000130';
    await mkMember(db, t, uid, 'tm@y.dev', 'team_member');
    const eid = await mkEvent(db, t, 'evt-edit');
    await setCtx(db, uid, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE events SET name='Updated' WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`, [eid]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });

  it('team_member cannot DELETE events', async () => {
    const t = await mkTenant(db, 're-iii');
    const uid = '00000000-0000-0000-0000-000000000140';
    await mkMember(db, t, uid, 'tm@y.dev', 'team_member');
    const eid = await mkEvent(db, t, 'evt-del');
    await setCtx(db, uid, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH d AS (DELETE FROM events WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM d`, [eid]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });
});
