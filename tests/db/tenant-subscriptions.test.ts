/**
 * tenant_subscriptions — Phase 2 Unit 3 (spec 3.2 + 3.14.1 currency lock).
 */
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

async function newTenant(db: TestDb, slug = 'sub-co') {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Sub Co','INR') RETURNING id`,
      [slug],
    )
  ).rows[0]!.id;
}
async function newPlan(db: TestDb, code = 'growth') {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO subscription_plans (code, name) VALUES ($1,'P') RETURNING id`,
      [code],
    )
  ).rows[0]!.id;
}

describe('tenant_subscriptions — schema correctness (Phase 2 Unit 3)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a trial subscription', async () => {
    const t = await newTenant(db);
    const p = await newPlan(db);
    await db.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_currency, billing_cycle, gateway_currency_locked, trial_ends_at)
       VALUES ($1, $2, 'INR', 'monthly', 'INR', now() + interval '14 days')`,
      [t, p],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_subscriptions`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('UNIQUE (tenant_id) blocks two subscriptions per tenant', async () => {
    const t = await newTenant(db);
    const p = await newPlan(db);
    await db.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_currency, billing_cycle, gateway_currency_locked, trial_ends_at)
       VALUES ($1, $2, 'INR', 'monthly', 'INR', now() + interval '14 days')`,
      [t, p],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_currency, billing_cycle, gateway_currency_locked, trial_ends_at)
       VALUES ($1, $2, 'INR', 'yearly', 'INR', now() + interval '14 days')`,
      [t, p],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('currency-lock CHECK: gateway_currency_locked must equal billing_currency', async () => {
    const t = await newTenant(db);
    const p = await newPlan(db);
    const err = await tryExec(
      db,
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_currency, billing_cycle, gateway_currency_locked, trial_ends_at)
       VALUES ($1, $2, 'INR', 'monthly', 'USD', now() + interval '14 days')`,
      [t, p],
    );
    expect(err).toMatch(/currency_lock|check/i);
  });

  it('trial status requires trial_ends_at', async () => {
    const t = await newTenant(db);
    const p = await newPlan(db);
    const err = await tryExec(
      db,
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_currency, billing_cycle, gateway_currency_locked)
       VALUES ($1, $2, 'INR', 'monthly', 'INR')`,
      [t, p],
    );
    expect(err).toMatch(/check/i);
  });

  it('cancelled status requires cancelled_at', async () => {
    const t = await newTenant(db);
    const p = await newPlan(db);
    await db.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_currency, billing_cycle, gateway_currency_locked, status, current_period_start, current_period_end)
       VALUES ($1, $2, 'INR', 'monthly', 'INR', 'active', now() - interval '1 day', now() + interval '30 days')`,
      [t, p],
    );
    const err = await tryExec(
      db,
      `UPDATE tenant_subscriptions SET status = 'cancelled' WHERE tenant_id = $1`,
      [t],
    );
    expect(err).toMatch(/cancelled|check/i);
  });

  it('paused status requires both paused_at and pause_resume_at', async () => {
    const t = await newTenant(db);
    const p = await newPlan(db);
    await db.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_currency, billing_cycle, gateway_currency_locked, status, current_period_start, current_period_end)
       VALUES ($1, $2, 'INR', 'monthly', 'INR', 'active', now() - interval '1 day', now() + interval '30 days')`,
      [t, p],
    );
    const err = await tryExec(
      db,
      `UPDATE tenant_subscriptions SET status = 'paused', paused_at = now() WHERE tenant_id = $1`,
      [t],
    );
    expect(err).toMatch(/paused|check/i);
  });

  it('CASCADE from tenants', async () => {
    const t = await newTenant(db);
    const p = await newPlan(db);
    await db.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_currency, billing_cycle, gateway_currency_locked, trial_ends_at)
       VALUES ($1, $2, 'INR', 'monthly', 'INR', now() + interval '14 days')`,
      [t, p],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_subscriptions`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RESTRICT from subscription_plans (cannot drop a plan in use)', async () => {
    const t = await newTenant(db);
    const p = await newPlan(db);
    await db.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_currency, billing_cycle, gateway_currency_locked, trial_ends_at)
       VALUES ($1, $2, 'INR', 'monthly', 'INR', now() + interval '14 days')`,
      [t, p],
    );
    const err = await tryExec(db, `DELETE FROM subscription_plans WHERE id = $1`, [p]);
    expect(err).toMatch(/foreign key|restrict|violates/i);
  });

  it('RLS pair', async () => {
    const t = await newTenant(db);
    const p = await newPlan(db);
    await db.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_currency, billing_cycle, gateway_currency_locked, trial_ends_at)
       VALUES ($1, $2, 'INR', 'monthly', 'INR', now() + interval '14 days')`,
      [t, p],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_subscriptions`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_subscriptions`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
