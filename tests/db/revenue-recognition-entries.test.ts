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

describe('revenue_recognition_entries — schema correctness (Phase 2 Unit 34)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid entry (fresh prepay, all deferred)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO revenue_recognition_entries
         (tenant_id, amount_total, amount_recognized, amount_deferred, currency_code, period_start, period_end)
       VALUES ($1, 12000.00, 0.00, 12000.00, 'INR', '2026-01-01', '2027-01-01')`,
      [t],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM revenue_recognition_entries`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bookkeeping mismatch (recognized + deferred != total)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO revenue_recognition_entries
         (tenant_id, amount_total, amount_recognized, amount_deferred, currency_code, period_start, period_end)
       VALUES ($1, 12000.00, 1000.00, 1000.00, 'INR', '2026-01-01', '2027-01-01')`,
      [t],
    );
    expect(err).toMatch(/bookkeeping|check/i);
  });

  it('rejects amount_total <= 0', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO revenue_recognition_entries
         (tenant_id, amount_total, amount_deferred, currency_code, period_start, period_end)
       VALUES ($1, 0, 0, 'INR', '2026-01-01', '2027-01-01')`,
      [t],
    );
    expect(err).toMatch(/total_pos|check/i);
  });

  it('rejects bad currency code', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO revenue_recognition_entries
         (tenant_id, amount_total, amount_deferred, currency_code, period_start, period_end)
       VALUES ($1, 12000, 12000, 'inr', '2026-01-01', '2027-01-01')`,
      [t],
    );
    expect(err).toMatch(/currency|check/i);
  });

  it('rejects bogus recognition_method', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO revenue_recognition_entries
         (tenant_id, amount_total, amount_deferred, currency_code, period_start, period_end, recognition_method)
       VALUES ($1, 12000, 12000, 'INR', '2026-01-01', '2027-01-01', 'gradual')`,
      [t],
    );
    expect(err).toMatch(/method|check/i);
  });

  it('rejects period_end <= period_start', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO revenue_recognition_entries
         (tenant_id, amount_total, amount_deferred, currency_code, period_start, period_end)
       VALUES ($1, 12000, 12000, 'INR', '2026-06-01', '2026-05-01')`,
      [t],
    );
    expect(err).toMatch(/period_order|check/i);
  });

  it('rejects amount_recognized > amount_total', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO revenue_recognition_entries
         (tenant_id, amount_total, amount_recognized, amount_deferred, currency_code, period_start, period_end)
       VALUES ($1, 12000, 13000, -1000, 'INR', '2026-01-01', '2027-01-01')`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('mid-period state: 25% recognized, 75% deferred', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO revenue_recognition_entries
         (tenant_id, amount_total, amount_recognized, amount_deferred, currency_code, period_start, period_end)
       VALUES ($1, 12000.00, 3000.00, 9000.00, 'INR', '2026-01-01', '2027-01-01')`,
      [t],
    );
    const r = await db.query<{ amount_recognized: string; amount_deferred: string }>(
      `SELECT amount_recognized, amount_deferred FROM revenue_recognition_entries`,
    );
    expect(Number(r.rows[0]!.amount_recognized)).toBe(3000);
    expect(Number(r.rows[0]!.amount_deferred)).toBe(9000);
  });

  it('fully-recognized state: 100% recognized, 0 deferred', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO revenue_recognition_entries
         (tenant_id, amount_total, amount_recognized, amount_deferred, currency_code, period_start, period_end)
       VALUES ($1, 12000.00, 12000.00, 0.00, 'INR', '2026-01-01', '2027-01-01')`,
      [t],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM revenue_recognition_entries`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('CASCADE: deleting tenant removes its entries', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO revenue_recognition_entries
         (tenant_id, amount_total, amount_deferred, currency_code, period_start, period_end)
       VALUES ($1, 12000, 12000, 'INR', '2026-01-01', '2027-01-01')`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM revenue_recognition_entries`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO revenue_recognition_entries
         (tenant_id, amount_total, amount_deferred, currency_code, period_start, period_end)
       VALUES ($1, 12000, 12000, 'INR', '2026-01-01', '2027-01-01')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM revenue_recognition_entries`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM revenue_recognition_entries`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
