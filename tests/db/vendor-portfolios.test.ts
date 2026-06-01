import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
const PW = '$argon2id$v=19$m=65536,t=3,p=4$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);
async function mkVendor(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO vendor_accounts (email, password_hash) VALUES ($1,$2) RETURNING id`, [email, PW])).rows[0]!.id;
}
async function mkSuperAdmin(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO super_admins (email, role, full_name) VALUES ($1,'owner','Sa') RETURNING id`,
    [email])).rows[0]!.id;
}

describe('vendor_portfolios — schema correctness (Phase 4 Unit 43)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid portfolio', async () => {
    const v = await mkVendor(db, 'v1@y.dev');
    await db.query(
      `INSERT INTO vendor_portfolios (vendor_account_id, about_text, service_categories, service_regions, starting_price, starting_currency, years_in_business, slug, visibility)
       VALUES ($1,'Premium caterer', ARRAY['catering','live_cooking'], ARRAY['Mumbai','Pune','Goa'], 250000.00, 'INR', 12, 'acme-catering', 'public')`, [v]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_portfolios`)).rows[0]!.c).toBe(1);
  });

  it('PK = vendor_account_id: one portfolio per vendor', async () => {
    const v = await mkVendor(db, 'v2@y.dev');
    await db.query(`INSERT INTO vendor_portfolios (vendor_account_id) VALUES ($1)`, [v]);
    const err = await tryExec(db, `INSERT INTO vendor_portfolios (vendor_account_id) VALUES ($1)`, [v]);
    expect(err).toMatch(/duplicate|primary/i);
  });

  it('starting_price without currency rejected', async () => {
    const v = await mkVendor(db, 'v3@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_portfolios (vendor_account_id, starting_price) VALUES ($1, 1000)`, [v]);
    expect(err).toMatch(/price_currency|check/i);
  });

  it('rating without count rejected', async () => {
    const v = await mkVendor(db, 'v4@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_portfolios (vendor_account_id, avg_performance_rating, total_ratings_count) VALUES ($1, 4.5, 0)`, [v]);
    expect(err).toMatch(/rating_count|check/i);
  });

  it('rating + count coupling: count > 0 with NULL rating rejected', async () => {
    const v = await mkVendor(db, 'v5@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_portfolios (vendor_account_id, total_ratings_count) VALUES ($1, 10)`, [v]);
    expect(err).toMatch(/rating_count|check/i);
  });

  it('rejects bad visibility', async () => {
    const v = await mkVendor(db, 'v6@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_portfolios (vendor_account_id, visibility) VALUES ($1, 'admin_only')`, [v]);
    expect(err).toMatch(/visibility|check/i);
  });

  it('UNIQUE slug across vendors', async () => {
    const v1 = await mkVendor(db, 'v7@y.dev');
    const v2 = await mkVendor(db, 'v8@y.dev');
    await db.query(`INSERT INTO vendor_portfolios (vendor_account_id, slug) VALUES ($1,'acme-catering')`, [v1]);
    const err = await tryExec(db, `INSERT INTO vendor_portfolios (vendor_account_id, slug) VALUES ($1,'acme-catering')`, [v2]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('rejects bad slug format', async () => {
    const v = await mkVendor(db, 'v9@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_portfolios (vendor_account_id, slug) VALUES ($1, 'Acme Catering!')`, [v]);
    expect(err).toMatch(/slug|check/i);
  });

  it('rejects gallery > 20 images', async () => {
    const v = await mkVendor(db, 'va@y.dev');
    const urls = Array.from({length: 21}, (_, i) => `https://cdn.example/img${i}.jpg`);
    const err = await tryExec(db,
      `INSERT INTO vendor_portfolios (vendor_account_id, gallery_image_urls) VALUES ($1, $2::text[])`, [v, urls]);
    expect(err).toMatch(/gallery|check/i);
  });

  it('verified requires verified_at + verified_by', async () => {
    const v = await mkVendor(db, 'vb@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_portfolios (vendor_account_id, is_verified) VALUES ($1, TRUE)`, [v]);
    expect(err).toMatch(/verified_coupling|check/i);
  });

  it('verified happy path with super admin', async () => {
    const v = await mkVendor(db, 'vc@y.dev');
    const sa = await mkSuperAdmin(db, 'sa@y.dev');
    await db.query(
      `INSERT INTO vendor_portfolios (vendor_account_id, is_verified, verified_at, verified_by) VALUES ($1, TRUE, now(), $2)`, [v, sa]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_portfolios WHERE is_verified=TRUE`)).rows[0]!.c).toBe(1);
  });

  it('RLS pair', async () => {
    const v = await mkVendor(db, 'vw@y.dev');
    await db.query(`INSERT INTO vendor_portfolios (vendor_account_id) VALUES ($1)`, [v]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ vendor_account_id: string }>(`SELECT vendor_account_id FROM vendor_portfolios`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ vendor_account_id: string }>(`SELECT vendor_account_id FROM vendor_portfolios`)).rows.length);
    expect(svc).toBe(1);
  });
});
