import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}

const PW_HASH = '$argon2id$v=19$m=65536,t=3,p=4$' + 'a'.repeat(22) + '$' + 'b'.repeat(43); // 99 chars

describe('client_accounts — schema correctness (Phase 3 Unit 13)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid account', async () => {
    await db.query(
      `INSERT INTO client_accounts (email, full_name, phone, password_hash)
       VALUES ('a@y.dev', 'Alice', '+919876543210', $1)`, [PW_HASH]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM client_accounts`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('UNIQUE email blocks duplicate', async () => {
    await db.query(`INSERT INTO client_accounts (email, password_hash) VALUES ('a@y.dev', $1)`, [PW_HASH]);
    const err = await tryExec(db,
      `INSERT INTO client_accounts (email, password_hash) VALUES ('A@Y.DEV', $1)`, [PW_HASH]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('rejects malformed email', async () => {
    const err = await tryExec(db,
      `INSERT INTO client_accounts (email, password_hash) VALUES ('not-an-email', $1)`, [PW_HASH]);
    expect(err).toMatch(/email|check/i);
  });

  it('rejects bad phone (no +)', async () => {
    const err = await tryExec(db,
      `INSERT INTO client_accounts (email, phone, password_hash) VALUES ('a@y.dev', '9876543210', $1)`, [PW_HASH]);
    expect(err).toMatch(/phone_fmt|check/i);
  });

  it('rejects short password_hash', async () => {
    const err = await tryExec(db,
      `INSERT INTO client_accounts (email, password_hash) VALUES ('a@y.dev', 'shorthash')`);
    expect(err).toMatch(/password_hash_len|check/i);
  });

  it('mfa_coupling: enabled=TRUE without secret rejected', async () => {
    const err = await tryExec(db,
      `INSERT INTO client_accounts (email, password_hash, mfa_enabled) VALUES ('a@y.dev', $1, TRUE)`, [PW_HASH]);
    expect(err).toMatch(/mfa_coupling|check/i);
  });

  it('mfa_coupling: enabled=TRUE with secret accepted', async () => {
    await db.query(
      `INSERT INTO client_accounts (email, password_hash, mfa_enabled, mfa_secret)
       VALUES ('a@y.dev', $1, TRUE, '\\x00aabb'::bytea)`, [PW_HASH]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM client_accounts`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('suspend_coupling: suspended_at without reason rejected', async () => {
    const err = await tryExec(db,
      `INSERT INTO client_accounts (email, password_hash, suspended_at) VALUES ('a@y.dev', $1, now())`, [PW_HASH]);
    expect(err).toMatch(/suspend_coupling|check/i);
  });

  it('rejects negative failed_login_count', async () => {
    const err = await tryExec(db,
      `INSERT INTO client_accounts (email, password_hash, failed_login_count) VALUES ('a@y.dev', $1, -1)`, [PW_HASH]);
    expect(err).toMatch(/failed_non_neg|check/i);
  });

  it('citext email: lower-case stored, case-insensitive match', async () => {
    await db.query(`INSERT INTO client_accounts (email, password_hash) VALUES ('A@Y.DEV', $1)`, [PW_HASH]);
    const r = await db.query<{ email: string }>(`SELECT email FROM client_accounts WHERE email = 'a@y.dev'`);
    expect(r.rows).toHaveLength(1);
  });

  it('RLS pair', async () => {
    await db.query(`INSERT INTO client_accounts (email, password_hash) VALUES ('a@y.dev', $1)`, [PW_HASH]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM client_accounts`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM client_accounts`)).rows.length);
    expect(svc).toBe(1);
  });
});
