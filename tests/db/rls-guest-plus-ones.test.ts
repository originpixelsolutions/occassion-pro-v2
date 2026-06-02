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
async function mkGuest(db: TestDb, tenantId: string, eventId: string, name: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO guests (tenant_id, event_id, name, rsvp_status, registration_status, check_in_status) VALUES ($1, $2, $3, 'pending', 'pending_approval', 'not_checked_in') RETURNING id`,
    [tenantId, eventId, name])).rows[0]!.id;
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on guest_plus_ones (Phase 12 Unit 95)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('tenant_member sees own tenant +1s only', async () => {
    const t1 = await mkTenant(db, 'gpo-aaa');
    const t2 = await mkTenant(db, 'gpo-bbb');
    const e1 = await mkEvent(db, t1, 'e-a');
    const e2 = await mkEvent(db, t2, 'e-b');
    const g1 = await mkGuest(db, t1, e1, 'P1');
    const g2 = await mkGuest(db, t2, e2, 'P2');
    await db.query(`INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id, name, age_category, rsvp_status, check_in_status) VALUES ($1, $2, $3, 'A', 'adult', 'attending', 'not_checked_in')`, [t1, e1, g1]);
    await db.query(`INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id, name, age_category, rsvp_status, check_in_status) VALUES ($1, $2, $3, 'B', 'adult', 'attending', 'not_checked_in')`, [t2, e2, g2]);
    const u = '00000000-0000-0000-0000-000000002800';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const names = (await db.query<{ name: string }>(`SELECT name FROM guest_plus_ones`)).rows.map(r => r.name);
    await asSuperuser(db);
    expect(names).toEqual(['A']);
  });

  it('anon sees zero', async () => {
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM guest_plus_ones`)).rows.length);
    expect(n).toBe(0);
  });

  it('tenant_member can add a +1', async () => {
    const t = await mkTenant(db, 'gpo-ccc');
    const e = await mkEvent(db, t, 'e-c');
    const g = await mkGuest(db, t, e, 'P');
    const u = '00000000-0000-0000-0000-000000002810';
    await mkMember(db, t, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(`INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id, name, age_category, rsvp_status, check_in_status) VALUES ($1, $2, $3, 'Plus', 'adult', 'attending', 'not_checked_in')`, [t, e, g]);
    await asSuperuser(db);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM guest_plus_ones`)).rows[0]!.c).toBe(1);
  });

  it('different guest cannot add +1 for someone else', async () => {
    const t = await mkTenant(db, 'gpo-ddd');
    const e = await mkEvent(db, t, 'e-d');
    const me = await mkGuest(db, t, e, 'Me');
    const other = await mkGuest(db, t, e, 'Other');
    await setCtx(db, me, 'guest', t);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(`INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id, name, age_category, rsvp_status, check_in_status) VALUES ($1, $2, $3, 'Sneak', 'adult', 'attending', 'not_checked_in')`, [t, e, other]); }
    catch (e2) { err = e2 instanceof Error ? e2.message : String(e2); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy|parent rows not found/i);
  });
});
