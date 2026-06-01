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
async function mkEventAndItem(db: TestDb, tenantId: string, code: string): Promise<{ eventId: string; itemId: string }> {
  const etId = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'wedding-' || $2, 'W', FALSE) RETURNING id`,
    [tenantId, code])).rows[0]!.id;
  const eid = (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, $3, 'E', '2026-12-01', '2026-12-03', 'INR') RETURNING id`, [tenantId, etId, code])).rows[0]!.id;
  const itemId = (await db.query<{ id: string }>(
    `INSERT INTO event_type_readiness_items (event_type_id, label, weight, sort_order)
     VALUES ($1, 'Venue Confirmed', 1, 1) RETURNING id`, [etId])).rows[0]!.id;
  return { eventId: eid, itemId };
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on event_readiness_state (Phase 12 Unit 73)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('member sees own tenant readiness state only', async () => {
    const t1 = await mkTenant(db, 'rrs-aaa');
    const t2 = await mkTenant(db, 'rrs-bbb');
    const u1 = '00000000-0000-0000-0000-000000000600';
    await mkMember(db, t1, u1, 'a@y.dev');
    const a = await mkEventAndItem(db, t1, 'e-a');
    const b = await mkEventAndItem(db, t2, 'e-b');
    await db.query(`INSERT INTO event_readiness_state (event_id, item_id, is_complete, completed_at) VALUES ($1, $2, TRUE, now())`, [a.eventId, a.itemId]);
    await db.query(`INSERT INTO event_readiness_state (event_id, item_id, is_complete) VALUES ($1, $2, FALSE)`, [b.eventId, b.itemId]);
    await setCtx(db, u1, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ event_id: string }>(`SELECT event_id FROM event_readiness_state`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });

  it('anon sees zero', async () => {
    const t = await mkTenant(db, 'rrs-ccc');
    const a = await mkEventAndItem(db, t, 'e-c');
    await db.query(`INSERT INTO event_readiness_state (event_id, item_id, is_complete) VALUES ($1, $2, FALSE)`, [a.eventId, a.itemId]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ event_id: string }>(`SELECT event_id FROM event_readiness_state`)).rows.length);
    expect(n).toBe(0);
  });

  it('team_member can toggle (UPDATE)', async () => {
    const t = await mkTenant(db, 'rrs-ddd');
    const u = '00000000-0000-0000-0000-000000000610';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    const a = await mkEventAndItem(db, t, 'e-d');
    await db.query(`INSERT INTO event_readiness_state (event_id, item_id, is_complete) VALUES ($1, $2, FALSE)`, [a.eventId, a.itemId]);
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE event_readiness_state SET is_complete=TRUE, completed_at=now() WHERE event_id=$1 RETURNING event_id) SELECT count(*)::int AS c FROM u`,
      [a.eventId]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });

  it('team_member cannot DELETE', async () => {
    const t = await mkTenant(db, 'rrs-eee');
    const u = '00000000-0000-0000-0000-000000000620';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    const a = await mkEventAndItem(db, t, 'e-e');
    await db.query(`INSERT INTO event_readiness_state (event_id, item_id, is_complete) VALUES ($1, $2, FALSE)`, [a.eventId, a.itemId]);
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH d AS (DELETE FROM event_readiness_state WHERE event_id=$1 RETURNING event_id) SELECT count(*)::int AS c FROM d`,
      [a.eventId]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });
});
