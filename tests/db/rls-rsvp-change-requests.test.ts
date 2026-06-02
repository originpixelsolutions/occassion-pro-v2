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

describe('RLS on rsvp_change_requests (Phase 12 Unit 96)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('tenant_member sees own tenant requests only', async () => {
    const t1 = await mkTenant(db, 'rcr-aaa');
    const t2 = await mkTenant(db, 'rcr-bbb');
    const e1 = await mkEvent(db, t1, 'e-a');
    const e2 = await mkEvent(db, t2, 'e-b');
    const g1 = await mkGuest(db, t1, e1, 'A');
    const g2 = await mkGuest(db, t2, e2, 'B');
    await db.query(`INSERT INTO rsvp_change_requests (tenant_id, event_id, guest_id, old_rsvp_status, new_rsvp_status, status) VALUES ($1, $2, $3, 'pending', 'attending', 'pending')`, [t1, e1, g1]);
    await db.query(`INSERT INTO rsvp_change_requests (tenant_id, event_id, guest_id, old_rsvp_status, new_rsvp_status, status) VALUES ($1, $2, $3, 'pending', 'attending', 'pending')`, [t2, e2, g2]);
    const u = '00000000-0000-0000-0000-000000002900';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM rsvp_change_requests`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });

  it('anon sees zero', async () => {
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM rsvp_change_requests`)).rows.length);
    expect(n).toBe(0);
  });

  it('tenant_member can approve (UPDATE)', async () => {
    const t = await mkTenant(db, 'rcr-ccc');
    const e = await mkEvent(db, t, 'e-c');
    const g = await mkGuest(db, t, e, 'G');
    const id = (await db.query<{ id: string }>(
      `INSERT INTO rsvp_change_requests (tenant_id, event_id, guest_id, old_rsvp_status, new_rsvp_status, status) VALUES ($1, $2, $3, 'pending', 'attending', 'pending') RETURNING id`,
      [t, e, g])).rows[0]!.id;
    const u = '00000000-0000-0000-0000-000000002910';
    await mkMember(db, t, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE rsvp_change_requests SET status='approved', reviewed_by=$2, reviewed_at=now() WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`,
      [id, u]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });
});
