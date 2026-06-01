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

const HASH64 = 'a'.repeat(64);

async function mkApp(
  db: TestDb,
  tenant: string,
  clientSuffix = 'aaaabbbbccccdddd',
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenant_oauth_apps (tenant_id, client_id, client_secret_hash, name, redirect_uris, scopes)
     VALUES ($1, $2, $3, 'Zapier', ARRAY['https://zapier.com/cb'], ARRAY['events:read']) RETURNING id`,
    [tenant, `op_app_${clientSuffix}`, HASH64],
  );
  return r.rows[0]!.id;
}

const USER = '11111111-1111-1111-1111-111111111111';
const CODE = 'b'.repeat(64);
const PKCE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'; // 43 chars

describe('oauth_authorization_codes — schema correctness (Phase 2 Unit 42)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid code', async () => {
    const t = await mkTenant(db, 'acme-co');
    const app = await mkApp(db, t);
    await db.query(
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', 'https://zapier.com/cb', ARRAY['events:read'], now() + interval '10 minutes')`,
      [app, CODE, USER],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM oauth_authorization_codes`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects wrong-length code_hash', async () => {
    const t = await mkTenant(db, 'acme-co');
    const app = await mkApp(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at)
       VALUES ($1, 'short', $2, 'tenant_member', 'https://zapier.com/cb', ARRAY['events:read'], now() + interval '5 minutes')`,
      [app, USER],
    );
    expect(err).toMatch(/code_hash_len|check/i);
  });

  it('rejects bogus user_type', async () => {
    const t = await mkTenant(db, 'acme-co');
    const app = await mkApp(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at)
       VALUES ($1, $2, $3, 'guest', 'https://zapier.com/cb', ARRAY['events:read'], now() + interval '5 minutes')`,
      [app, CODE, USER],
    );
    expect(err).toMatch(/user_type|check/i);
  });

  it('rejects empty scopes', async () => {
    const t = await mkTenant(db, 'acme-co');
    const app = await mkApp(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', 'https://zapier.com/cb', ARRAY[]::text[], now() + interval '5 minutes')`,
      [app, CODE, USER],
    );
    expect(err).toMatch(/scopes_non_empty|check/i);
  });

  it('rejects non-https / non-localhost redirect_uri', async () => {
    const t = await mkTenant(db, 'acme-co');
    const app = await mkApp(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', 'http://insecure.example/cb', ARRAY['events:read'], now() + interval '5 minutes')`,
      [app, CODE, USER],
    );
    expect(err).toMatch(/redirect_uri|check/i);
  });

  it('accepts http://localhost dev redirect', async () => {
    const t = await mkTenant(db, 'acme-co');
    const app = await mkApp(db, t);
    await db.query(
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', 'http://localhost:3000/cb', ARRAY['events:read'], now() + interval '5 minutes')`,
      [app, CODE, USER],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM oauth_authorization_codes`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects expires_at past 10-minute ceiling', async () => {
    const t = await mkTenant(db, 'acme-co');
    const app = await mkApp(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', 'https://zapier.com/cb', ARRAY['events:read'], now() + interval '11 minutes')`,
      [app, CODE, USER],
    );
    expect(err).toMatch(/under_10min|check/i);
  });

  it('rejects consumed_at without consumed_ip', async () => {
    const t = await mkTenant(db, 'acme-co');
    const app = await mkApp(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at, consumed_at)
       VALUES ($1, $2, $3, 'tenant_member', 'https://zapier.com/cb', ARRAY['events:read'], now() + interval '5 minutes', now())`,
      [app, CODE, USER],
    );
    expect(err).toMatch(/consumed_pair|check/i);
  });

  it('PKCE coupling: challenge without method is rejected', async () => {
    const t = await mkTenant(db, 'acme-co');
    const app = await mkApp(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at, code_challenge)
       VALUES ($1, $2, $3, 'tenant_member', 'https://zapier.com/cb', ARRAY['events:read'], now() + interval '5 minutes', $4)`,
      [app, CODE, USER, PKCE_CHALLENGE],
    );
    expect(err).toMatch(/pkce_pair|check/i);
  });

  it('PKCE happy path: both challenge and method set', async () => {
    const t = await mkTenant(db, 'acme-co');
    const app = await mkApp(db, t);
    await db.query(
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at, code_challenge, code_challenge_method)
       VALUES ($1, $2, $3, 'tenant_member', 'https://zapier.com/cb', ARRAY['events:read'], now() + interval '5 minutes', $4, 'S256')`,
      [app, CODE, USER, PKCE_CHALLENGE],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM oauth_authorization_codes`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('UNIQUE code_hash blocks duplicate issuance', async () => {
    const t = await mkTenant(db, 'acme-co');
    const app = await mkApp(db, t);
    await db.query(
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', 'https://zapier.com/cb', ARRAY['events:read'], now() + interval '5 minutes')`,
      [app, CODE, USER],
    );
    const err = await tryExec(
      db,
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', 'https://zapier.com/cb', ARRAY['events:read'], now() + interval '5 minutes')`,
      [app, CODE, USER],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('CASCADE: deleting oauth app removes its codes', async () => {
    const t = await mkTenant(db, 'acme-co');
    const app = await mkApp(db, t);
    await db.query(
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', 'https://zapier.com/cb', ARRAY['events:read'], now() + interval '5 minutes')`,
      [app, CODE, USER],
    );
    await db.query(`DELETE FROM tenant_oauth_apps WHERE id = $1`, [app]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM oauth_authorization_codes`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const app = await mkApp(db, t);
    await db.query(
      `INSERT INTO oauth_authorization_codes
         (oauth_app_id, code_hash, user_id, user_type, redirect_uri, scopes, expires_at)
       VALUES ($1, $2, $3, 'tenant_member', 'https://zapier.com/cb', ARRAY['events:read'], now() + interval '5 minutes')`,
      [app, CODE, USER],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM oauth_authorization_codes`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM oauth_authorization_codes`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
