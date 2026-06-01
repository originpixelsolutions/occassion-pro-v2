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

describe('crew_pool — schema correctness (Phase 3 Unit 9)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid crew entry', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO crew_pool (tenant_id, full_name, phone, email, role, hourly_rate, currency_code, rating)
       VALUES ($1, 'Ankur Mehta', '+919876543210', 'ankur@y.dev', 'sound', 600.00, 'INR', 4.7)`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM crew_pool`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bad phone format (no plus)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO crew_pool (tenant_id, full_name, phone) VALUES ($1, 'X', '9876543210')`, [t]);
    expect(err).toMatch(/phone_fmt|check/i);
  });

  it('rejects malformed email', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO crew_pool (tenant_id, full_name, email) VALUES ($1, 'X', 'not-an-email')`, [t]);
    expect(err).toMatch(/email|check/i);
  });

  it('rejects bogus role', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO crew_pool (tenant_id, full_name, role) VALUES ($1, 'X', 'magician')`, [t]);
    expect(err).toMatch(/role|check/i);
  });

  it('rejects rate without currency', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO crew_pool (tenant_id, full_name, hourly_rate) VALUES ($1, 'X', 100)`, [t]);
    expect(err).toMatch(/rate_currency_coupling|check/i);
  });

  it('rejects rating outside 1.0..5.0', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO crew_pool (tenant_id, full_name, rating) VALUES ($1, 'X', 5.5)`, [t]);
    expect(err).toMatch(/rating_bounds|check/i);
  });

  it('partial UNIQUE: same active phone per tenant blocked', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO crew_pool (tenant_id, full_name, phone) VALUES ($1, 'A', '+919876543210')`, [t]);
    const err = await tryExec(db,
      `INSERT INTO crew_pool (tenant_id, full_name, phone) VALUES ($1, 'B', '+919876543210')`, [t]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('deactivating frees the phone slot', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO crew_pool (tenant_id, full_name, phone, is_active) VALUES ($1, 'A', '+919876543210', FALSE)`, [t]);
    await db.query(
      `INSERT INTO crew_pool (tenant_id, full_name, phone) VALUES ($1, 'B', '+919876543210')`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM crew_pool`)).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('citext email: A@Y.DEV blocked by lower-case duplicate', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO crew_pool (tenant_id, full_name, email) VALUES ($1, 'A', 'a@y.dev')`, [t]);
    const err = await tryExec(db,
      `INSERT INTO crew_pool (tenant_id, full_name, email) VALUES ($1, 'B', 'A@Y.DEV')`, [t]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('CASCADE: deleting tenant removes its crew', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO crew_pool (tenant_id, full_name) VALUES ($1, 'A')`, [t]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM crew_pool`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO crew_pool (tenant_id, full_name) VALUES ($1, 'A')`, [t]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM crew_pool`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM crew_pool`)).rows.length);
    expect(svc).toBe(1);
  });
});
