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

describe('tenant_cohort_metrics — schema correctness (Phase 2 Unit 40)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid cohort row', async () => {
    await db.query(
      `INSERT INTO tenant_cohort_metrics
         (cohort_month, measurement_month, tenants_signed_up, tenants_converted, tenants_still_active, tenants_churned, total_mrr, total_arr, net_revenue_retention, gross_revenue_retention)
       VALUES ('2026-01-01', '2026-06-01', 100, 80, 70, 10, 5000, 60000, 110.50, 87.50)`,
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_cohort_metrics`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects cohort_month not first-of-month', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO tenant_cohort_metrics (cohort_month, measurement_month)
       VALUES ('2026-01-15', '2026-06-01')`,
    );
    expect(err).toMatch(/cohort_first|check/i);
  });

  it('rejects measurement_month before cohort_month', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO tenant_cohort_metrics (cohort_month, measurement_month)
       VALUES ('2026-06-01', '2026-01-01')`,
    );
    expect(err).toMatch(/measurement_after_cohort|check/i);
  });

  it('rejects tenants_converted > tenants_signed_up', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO tenant_cohort_metrics (cohort_month, measurement_month, tenants_signed_up, tenants_converted)
       VALUES ('2026-01-01', '2026-06-01', 50, 80)`,
    );
    expect(err).toMatch(/converted_under_signed|check/i);
  });

  it('rejects (still_active + churned) > converted', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO tenant_cohort_metrics
         (cohort_month, measurement_month, tenants_signed_up, tenants_converted, tenants_still_active, tenants_churned)
       VALUES ('2026-01-01', '2026-06-01', 100, 80, 70, 20)`,
    );
    expect(err).toMatch(/active_churned|check/i);
  });

  it('rejects NRR > 200', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO tenant_cohort_metrics (cohort_month, measurement_month, net_revenue_retention)
       VALUES ('2026-01-01', '2026-06-01', 250)`,
    );
    expect(err).toMatch(/nrr_bounds|check/i);
  });

  it('accepts NRR > 100 (expansion revenue)', async () => {
    await db.query(
      `INSERT INTO tenant_cohort_metrics (cohort_month, measurement_month, net_revenue_retention)
       VALUES ('2026-01-01', '2026-06-01', 125)`,
    );
    const r = await db.query<{ net_revenue_retention: string }>(
      `SELECT net_revenue_retention FROM tenant_cohort_metrics`,
    );
    expect(Number(r.rows[0]!.net_revenue_retention)).toBe(125);
  });

  it('rejects GRR > 100', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO tenant_cohort_metrics (cohort_month, measurement_month, gross_revenue_retention)
       VALUES ('2026-01-01', '2026-06-01', 105)`,
    );
    expect(err).toMatch(/grr_bounds|check/i);
  });

  it('composite PK blocks duplicate (cohort, measurement)', async () => {
    await db.query(
      `INSERT INTO tenant_cohort_metrics (cohort_month, measurement_month) VALUES ('2026-01-01', '2026-06-01')`,
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_cohort_metrics (cohort_month, measurement_month) VALUES ('2026-01-01', '2026-06-01')`,
    );
    expect(err).toMatch(/duplicate|primary key|unique/i);
  });

  it('same cohort, multiple measurement months coexist', async () => {
    await db.query(
      `INSERT INTO tenant_cohort_metrics (cohort_month, measurement_month) VALUES
         ('2026-01-01', '2026-01-01'),
         ('2026-01-01', '2026-02-01'),
         ('2026-01-01', '2026-03-01')`,
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_cohort_metrics`)
    ).rows[0]!.c;
    expect(c).toBe(3);
  });

  it('RLS pair', async () => {
    await db.query(
      `INSERT INTO tenant_cohort_metrics (cohort_month, measurement_month) VALUES ('2026-01-01', '2026-06-01')`,
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ cohort_month: string }>(`SELECT cohort_month FROM tenant_cohort_metrics`))
          .rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ cohort_month: string }>(`SELECT cohort_month FROM tenant_cohort_metrics`))
          .rows.length,
    );
    expect(svc).toBe(1);
  });
});
