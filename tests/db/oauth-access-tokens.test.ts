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

const APP_HASH = 'a'.repeat(64);
async function mkApp(db: TestDb, tenant: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes)
     VALUES ($1, 'op_app_aaaabbbbccccdddd', $2, 'Zapier', ARRAY['https://zapier.com/cb'], ARRAY['events:read']) RETURNING id`,
    [tenant, APP_HASH]);
  return r.rows[0]!.id;
}

const USER = '11111111-1111-1111-1111-111111111111';
const ACCESS = 'b'.repeat(64);
const REFRESH = 'c'.repeat(64);

describe('oauth_access_tokens — schema correctness (Phase 2 Unit 43)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid access+refresh token pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkApp(db, t);
    await db.query(
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, refresh_token_hash, user_id, user_type,
          scopes, expires_at, refresh_expires_at)
       VALUES ($1, $2, $3, $4, 'tenant_member', ARRAY['events:read'],
               now() + interval '1 hour', now() + interval '30 days')`,
      [a, ACCESS, REFRESH, USER]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM oauth_access_tokens`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects wrong-length access_token_hash', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkApp(db, t);
    const err = await tryExec(db,
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, user_id, user_type, scopes, expires_at)
       VALUES ($1, 'short', $2, 'tenant_member', ARRAY['x'], now() + interval '1 hour')`,
      [a, USER]);
    expect(err).toMatch(/access_hash_len|check/i);
  });

  it('rejects access TTL > 24h', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkApp(db, t);
    const err = await tryExec(db,
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, user_id, user_type, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', ARRAY['x'], now() + interval '25 hours')`,
      [a, ACCESS, USER]);
    expect(err).toMatch(/access_under_24h|check/i);
  });

  it('rejects refresh_expires_at <= expires_at (refresh must outlast access)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkApp(db, t);
    const err = await tryExec(db,
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, refresh_token_hash, user_id, user_type, scopes, expires_at, refresh_expires_at)
       VALUES ($1, $2, $3, $4, 'tenant_member', ARRAY['x'], now() + interval '1 hour', now() + interval '30 minutes')`,
      [a, ACCESS, REFRESH, USER]);
    expect(err).toMatch(/refresh_after_access|check/i);
  });

  it('rejects refresh TTL > 365 days', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkApp(db, t);
    const err = await tryExec(db,
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, refresh_token_hash, user_id, user_type, scopes, expires_at, refresh_expires_at)
       VALUES ($1, $2, $3, $4, 'tenant_member', ARRAY['x'], now() + interval '1 hour', now() + interval '400 days')`,
      [a, ACCESS, REFRESH, USER]);
    expect(err).toMatch(/check/i);
  });

  it('refresh_token_hash and refresh_expires_at coupled (cannot set just one)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkApp(db, t);
    const err = await tryExec(db,
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, refresh_token_hash, user_id, user_type, scopes, expires_at)
       VALUES ($1, $2, $3, $4, 'tenant_member', ARRAY['x'], now() + interval '1 hour')`,
      [a, ACCESS, REFRESH, USER]);
    expect(err).toMatch(/refresh_pair|check/i);
  });

  it('rejects revoked_at without revoke_reason', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkApp(db, t);
    const err = await tryExec(db,
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, user_id, user_type, scopes, expires_at, revoked_at)
       VALUES ($1, $2, $3, 'tenant_member', ARRAY['x'], now() + interval '1 hour', now())`,
      [a, ACCESS, USER]);
    expect(err).toMatch(/revoked_pair|check/i);
  });

  it('rejects bogus revoke_reason', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkApp(db, t);
    const err = await tryExec(db,
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, user_id, user_type, scopes, expires_at, revoked_at, revoke_reason)
       VALUES ($1, $2, $3, 'tenant_member', ARRAY['x'], now() + interval '1 hour', now(), 'shrugged')`,
      [a, ACCESS, USER]);
    expect(err).toMatch(/revoke_reason|check/i);
  });

  it('partial UNIQUE: blocks two ACTIVE tokens with same access_token_hash', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkApp(db, t);
    await db.query(
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, user_id, user_type, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', ARRAY['x'], now() + interval '1 hour')`,
      [a, ACCESS, USER]);
    const err = await tryExec(db,
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, user_id, user_type, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', ARRAY['x'], now() + interval '1 hour')`,
      [a, ACCESS, USER]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('rotation: revoked token + new active token CAN share hash', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkApp(db, t);
    await db.query(
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, user_id, user_type, scopes, expires_at, revoked_at, revoke_reason)
       VALUES ($1, $2, $3, 'tenant_member', ARRAY['x'], now() + interval '1 hour', now(), 'rotation')`,
      [a, ACCESS, USER]);
    await db.query(
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, user_id, user_type, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', ARRAY['x'], now() + interval '1 hour')`,
      [a, ACCESS, USER]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM oauth_access_tokens`)).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting oauth app removes its tokens', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkApp(db, t);
    await db.query(
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, user_id, user_type, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', ARRAY['x'], now() + interval '1 hour')`,
      [a, ACCESS, USER]);
    await db.query(`DELETE FROM tenant_oauth_apps WHERE id = $1`, [a]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM oauth_access_tokens`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const a = await mkApp(db, t);
    await db.query(
      `INSERT INTO oauth_access_tokens
         (oauth_app_id, access_token_hash, user_id, user_type, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', ARRAY['x'], now() + interval '1 hour')`,
      [a, ACCESS, USER]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM oauth_access_tokens`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM oauth_access_tokens`)).rows.length);
    expect(svc).toBe(1);
  });
});
