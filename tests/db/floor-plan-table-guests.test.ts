import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenant: string, code='evt-001'): Promise<string> {
  const ty = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'W', FALSE) RETURNING id`, [tenant])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`, [tenant, ty, code])).rows[0]!.id;
}
async function mkPlan(db: TestDb, tenant: string, event: string, name='Main Hall'): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO floor_plans (tenant_id, event_id, name, canvas) VALUES ($1,$2,$3,'{}'::jsonb) RETURNING id`,
    [tenant, event, name])).rows[0]!.id;
}
async function mkTable(db: TestDb, tenant: string, plan: string, event: string, num='A1'): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, seat_count, position_x, position_y)
     VALUES ($1,$2,$3,$4, 10, 0, 0) RETURNING id`, [tenant, plan, event, num])).rows[0]!.id;
}
async function mkGuest(db: TestDb, tenant: string, event: string, name='G'): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO guests (tenant_id, event_id, name) VALUES ($1,$2,$3) RETURNING id`, [tenant, event, name])).rows[0]!.id;
}

describe('floor_plan_table_guests — schema correctness (Phase 3 Unit 34)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid seating assignment', async () => {
    const t = await mkTenant(db, 'fptg-aaa');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    const tb = await mkTable(db, t, p, e);
    const g = await mkGuest(db, t, e);
    await db.query(
      `INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id, seat_number)
       VALUES ($1,$2,$3,$4, 3)`, [tb, g, t, e]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM floor_plan_table_guests`)).rows[0]!.c).toBe(1);
  });

  it('composite PK blocks dupe (table, guest)', async () => {
    const t = await mkTenant(db, 'fptg-bbb');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    const tb = await mkTable(db, t, p, e);
    const g = await mkGuest(db, t, e);
    await db.query(`INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id) VALUES ($1,$2,$3,$4)`, [tb, g, t, e]);
    const err = await tryExec(db,
      `INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id) VALUES ($1,$2,$3,$4)`, [tb, g, t, e]);
    expect(err).toMatch(/duplicate|primary|already seated/i);
  });

  it('partial UNIQUE blocks two guests on same seat_number of same table', async () => {
    const t = await mkTenant(db, 'fptg-ccc');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    const tb = await mkTable(db, t, p, e);
    const g1 = await mkGuest(db, t, e, 'G1');
    const g2 = await mkGuest(db, t, e, 'G2');
    await db.query(`INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id, seat_number) VALUES ($1,$2,$3,$4, 1)`, [tb, g1, t, e]);
    const err = await tryExec(db,
      `INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id, seat_number) VALUES ($1,$2,$3,$4, 1)`, [tb, g2, t, e]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('multiple NULL seat_number on same table allowed', async () => {
    const t = await mkTenant(db, 'fptg-ddd');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    const tb = await mkTable(db, t, p, e);
    const g1 = await mkGuest(db, t, e, 'G1');
    const g2 = await mkGuest(db, t, e, 'G2');
    await db.query(`INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id) VALUES ($1,$2,$3,$4)`, [tb, g1, t, e]);
    await db.query(`INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id) VALUES ($1,$2,$3,$4)`, [tb, g2, t, e]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM floor_plan_table_guests`)).rows[0]!.c).toBe(2);
  });

  it('per-plan uniqueness: same guest on two tables of SAME plan rejected', async () => {
    const t = await mkTenant(db, 'fptg-eee');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    const tb1 = await mkTable(db, t, p, e, 'A1');
    const tb2 = await mkTable(db, t, p, e, 'B2');
    const g = await mkGuest(db, t, e);
    await db.query(`INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id) VALUES ($1,$2,$3,$4)`, [tb1, g, t, e]);
    const err = await tryExec(db,
      `INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id) VALUES ($1,$2,$3,$4)`, [tb2, g, t, e]);
    expect(err).toMatch(/already seated|plan/i);
  });

  it('same guest across TWO plans (same event) allowed', async () => {
    const t = await mkTenant(db, 'fptg-fff');
    const e = await mkEvent(db, t);
    const p1 = await mkPlan(db, t, e, 'Plan A');
    const p2 = await mkPlan(db, t, e, 'Plan B');
    const tb1 = await mkTable(db, t, p1, e);
    const tb2 = await mkTable(db, t, p2, e);
    const g = await mkGuest(db, t, e);
    await db.query(`INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id) VALUES ($1,$2,$3,$4)`, [tb1, g, t, e]);
    await db.query(`INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id) VALUES ($1,$2,$3,$4)`, [tb2, g, t, e]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM floor_plan_table_guests WHERE guest_id=$1`, [g])).rows[0]!.c).toBe(2);
  });

  it('seat_number > 100 rejected', async () => {
    const t = await mkTenant(db, 'fptg-ggg');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    const tb = await mkTable(db, t, p, e);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(db,
      `INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id, seat_number) VALUES ($1,$2,$3,$4, 200)`, [tb, g, t, e]);
    expect(err).toMatch(/seat|check/i);
  });

  it('cross-tenant guest rejected', async () => {
    const t1 = await mkTenant(db, 'fptg-ttt');
    const e1 = await mkEvent(db, t1);
    const p1 = await mkPlan(db, t1, e1);
    const tb1 = await mkTable(db, t1, p1, e1);
    const t2 = await mkTenant(db, 'fptg-uuu');
    const e2 = await mkEvent(db, t2);
    const gOther = await mkGuest(db, t2, e2);
    const err = await tryExec(db,
      `INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id) VALUES ($1,$2,$3,$4)`, [tb1, gOther, t1, e1]);
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('cross-event guest rejected (same tenant)', async () => {
    const t = await mkTenant(db, 'fptg-vvv');
    const e1 = await mkEvent(db, t, 'evt-aaa');
    const e2 = await mkEvent(db, t, 'evt-bbb');
    const p1 = await mkPlan(db, t, e1);
    const tb1 = await mkTable(db, t, p1, e1);
    const gOnE2 = await mkGuest(db, t, e2);
    const err = await tryExec(db,
      `INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id) VALUES ($1,$2,$3,$4)`, [tb1, gOnE2, t, e1]);
    expect(err).toMatch(/event|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'fptg-xxx');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    const tb = await mkTable(db, t, p, e);
    const g = await mkGuest(db, t, e);
    await db.query(`INSERT INTO floor_plan_table_guests (table_id, guest_id, tenant_id, event_id) VALUES ($1,$2,$3,$4)`, [tb, g, t, e]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ guest_id: string }>(`SELECT guest_id FROM floor_plan_table_guests`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ guest_id: string }>(`SELECT guest_id FROM floor_plan_table_guests`)).rows.length);
    expect(svc).toBe(1);
  });
});
