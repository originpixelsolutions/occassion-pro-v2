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

describe('tenant_health_scores — schema correctness (Phase 2 Unit 39)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a fully-populated row', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_health_scores (
         tenant_id, overall_score, product_engagement_score, team_engagement_score,
         financial_health_score, support_health_score, growth_score,
         churn_risk_level, churn_risk_reasons
       ) VALUES ($1, 82.50, 85, 80, 90, 70, 75, 'low', ARRAY['active_user_growth'])`,
      [t],
    );
    const r = await db.query<{ overall_score: string }>(
      `SELECT overall_score FROM tenant_health_scores`,
    );
    expect(Number(r.rows[0]!.overall_score)).toBe(82.5);
  });

  it('PK enforces singleton per tenant', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(`INSERT INTO tenant_health_scores (tenant_id) VALUES ($1)`, [t]);
    const err = await tryExec(db, `INSERT INTO tenant_health_scores (tenant_id) VALUES ($1)`, [t]);
    expect(err).toMatch(/duplicate|primary key|unique/i);
  });

  it('rejects score outside 0..100', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e1 = await tryExec(
      db,
      `INSERT INTO tenant_health_scores (tenant_id, overall_score, churn_risk_level) VALUES ($1, -1, 'low')`,
      [t],
    );
    expect(e1).toMatch(/overall_bounds|check/i);
    const e2 = await tryExec(
      db,
      `INSERT INTO tenant_health_scores (tenant_id, product_engagement_score) VALUES ($1, 101)`,
      [t],
    );
    expect(e2).toMatch(/check/i);
  });

  it('rejects bogus churn_risk_level', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_health_scores (tenant_id, overall_score, churn_risk_level)
       VALUES ($1, 50, 'doomed')`,
      [t],
    );
    expect(err).toMatch(/risk|check/i);
  });

  it('rejects overall_score set without churn_risk_level (coupling)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_health_scores (tenant_id, overall_score) VALUES ($1, 75)`,
      [t],
    );
    expect(err).toMatch(/overall_risk_coupling|check/i);
  });

  it('rejects churn_risk_level set without overall_score', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_health_scores (tenant_id, churn_risk_level) VALUES ($1, 'low')`,
      [t],
    );
    expect(err).toMatch(/overall_risk_coupling|check/i);
  });

  it('rejects empty churn_risk_reasons array', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_health_scores (tenant_id, overall_score, churn_risk_level, churn_risk_reasons)
       VALUES ($1, 25, 'critical', ARRAY[]::text[])`,
      [t],
    );
    expect(err).toMatch(/reasons|check/i);
  });

  it('rejects negative counters', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_health_scores (tenant_id, ticket_count_30d) VALUES ($1, -1)`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('allows a sparse row (just tenant_id + computed_at default)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(`INSERT INTO tenant_health_scores (tenant_id) VALUES ($1)`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_health_scores`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('CASCADE: deleting tenant removes its score row', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_health_scores (tenant_id, overall_score, churn_risk_level)
       VALUES ($1, 70, 'low')`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_health_scores`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(`INSERT INTO tenant_health_scores (tenant_id) VALUES ($1)`, [t]);
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM tenant_health_scores`)).rows
          .length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM tenant_health_scores`)).rows
          .length,
    );
    expect(svc).toBe(1);
  });
});
