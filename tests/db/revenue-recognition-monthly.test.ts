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

async function mkEntry(db: TestDb, tenant: string, total = 12000): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO revenue_recognition_entries
       (tenant_id, amount_total, amount_deferred, currency_code, period_start, period_end)
     VALUES ($1, $2, $2, 'INR', '2026-01-01', '2027-01-01') RETURNING id`, [tenant, total]);
  return r.rows[0]!.id;
}

describe('revenue_recognition_monthly — schema correctness (Phase 2 Unit 35)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid monthly accrual', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEntry(db, t);
    await db.query(
      `INSERT INTO revenue_recognition_monthly (entry_id, recognition_month, amount_recognized)
       VALUES ($1, '2026-02-01', 1000.00)`, [e]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM revenue_recognition_monthly`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects amount_recognized <= 0', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEntry(db, t);
    const err = await tryExec(db,
      `INSERT INTO revenue_recognition_monthly (entry_id, recognition_month, amount_recognized)
       VALUES ($1, '2026-02-01', 0)`, [e]);
    expect(err).toMatch(/amount_pos|check/i);
  });

  it('rejects non-first-of-month recognition_month', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEntry(db, t);
    const err = await tryExec(db,
      `INSERT INTO revenue_recognition_monthly (entry_id, recognition_month, amount_recognized)
       VALUES ($1, '2026-02-15', 1000.00)`, [e]);
    expect(err).toMatch(/first_of_month|check/i);
  });

  it('UNIQUE (entry_id, recognition_month): one row per month', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEntry(db, t);
    await db.query(
      `INSERT INTO revenue_recognition_monthly (entry_id, recognition_month, amount_recognized)
       VALUES ($1, '2026-02-01', 1000.00)`, [e]);
    const err = await tryExec(db,
      `INSERT INTO revenue_recognition_monthly (entry_id, recognition_month, amount_recognized)
       VALUES ($1, '2026-02-01', 2000.00)`, [e]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('trigger: blocks sum of monthlies > parent total (over-recognition)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEntry(db, t, 12000);
    // Two months of 6000 each = 12000 (legal at the cap)
    await db.query(
      `INSERT INTO revenue_recognition_monthly (entry_id, recognition_month, amount_recognized) VALUES
         ($1, '2026-01-01', 6000.00),
         ($1, '2026-02-01', 6000.00)`, [e]);
    // Third month would push sum to 18000 - rejected
    const err = await tryExec(db,
      `INSERT INTO revenue_recognition_monthly (entry_id, recognition_month, amount_recognized)
       VALUES ($1, '2026-03-01', 6000.00)`, [e]);
    expect(err).toMatch(/over_recognized|check/i);
  });

  it('trigger: allows sum exactly equal to parent total', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEntry(db, t, 12000);
    await db.query(
      `INSERT INTO revenue_recognition_monthly (entry_id, recognition_month, amount_recognized) VALUES
         ($1, '2026-01-01', 1000.00),
         ($1, '2026-02-01', 11000.00)`, [e]);
    const r = await db.query<{ s: string }>(
      `SELECT sum(amount_recognized)::text AS s FROM revenue_recognition_monthly WHERE entry_id = $1`, [e]);
    expect(Number(r.rows[0]!.s)).toBe(12000);
  });

  it('CASCADE: deleting parent entry removes its monthlies', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEntry(db, t);
    await db.query(
      `INSERT INTO revenue_recognition_monthly (entry_id, recognition_month, amount_recognized)
       VALUES ($1, '2026-02-01', 1000.00)`, [e]);
    await db.query(`DELETE FROM revenue_recognition_entries WHERE id = $1`, [e]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM revenue_recognition_monthly`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('CASCADE: deleting tenant removes parent entries AND their monthlies', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEntry(db, t);
    await db.query(
      `INSERT INTO revenue_recognition_monthly (entry_id, recognition_month, amount_recognized)
       VALUES ($1, '2026-02-01', 1000.00)`, [e]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM revenue_recognition_monthly`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEntry(db, t);
    await db.query(
      `INSERT INTO revenue_recognition_monthly (entry_id, recognition_month, amount_recognized)
       VALUES ($1, '2026-02-01', 1000.00)`, [e]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM revenue_recognition_monthly`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM revenue_recognition_monthly`)).rows.length);
    expect(svc).toBe(1);
  });
});
