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
async function mkItem(db: TestDb, tenant: string, name='Round Table'): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO inventory_items (tenant_id, name, quantity_total, quantity_in_stock)
     VALUES ($1,$2, 100, 100) RETURNING id`, [tenant, name])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1,$2,'M','event_manager') RETURNING id`, [tenant, email])).rows[0]!.id;
}

describe('inventory_allocations — schema correctness (Phase 3 Unit 30)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid allocation', async () => {
    const t = await mkTenant(db, 'ia-aaa');
    const e = await mkEvent(db, t);
    const i = await mkItem(db, t);
    await db.query(
      `INSERT INTO inventory_allocations (tenant_id, inventory_item_id, event_id, quantity) VALUES ($1,$2,$3,30)`, [t, i, e]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM inventory_allocations`)).rows[0]!.c).toBe(1);
  });

  it('quantity must be > 0', async () => {
    const t = await mkTenant(db, 'ia-bbb');
    const e = await mkEvent(db, t);
    const i = await mkItem(db, t);
    const err = await tryExec(db,
      `INSERT INTO inventory_allocations (tenant_id, inventory_item_id, event_id, quantity) VALUES ($1,$2,$3,0)`, [t, i, e]);
    expect(err).toMatch(/quantity|check/i);
  });

  it('qty invariant: damaged+lost+returned > quantity rejected', async () => {
    const t = await mkTenant(db, 'ia-ccc');
    const e = await mkEvent(db, t);
    const i = await mkItem(db, t);
    const err = await tryExec(db,
      `INSERT INTO inventory_allocations (tenant_id, inventory_item_id, event_id, quantity, quantity_damaged, quantity_lost, quantity_returned)
       VALUES ($1,$2,$3, 10, 5, 5, 5)`, [t, i, e]);
    expect(err).toMatch(/qty_invariant|check/i);
  });

  it('dispatched requires dispatched_at', async () => {
    const t = await mkTenant(db, 'ia-ddd');
    const e = await mkEvent(db, t);
    const i = await mkItem(db, t);
    const err = await tryExec(db,
      `INSERT INTO inventory_allocations (tenant_id, inventory_item_id, event_id, quantity, status)
       VALUES ($1,$2,$3, 10, 'dispatched')`, [t, i, e]);
    expect(err).toMatch(/check/i);
  });

  it('returned requires both dispatched_at and returned_at and ordering', async () => {
    const t = await mkTenant(db, 'ia-eee');
    const e = await mkEvent(db, t);
    const i = await mkItem(db, t);
    const err = await tryExec(db,
      `INSERT INTO inventory_allocations (tenant_id, inventory_item_id, event_id, quantity, status, dispatched_at, returned_at)
       VALUES ($1,$2,$3, 10, 'returned', now(), now() - interval '1 hour')`, [t, i, e]);
    expect(err).toMatch(/check/i);
  });

  it('damaged requires quantity_damaged>0 and damage_notes', async () => {
    const t = await mkTenant(db, 'ia-fff');
    const e = await mkEvent(db, t);
    const i = await mkItem(db, t);
    const err = await tryExec(db,
      `INSERT INTO inventory_allocations (tenant_id, inventory_item_id, event_id, quantity, status)
       VALUES ($1,$2,$3, 10, 'damaged')`, [t, i, e]);
    expect(err).toMatch(/check/i);
  });

  it('damage_cost requires quantity_damaged>0', async () => {
    const t = await mkTenant(db, 'ia-ggg');
    const e = await mkEvent(db, t);
    const i = await mkItem(db, t);
    const err = await tryExec(db,
      `INSERT INTO inventory_allocations (tenant_id, inventory_item_id, event_id, quantity, damage_cost, damage_currency)
       VALUES ($1,$2,$3, 10, 500.00, 'INR')`, [t, i, e]);
    expect(err).toMatch(/check/i);
  });

  it('damage_cost without currency rejected', async () => {
    const t = await mkTenant(db, 'ia-hhh');
    const e = await mkEvent(db, t);
    const i = await mkItem(db, t);
    const err = await tryExec(db,
      `INSERT INTO inventory_allocations (tenant_id, inventory_item_id, event_id, quantity, quantity_damaged, damage_notes, damage_cost)
       VALUES ($1,$2,$3, 10, 2, 'spilled', 500.00)`, [t, i, e]);
    expect(err).toMatch(/damage_cost_coupling|check/i);
  });

  it('cross-tenant: item from another tenant rejected', async () => {
    const t1 = await mkTenant(db, 'ia-ttt');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'ia-uuu');
    const iOther = await mkItem(db, t2);
    const err = await tryExec(db,
      `INSERT INTO inventory_allocations (tenant_id, inventory_item_id, event_id, quantity) VALUES ($1,$2,$3, 5)`, [t1, iOther, e1]);
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('cross-tenant allocator member rejected', async () => {
    const t1 = await mkTenant(db, 'ia-vvv');
    const e1 = await mkEvent(db, t1);
    const i1 = await mkItem(db, t1);
    const t2 = await mkTenant(db, 'ia-www');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(db,
      `INSERT INTO inventory_allocations (tenant_id, inventory_item_id, event_id, quantity, allocated_by)
       VALUES ($1,$2,$3, 5, $4)`, [t1, i1, e1, mOther]);
    expect(err).toMatch(/allocated_by|tenant/i);
  });

  it('returned happy path with full splits', async () => {
    const t = await mkTenant(db, 'ia-xxx');
    const e = await mkEvent(db, t);
    const i = await mkItem(db, t);
    await db.query(
      `INSERT INTO inventory_allocations (tenant_id, inventory_item_id, event_id, quantity, quantity_damaged, quantity_lost, quantity_returned, status, allocated_at, dispatched_at, returned_at, damage_notes)
       VALUES ($1,$2,$3, 30, 2, 1, 27, 'returned', now() - interval '3 hours', now() - interval '2 hours', now() - interval '30 minutes', 'two chairs cracked')`,
      [t, i, e]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM inventory_allocations WHERE status='returned'`)).rows[0]!.c).toBe(1);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'ia-zzz');
    const e = await mkEvent(db, t);
    const i = await mkItem(db, t);
    await db.query(`INSERT INTO inventory_allocations (tenant_id, inventory_item_id, event_id, quantity) VALUES ($1,$2,$3, 5)`, [t, i, e]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM inventory_allocations`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM inventory_allocations`)).rows.length);
    expect(svc).toBe(1);
  });
});
