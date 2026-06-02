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

describe('RLS on guests (Phase 12 Unit 92)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('tenant_member sees own tenant guest list only', async () => {
    const t1 = await mkTenant(db, 'gst-aaa');
    const t2 = await mkTenant(db, 'gst-bbb');
    const e1 = await mkEvent(db, t1, 'e-a');
    const e2 = await mkEvent(db, t2, 'e-b');
    await db.query(`INSERT INTO guests (tenant_id, event_id, name, rsvp_status, registration_status, check_in_status) VALUES ($1, $2, 'Alice', 'pending', 'pending_approval', 'not_checked_in')`, [t1, e1]);
    await db.query(`INSERT INTO guests (tenant_id, event_id, name, rsvp_status, registration_status, check_in_status) VALUES ($1, $2, 'Bob', 'pending', 'pending_approval', 'not_checked_in')`, [t2, e2]);
    const u = '00000000-0000-0000-0000-000000002500';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const names = (await db.query<{ name: string }>(`SELECT name FROM guests`)).rows.map(r => r.name);
    await asSuperuser(db);
    expect(names).toEqual(['Alice']);
  });

  it('anon sees zero guests', async () => {
    const t = await mkTenant(db, 'gst-ccc');
    const e = await mkEvent(db, t, 'e-c');
    await db.query(`INSERT INTO guests (tenant_id, event_id, name, rsvp_status, registration_status, check_in_status) VALUES ($1, $2, 'Z', 'pending', 'pending_approval', 'not_checked_in')`, [t, e]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM guests`)).rows.length);
    expect(n).toBe(0);
  });

  it('team_member CAN INSERT guests (broad - import flow)', async () => {
    const t = await mkTenant(db, 'gst-ddd');
    const e = await mkEvent(db, t, 'e-d');
    const u = '00000000-0000-0000-0000-000000002510';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(`INSERT INTO guests (tenant_id, event_id, name, rsvp_status, registration_status, check_in_status) VALUES ($1, $2, 'NewGuest', 'pending', 'pending_approval', 'not_checked_in')`, [t, e]);
    await asSuperuser(db);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM guests`)).rows[0]!.c).toBe(1);
  });

  it('guest sees and updates own row only', async () => {
    const t = await mkTenant(db, 'gst-eee');
    const e = await mkEvent(db, t, 'e-e');
    const gid = (await db.query<{ id: string }>(
      `INSERT INTO guests (tenant_id, event_id, name, rsvp_status, registration_status, check_in_status) VALUES ($1, $2, 'Self', 'pending', 'pending_approval', 'not_checked_in') RETURNING id`,
      [t, e])).rows[0]!.id;
    await db.query(`INSERT INTO guests (tenant_id, event_id, name, rsvp_status, registration_status, check_in_status) VALUES ($1, $2, 'Other', 'pending', 'pending_approval', 'not_checked_in')`, [t, e]);
    await setCtx(db, gid, 'guest', t);
    await asRole(db, 'authenticated');
    const visible = (await db.query<{ id: string }>(`SELECT id FROM guests`)).rows.map(r => r.id);
    expect(visible).toEqual([gid]);
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE guests SET rsvp_status='attending' WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`, [gid]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });

  it('team_member cannot DELETE guests', async () => {
    const t = await mkTenant(db, 'gst-fff');
    const e = await mkEvent(db, t, 'e-f');
    const gid = (await db.query<{ id: string }>(
      `INSERT INTO guests (tenant_id, event_id, name, rsvp_status, registration_status, check_in_status) VALUES ($1, $2, 'X', 'pending', 'pending_approval', 'not_checked_in') RETURNING id`,
      [t, e])).rows[0]!.id;
    const u = '00000000-0000-0000-0000-000000002520';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH d AS (DELETE FROM guests WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM d`, [gid]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });
});
