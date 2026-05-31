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

const USER1 = '11111111-1111-1111-1111-111111111111';
const USER2 = '22222222-2222-2222-2222-222222222222';

describe('oauth_provider_links — schema correctness (Phase 2 Unit 30)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid link', async () => {
    await db.query(
      `INSERT INTO oauth_provider_links (auth_user_id, provider, provider_user_id, provider_email)
       VALUES ($1, 'google', 'g-sub-1', 'u@y.dev')`,
      [USER1],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM oauth_provider_links`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bogus provider', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO oauth_provider_links (auth_user_id, provider, provider_user_id)
       VALUES ($1, 'facebook', 'fb-sub-1')`,
      [USER1],
    );
    expect(err).toMatch(/provider|check/i);
  });

  it('rejects malformed provider_email', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO oauth_provider_links (auth_user_id, provider, provider_user_id, provider_email)
       VALUES ($1, 'google', 'g-sub-1', 'not-an-email')`,
      [USER1],
    );
    expect(err).toMatch(/email|check/i);
  });

  it('rejects last_used_at before linked_at', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO oauth_provider_links (auth_user_id, provider, provider_user_id, linked_at, last_used_at)
       VALUES ($1, 'google', 'g-sub-1', now(), now() - interval '1 minute')`,
      [USER1],
    );
    expect(err).toMatch(/last_used_order|check/i);
  });

  it('UNIQUE (provider, provider_user_id): blocks hijack (same Google id linked twice)', async () => {
    await db.query(
      `INSERT INTO oauth_provider_links (auth_user_id, provider, provider_user_id)
       VALUES ($1, 'google', 'g-sub-shared')`,
      [USER1],
    );
    const err = await tryExec(
      db,
      `INSERT INTO oauth_provider_links (auth_user_id, provider, provider_user_id)
       VALUES ($1, 'google', 'g-sub-shared')`,
      [USER2],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('UNIQUE (auth_user_id, provider): user cannot link two Google accounts', async () => {
    await db.query(
      `INSERT INTO oauth_provider_links (auth_user_id, provider, provider_user_id)
       VALUES ($1, 'google', 'g-sub-1')`,
      [USER1],
    );
    const err = await tryExec(
      db,
      `INSERT INTO oauth_provider_links (auth_user_id, provider, provider_user_id)
       VALUES ($1, 'google', 'g-sub-2')`,
      [USER1],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('same user CAN link different providers', async () => {
    await db.query(
      `INSERT INTO oauth_provider_links (auth_user_id, provider, provider_user_id) VALUES
         ($1, 'google',    'g-sub-1'),
         ($1, 'microsoft', 'm-sub-1'),
         ($1, 'apple',     'a-sub-1')`,
      [USER1],
    );
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM oauth_provider_links WHERE auth_user_id = $1`,
        [USER1],
      )
    ).rows[0]!.c;
    expect(c).toBe(3);
  });

  it('provider_email is citext (case-fold de-dup on the email index, when present)', async () => {
    await db.query(
      `INSERT INTO oauth_provider_links (auth_user_id, provider, provider_user_id, provider_email)
       VALUES ($1, 'google', 'g-sub-1', 'u@y.dev')`,
      [USER1],
    );
    const r = await db.query<{ provider_email: string }>(
      `SELECT provider_email FROM oauth_provider_links WHERE provider_email = 'U@Y.DEV'`,
    );
    expect(r.rows).toHaveLength(1);
  });

  it('RLS pair', async () => {
    await db.query(
      `INSERT INTO oauth_provider_links (auth_user_id, provider, provider_user_id)
       VALUES ($1, 'google', 'g-sub-1')`,
      [USER1],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM oauth_provider_links`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM oauth_provider_links`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
