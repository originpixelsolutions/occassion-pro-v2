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
async function mkTicket(db: TestDb, tenantId: string, eventId: string, name: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, price, currency_code, quantity_sold, quantity_reserved, min_per_order)
     VALUES ($1, $2, 'general', $3, 100, 'INR', 0, 0, 1) RETURNING id`, [tenantId, eventId, name])).rows[0]!.id;
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on event_tickets (Phase 12 Unit 75)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('member sees own tenant tickets only', async () => {
    const t1 = await mkTenant(db, 'rt-aaa');
    const t2 = await mkTenant(db, 'rt-bbb');
    const e1 = await mkEvent(db, t1, 'e-a');
    const e2 = await mkEvent(db, t2, 'e-b');
    await mkTicket(db, t1, e1, 'Gold');
    await mkTicket(db, t2, e2, 'Silver');
    const u = '00000000-0000-0000-0000-000000000800';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const names = (await db.query<{ name: string }>(`SELECT name FROM event_tickets`)).rows.map(r => r.name);
    await asSuperuser(db);
    expect(names).toEqual(['Gold']);
  });

  it('anon sees zero', async () => {
    const t = await mkTenant(db, 'rt-ccc');
    const e = await mkEvent(db, t, 'e-c');
    await mkTicket(db, t, e, 'X');
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM event_tickets`)).rows.length);
    expect(n).toBe(0);
  });

  it('owner can INSERT', async () => {
    const t = await mkTenant(db, 'rt-ddd');
    const e = await mkEvent(db, t, 'e-d');
    const u = '00000000-0000-0000-0000-000000000810';
    await mkMember(db, t, u, 'o@y.dev', 'owner');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, price, currency_code, quantity_sold, quantity_reserved, min_per_order)
       VALUES ($1, $2, 'general', 'VIP', 500, 'INR', 0, 0, 1)`, [t, e]);
    await asSuperuser(db);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_tickets WHERE name='VIP'`)).rows[0]!.c).toBe(1);
  });

  it('team_member cannot INSERT', async () => {
    const t = await mkTenant(db, 'rt-eee');
    const e = await mkEvent(db, t, 'e-e');
    const u = '00000000-0000-0000-0000-000000000820';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, price, currency_code, quantity_sold, quantity_reserved, min_per_order)
       VALUES ($1, $2, 'general', 'X', 100, 'INR', 0, 0, 1)`, [t, e]); }
    catch (e2) { err = e2 instanceof Error ? e2.message : String(e2); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });
});
