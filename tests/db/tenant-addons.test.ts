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
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency)
     VALUES ($1, 'Acme', 'INR') RETURNING id`,
    [slug],
  );
  return r.rows[0]!.id;
}

async function mkAddon(db: TestDb, code: string, category = 'capacity'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO addons_catalog (code, name, category) VALUES ($1, $2, $3) RETURNING id`,
    [code, code, category],
  );
  return r.rows[0]!.id;
}

describe('tenant_addons — schema correctness (Phase 2 Unit 11)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts an active subscription', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkAddon(db, 'extra_events');
    await db.query(`INSERT INTO tenant_addons (tenant_id, addon_id) VALUES ($1, $2)`, [t, a]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_addons`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects quantity = 0 and quantity > 1000', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkAddon(db, 'extra_events');
    const e1 = await tryExec(
      db,
      `INSERT INTO tenant_addons (tenant_id, addon_id, quantity) VALUES ($1, $2, 0)`,
      [t, a],
    );
    expect(e1).toMatch(/qty_bounds|quantity|check/i);
    const e2 = await tryExec(
      db,
      `INSERT INTO tenant_addons (tenant_id, addon_id, quantity) VALUES ($1, $2, 1001)`,
      [t, a],
    );
    expect(e2).toMatch(/qty_bounds|quantity|check/i);
  });

  it('rejects bogus status', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkAddon(db, 'extra_events');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_addons (tenant_id, addon_id, status) VALUES ($1, $2, 'frozen')`,
      [t, a],
    );
    expect(err).toMatch(/status|check/i);
  });

  it("rejects 'cancelled' without cancelled_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkAddon(db, 'extra_events');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_addons (tenant_id, addon_id, status) VALUES ($1, $2, 'cancelled')`,
      [t, a],
    );
    expect(err).toMatch(/cancelled|check/i);
  });

  it('rejects period_end <= period_start', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkAddon(db, 'extra_events');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_addons (tenant_id, addon_id, current_period_start, current_period_end)
       VALUES ($1, $2, now(), now() - interval '1 hour')`,
      [t, a],
    );
    expect(err).toMatch(/period|check/i);
  });

  it('partial UNIQUE: blocks two active subs of same addon per tenant', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkAddon(db, 'extra_events');
    await db.query(`INSERT INTO tenant_addons (tenant_id, addon_id) VALUES ($1, $2)`, [t, a]);
    const err = await tryExec(
      db,
      `INSERT INTO tenant_addons (tenant_id, addon_id) VALUES ($1, $2)`,
      [t, a],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('cancelled sub does not block a new active one', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkAddon(db, 'extra_events');
    await db.query(
      `INSERT INTO tenant_addons (tenant_id, addon_id, status, cancelled_at)
       VALUES ($1, $2, 'cancelled', now())`,
      [t, a],
    );
    await db.query(`INSERT INTO tenant_addons (tenant_id, addon_id) VALUES ($1, $2)`, [t, a]);
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM tenant_addons WHERE tenant_id = $1`,
        [t],
      )
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('RESTRICT on addons_catalog: deleting catalog row in use is blocked', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkAddon(db, 'extra_events');
    await db.query(`INSERT INTO tenant_addons (tenant_id, addon_id) VALUES ($1, $2)`, [t, a]);
    const err = await tryExec(db, `DELETE FROM addons_catalog WHERE id = $1`, [a]);
    expect(err).toMatch(/foreign key|restrict/i);
  });

  it('CASCADE: deleting tenant removes its addon subs', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkAddon(db, 'extra_events');
    await db.query(`INSERT INTO tenant_addons (tenant_id, addon_id) VALUES ($1, $2)`, [t, a]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_addons`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkAddon(db, 'extra_events');
    await db.query(`INSERT INTO tenant_addons (tenant_id, addon_id) VALUES ($1, $2)`, [t, a]);
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM tenant_addons`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM tenant_addons`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
