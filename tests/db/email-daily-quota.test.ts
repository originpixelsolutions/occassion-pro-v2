import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency)
     VALUES ($1, 'Acme', 'INR') RETURNING id`, [slug]);
  return r.rows[0]!.id;
}

describe('email_daily_quota — schema correctness (Phase 2 Unit 29)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid quota row', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO email_daily_quota (tenant_id, date, sent_count, limit_value)
       VALUES ($1, current_date, 0, 5000)`, [t]);
    const r = await db.query<{ sent_count: number; limit_value: number }>(
      `SELECT sent_count, limit_value FROM email_daily_quota`);
    expect(r.rows[0]!.sent_count).toBe(0);
    expect(r.rows[0]!.limit_value).toBe(5000);
  });

  it('rejects sent_count > limit_value', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO email_daily_quota (tenant_id, date, sent_count, limit_value)
       VALUES ($1, current_date, 6000, 5000)`, [t]);
    expect(err).toMatch(/sent_under_limit|check/i);
  });

  it('rejects negative sent_count', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO email_daily_quota (tenant_id, date, sent_count, limit_value)
       VALUES ($1, current_date, -1, 5000)`, [t]);
    expect(err).toMatch(/sent_non_neg|check/i);
  });

  it('rejects negative limit_value', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO email_daily_quota (tenant_id, date, sent_count, limit_value)
       VALUES ($1, current_date, 0, -1)`, [t]);
    expect(err).toMatch(/limit_non_neg|check/i);
  });

  it('composite PK blocks duplicate (tenant, date)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO email_daily_quota (tenant_id, date, sent_count, limit_value)
       VALUES ($1, current_date, 0, 5000)`, [t]);
    const err = await tryExec(db,
      `INSERT INTO email_daily_quota (tenant_id, date, sent_count, limit_value)
       VALUES ($1, current_date, 1, 5000)`, [t]);
    expect(err).toMatch(/duplicate|primary key|unique/i);
  });

  it('atomic increment: UPDATE ... SET sent_count = sent_count + 1 honors CHECK', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO email_daily_quota (tenant_id, date, sent_count, limit_value)
       VALUES ($1, current_date, 4999, 5000)`, [t]);
    // First +1 OK
    await db.query(
      `UPDATE email_daily_quota SET sent_count = sent_count + 1 WHERE tenant_id = $1`, [t]);
    // Second +1 trips the CHECK
    const err = await tryExec(db,
      `UPDATE email_daily_quota SET sent_count = sent_count + 1 WHERE tenant_id = $1`, [t]);
    expect(err).toMatch(/sent_under_limit|check/i);
  });

  it('different tenants and different days coexist', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    await db.query(
      `INSERT INTO email_daily_quota (tenant_id, date, sent_count, limit_value)
       VALUES ($1, current_date, 1, 100),
              ($1, current_date - interval '1 day', 5, 100),
              ($2, current_date, 7, 50)`, [t1, t2]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM email_daily_quota`)).rows[0]!.c;
    expect(c).toBe(3);
  });

  it('CASCADE: deleting tenant removes its quota rows', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO email_daily_quota (tenant_id, date, sent_count, limit_value)
       VALUES ($1, current_date, 0, 5000)`, [t]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM email_daily_quota`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO email_daily_quota (tenant_id, date, sent_count, limit_value)
       VALUES ($1, current_date, 0, 5000)`, [t]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM email_daily_quota`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM email_daily_quota`)).rows.length);
    expect(svc).toBe(1);
  });
});
