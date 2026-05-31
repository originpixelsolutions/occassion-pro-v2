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

const USER = '11111111-1111-1111-1111-111111111111';
const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);

describe('magic_links — schema correctness (Phase 2 Unit 31)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid link', async () => {
    await db.query(
      `INSERT INTO magic_links (user_id, user_type, email, token_hash, expires_at)
       VALUES ($1, 'tenant_member', 'a@y.dev', $2, now() + interval '15 minutes')`,
      [USER, HASH],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM magic_links`)).rows[0]!
      .c;
    expect(c).toBe(1);
  });

  it('rejects bogus user_type', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO magic_links (user_id, user_type, email, token_hash, expires_at)
       VALUES ($1, 'guest', 'a@y.dev', $2, now() + interval '15 minutes')`,
      [USER, HASH],
    );
    expect(err).toMatch(/user_type|check/i);
  });

  it('rejects malformed email', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO magic_links (user_id, user_type, email, token_hash, expires_at)
       VALUES ($1, 'tenant_member', 'not-an-email', $2, now() + interval '15 minutes')`,
      [USER, HASH],
    );
    expect(err).toMatch(/email|check/i);
  });

  it('rejects wrong-length token_hash', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO magic_links (user_id, user_type, email, token_hash, expires_at)
       VALUES ($1, 'tenant_member', 'a@y.dev', 'short', now() + interval '15 minutes')`,
      [USER],
    );
    expect(err).toMatch(/token_hash|check/i);
  });

  it('rejects expires_at past 1-hour ceiling', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO magic_links (user_id, user_type, email, token_hash, expires_at)
       VALUES ($1, 'tenant_member', 'a@y.dev', $2, now() + interval '2 hours')`,
      [USER, HASH],
    );
    expect(err).toMatch(/expires_under_hour|check/i);
  });

  it('rejects consumed_at without consumed_ip', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO magic_links (user_id, user_type, email, token_hash, expires_at, consumed_at)
       VALUES ($1, 'tenant_member', 'a@y.dev', $2, now() + interval '15 minutes', now())`,
      [USER, HASH],
    );
    expect(err).toMatch(/consumed_pair|check/i);
  });

  it('UNIQUE on token_hash blocks duplicates', async () => {
    await db.query(
      `INSERT INTO magic_links (user_id, user_type, email, token_hash, expires_at)
       VALUES ($1, 'tenant_member', 'a@y.dev', $2, now() + interval '15 minutes')`,
      [USER, HASH],
    );
    const err = await tryExec(
      db,
      `INSERT INTO magic_links (user_id, user_type, email, token_hash, expires_at)
       VALUES ($1, 'client', 'a@y.dev', $2, now() + interval '15 minutes')`,
      [USER, HASH],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('partial UNIQUE: one open link per (user, user_type)', async () => {
    await db.query(
      `INSERT INTO magic_links (user_id, user_type, email, token_hash, expires_at)
       VALUES ($1, 'tenant_member', 'a@y.dev', $2, now() + interval '15 minutes')`,
      [USER, HASH],
    );
    const err = await tryExec(
      db,
      `INSERT INTO magic_links (user_id, user_type, email, token_hash, expires_at)
       VALUES ($1, 'tenant_member', 'a@y.dev', $2, now() + interval '15 minutes')`,
      [USER, HASH2],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('consumed link does not block a new open link for same (user, user_type)', async () => {
    await db.query(
      `INSERT INTO magic_links (user_id, user_type, email, token_hash, expires_at, consumed_at, consumed_ip)
       VALUES ($1, 'tenant_member', 'a@y.dev', $2, now() + interval '15 minutes', now(), '1.2.3.4'::inet)`,
      [USER, HASH],
    );
    await db.query(
      `INSERT INTO magic_links (user_id, user_type, email, token_hash, expires_at)
       VALUES ($1, 'tenant_member', 'a@y.dev', $2, now() + interval '15 minutes')`,
      [USER, HASH2],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM magic_links`)).rows[0]!
      .c;
    expect(c).toBe(2);
  });

  it('RLS pair', async () => {
    await db.query(
      `INSERT INTO magic_links (user_id, user_type, email, token_hash, expires_at)
       VALUES ($1, 'tenant_member', 'a@y.dev', $2, now() + interval '15 minutes')`,
      [USER, HASH],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM magic_links`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM magic_links`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
