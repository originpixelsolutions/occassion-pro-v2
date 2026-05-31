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

const HASH64 = 'a'.repeat(64);

describe('tenant_oauth_apps — schema correctness (Phase 2 Unit 21)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid app', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes)
       VALUES ($1, 'op_app_aaaabbbbccccdddd', $2, 'Zapier', ARRAY['https://zapier.com/cb'], ARRAY['events:read'])`,
      [t, HASH64]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_oauth_apps`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects malformed client_id', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes)
       VALUES ($1, 'bad_id', $2, 'X', ARRAY['https://x.com/cb'], ARRAY['x'])`, [t, HASH64]);
    expect(err).toMatch(/client_id|check/i);
  });

  it('rejects wrong-length client_secret_hash', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes)
       VALUES ($1, 'op_app_aaaabbbbccccdddd', 'short', 'X', ARRAY['https://x.com/cb'], ARRAY['x'])`, [t]);
    expect(err).toMatch(/secret_hash|check/i);
  });

  it('rejects empty redirect_uris', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes)
       VALUES ($1, 'op_app_aaaabbbbccccdddd', $2, 'X', ARRAY[]::text[], ARRAY['x'])`, [t, HASH64]);
    expect(err).toMatch(/redirects_non_empty|check/i);
  });

  it('rejects empty scopes', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes)
       VALUES ($1, 'op_app_aaaabbbbccccdddd', $2, 'X', ARRAY['https://x.com/cb'], ARRAY[]::text[])`, [t, HASH64]);
    expect(err).toMatch(/scopes_non_empty|check/i);
  });

  it('trigger: rejects http redirect (non-localhost)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes)
       VALUES ($1, 'op_app_aaaabbbbccccdddd', $2, 'X', ARRAY['http://insecure.example/cb'], ARRAY['x'])`, [t, HASH64]);
    expect(err).toMatch(/invalid_redirect|check/i);
  });

  it('trigger: accepts http://localhost (dev)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes)
       VALUES ($1, 'op_app_aaaabbbbccccdddd', $2, 'X', ARRAY['http://localhost:3000/cb'], ARRAY['x'])`, [t, HASH64]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_oauth_apps`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it("rejects 'suspended' without suspended_at + suspended_reason", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes, status)
       VALUES ($1, 'op_app_aaaabbbbccccdddd', $2, 'X', ARRAY['https://x.com/cb'], ARRAY['x'], 'suspended')`, [t, HASH64]);
    expect(err).toMatch(/check/i);
  });

  it("rejects 'revoked' without revoked_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes, status)
       VALUES ($1, 'op_app_aaaabbbbccccdddd', $2, 'X', ARRAY['https://x.com/cb'], ARRAY['x'], 'revoked')`, [t, HASH64]);
    expect(err).toMatch(/check/i);
  });

  it('UNIQUE on client_id blocks duplicates', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    await db.query(
      `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes)
       VALUES ($1, 'op_app_aaaabbbbccccdddd', $2, 'X', ARRAY['https://x.com/cb'], ARRAY['x'])`,
      [t1, HASH64]);
    const err = await tryExec(db,
      `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes)
       VALUES ($1, 'op_app_aaaabbbbccccdddd', $2, 'X', ARRAY['https://x.com/cb'], ARRAY['x'])`,
      [t2, HASH64]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('CASCADE: deleting tenant removes its apps', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes)
       VALUES ($1, 'op_app_aaaabbbbccccdddd', $2, 'X', ARRAY['https://x.com/cb'], ARRAY['x'])`,
      [t, HASH64]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_oauth_apps`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes)
       VALUES ($1, 'op_app_aaaabbbbccccdddd', $2, 'X', ARRAY['https://x.com/cb'], ARRAY['x'])`,
      [t, HASH64]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM tenant_oauth_apps`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM tenant_oauth_apps`)).rows.length);
    expect(svc).toBe(1);
  });
});
