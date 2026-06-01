import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params);
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`,
      [slug],
    )
  ).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenant: string, code = 'evt-001'): Promise<string> {
  const ty = (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'W', FALSE) RETURNING id`,
      [tenant],
    )
  ).rows[0]!.id;
  return (
    await db.query<{ id: string }>(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`,
      [tenant, ty, code],
    )
  ).rows[0]!.id;
}
async function mkPlan(
  db: TestDb,
  tenant: string,
  event: string,
  name = 'Main Hall',
): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO floor_plans (tenant_id, event_id, name, canvas) VALUES ($1,$2,$3,'{}'::jsonb) RETURNING id`,
      [tenant, event, name],
    )
  ).rows[0]!.id;
}

describe('floor_plan_tables — schema correctness (Phase 3 Unit 33)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid round table', async () => {
    const t = await mkTenant(db, 'fpt-aaa');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    await db.query(
      `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, table_shape, seat_count, position_x, position_y)
       VALUES ($1,$2,$3,'A1','round', 10, 100.50, 200.25)`,
      [t, p, e],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM floor_plan_tables`)).rows[0]!
        .c,
    ).toBe(1);
  });

  it('rejects bad table_shape', async () => {
    const t = await mkTenant(db, 'fpt-bbb');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, table_shape, seat_count, position_x, position_y)
       VALUES ($1,$2,$3,'A1','octagonal', 8, 0, 0)`,
      [t, p, e],
    );
    expect(err).toMatch(/shape|check/i);
  });

  it('seat_count must be > 0 and <= 100', async () => {
    const t = await mkTenant(db, 'fpt-ccc');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    const err1 = await tryExec(
      db,
      `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, seat_count, position_x, position_y)
       VALUES ($1,$2,$3,'A1', 0, 0, 0)`,
      [t, p, e],
    );
    expect(err1).toMatch(/seat_count|check/i);
    const err2 = await tryExec(
      db,
      `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, seat_count, position_x, position_y)
       VALUES ($1,$2,$3,'A2', 200, 0, 0)`,
      [t, p, e],
    );
    expect(err2).toMatch(/seat_count|check/i);
  });

  it('rotation must be 0-360 (exclusive of 360)', async () => {
    const t = await mkTenant(db, 'fpt-ddd');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, seat_count, position_x, position_y, rotation_deg)
       VALUES ($1,$2,$3,'A1', 8, 0, 0, 360)`,
      [t, p, e],
    );
    expect(err).toMatch(/rotation|check/i);
  });

  it('partial UNIQUE blocks dupe table_number (case-fold)', async () => {
    const t = await mkTenant(db, 'fpt-eee');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    await db.query(
      `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, seat_count, position_x, position_y)
       VALUES ($1,$2,$3,'A1', 8, 0, 0)`,
      [t, p, e],
    );
    const err = await tryExec(
      db,
      `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, seat_count, position_x, position_y)
       VALUES ($1,$2,$3,'a1', 8, 50, 50)`,
      [t, p, e],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('same table_number on TWO plans (same event) allowed', async () => {
    const t = await mkTenant(db, 'fpt-fff');
    const e = await mkEvent(db, t);
    const p1 = await mkPlan(db, t, e, 'Plan A');
    const p2 = await mkPlan(db, t, e, 'Plan B');
    await db.query(
      `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, seat_count, position_x, position_y)
       VALUES ($1,$2,$3,'A1', 8, 0, 0)`,
      [t, p1, e],
    );
    await db.query(
      `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, seat_count, position_x, position_y)
       VALUES ($1,$2,$3,'A1', 8, 0, 0)`,
      [t, p2, e],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM floor_plan_tables`)).rows[0]!
        .c,
    ).toBe(2);
  });

  it('cross-tenant plan rejected', async () => {
    const t1 = await mkTenant(db, 'fpt-ttt');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'fpt-uuu');
    const e2 = await mkEvent(db, t2);
    const pOther = await mkPlan(db, t2, e2);
    const err = await tryExec(
      db,
      `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, seat_count, position_x, position_y)
       VALUES ($1,$2,$3,'A1', 8, 0, 0)`,
      [t1, pOther, e1],
    );
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('plan event mismatch rejected', async () => {
    const t = await mkTenant(db, 'fpt-ggg');
    const e1 = await mkEvent(db, t, 'evt-aaa');
    const e2 = await mkEvent(db, t, 'evt-bbb');
    const pOnE2 = await mkPlan(db, t, e2);
    const err = await tryExec(
      db,
      `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, seat_count, position_x, position_y)
       VALUES ($1,$2,$3,'A1', 8, 0, 0)`,
      [t, pOnE2, e1],
    );
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('width/height must be > 0', async () => {
    const t = await mkTenant(db, 'fpt-hhh');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, seat_count, position_x, position_y, width)
       VALUES ($1,$2,$3,'A1', 8, 0, 0, -5)`,
      [t, p, e],
    );
    expect(err).toMatch(/width|check/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'fpt-xxx');
    const e = await mkEvent(db, t);
    const p = await mkPlan(db, t, e);
    await db.query(
      `INSERT INTO floor_plan_tables (tenant_id, floor_plan_id, event_id, table_number, seat_count, position_x, position_y)
       VALUES ($1,$2,$3,'A1', 8, 0, 0)`,
      [t, p, e],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM floor_plan_tables`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM floor_plan_tables`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
