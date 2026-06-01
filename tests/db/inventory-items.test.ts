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

describe('inventory_items — schema correctness (Phase 3 Unit 29)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid item', async () => {
    const t = await mkTenant(db, 'inv-aaa');
    await db.query(
      `INSERT INTO inventory_items (tenant_id, name, category, sku, quantity_total, quantity_in_stock, unit_cost, currency_code)
       VALUES ($1,'Round Table 8-seater','tables','RT-8', 50, 50, 12500.00, 'INR')`, [t]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM inventory_items`)).rows[0]!.c).toBe(1);
  });

  it('rejects bad category', async () => {
    const t = await mkTenant(db, 'inv-bbb');
    const err = await tryExec(db,
      `INSERT INTO inventory_items (tenant_id, name, category) VALUES ($1,'X','spaceship')`, [t]);
    expect(err).toMatch(/category|check/i);
  });

  it('qty invariant: in_stock + in_use + damaged > total rejected', async () => {
    const t = await mkTenant(db, 'inv-ccc');
    const err = await tryExec(db,
      `INSERT INTO inventory_items (tenant_id, name, quantity_total, quantity_in_stock, quantity_in_use)
       VALUES ($1,'X', 100, 60, 50)`, [t]);
    expect(err).toMatch(/qty_invariant|check/i);
  });

  it('qty invariant: equal-to-total allowed', async () => {
    const t = await mkTenant(db, 'inv-ddd');
    await db.query(
      `INSERT INTO inventory_items (tenant_id, name, quantity_total, quantity_in_stock, quantity_in_use, quantity_damaged)
       VALUES ($1,'X', 100, 60, 30, 10)`, [t]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM inventory_items`)).rows[0]!.c).toBe(1);
  });

  it('cost without currency rejected', async () => {
    const t = await mkTenant(db, 'inv-eee');
    const err = await tryExec(db,
      `INSERT INTO inventory_items (tenant_id, name, unit_cost) VALUES ($1,'X', 100.00)`, [t]);
    expect(err).toMatch(/cost_currency|check/i);
  });

  it('retired requires retired_at', async () => {
    const t = await mkTenant(db, 'inv-fff');
    const err = await tryExec(db,
      `INSERT INTO inventory_items (tenant_id, name, status) VALUES ($1,'X','retired')`, [t]);
    expect(err).toMatch(/retired_coupling|check/i);
  });

  it('partial UNIQUE sku per tenant (case-insensitive)', async () => {
    const t = await mkTenant(db, 'inv-ggg');
    await db.query(`INSERT INTO inventory_items (tenant_id, name, sku) VALUES ($1,'A','RT-8')`, [t]);
    const err = await tryExec(db,
      `INSERT INTO inventory_items (tenant_id, name, sku) VALUES ($1,'B','rt-8')`, [t]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('same sku in two tenants allowed', async () => {
    const t1 = await mkTenant(db, 'inv-hhh');
    const t2 = await mkTenant(db, 'inv-iii');
    await db.query(`INSERT INTO inventory_items (tenant_id, name, sku) VALUES ($1,'A','RT-8')`, [t1]);
    await db.query(`INSERT INTO inventory_items (tenant_id, name, sku) VALUES ($1,'A','RT-8')`, [t2]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM inventory_items WHERE sku='RT-8'`)).rows[0]!.c).toBe(2);
  });

  it('rejects bad sku format', async () => {
    const t = await mkTenant(db, 'inv-jjj');
    const err = await tryExec(db,
      `INSERT INTO inventory_items (tenant_id, name, sku) VALUES ($1,'X','sku with spaces')`, [t]);
    expect(err).toMatch(/sku|check/i);
  });

  it('rejects non-https image_url', async () => {
    const t = await mkTenant(db, 'inv-kkk');
    const err = await tryExec(db,
      `INSERT INTO inventory_items (tenant_id, name, image_url) VALUES ($1,'X','http://insecure/x.jpg')`, [t]);
    expect(err).toMatch(/image_url|check/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'inv-www');
    await db.query(`INSERT INTO inventory_items (tenant_id, name) VALUES ($1,'X')`, [t]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM inventory_items`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM inventory_items`)).rows.length);
    expect(svc).toBe(1);
  });
});
