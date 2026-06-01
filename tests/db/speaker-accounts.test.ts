import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}

const PW = '$argon2id$v=19$m=65536,t=3,p=4$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);

describe('speaker_accounts — schema correctness (Phase 3 Unit 15)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a magic-link speaker (no password)', async () => {
    await db.query(
      `INSERT INTO speaker_accounts (email, full_name, bio, photo_url, socials, expertise_tags)
       VALUES ('s@y.dev','Sasha','keynote speaker','https://cdn.example/sasha.png','{"x":"@sasha"}'::jsonb, ARRAY['ai','design'])`);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM speaker_accounts`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects non-https photo_url', async () => {
    const err = await tryExec(db,
      `INSERT INTO speaker_accounts (email, photo_url) VALUES ('s@y.dev', 'http://insecure/x.png')`);
    expect(err).toMatch(/photo_url|check/i);
  });

  it('rejects socials non-object jsonb', async () => {
    const err = await tryExec(db,
      `INSERT INTO speaker_accounts (email, socials) VALUES ('s@y.dev', '["x","y"]'::jsonb)`);
    expect(err).toMatch(/socials|check/i);
  });

  it('rejects oversize bio', async () => {
    const long = 'a'.repeat(5001);
    const err = await tryExec(db,
      `INSERT INTO speaker_accounts (email, bio) VALUES ('s@y.dev', $1)`, [long]);
    expect(err).toMatch(/bio|check/i);
  });

  it('mfa_secret_coupling: enabled without secret rejected', async () => {
    const err = await tryExec(db,
      `INSERT INTO speaker_accounts (email, mfa_enabled, password_hash) VALUES ('s@y.dev', TRUE, $1)`, [PW]);
    expect(err).toMatch(/mfa_secret|check/i);
  });

  it('mfa_password_coupling: enabled without password rejected', async () => {
    const err = await tryExec(db,
      `INSERT INTO speaker_accounts (email, mfa_enabled, mfa_secret) VALUES ('s@y.dev', TRUE, '\\x00aa'::bytea)`);
    expect(err).toMatch(/mfa_password|check/i);
  });

  it('mfa fully enabled accepted', async () => {
    await db.query(
      `INSERT INTO speaker_accounts (email, password_hash, mfa_enabled, mfa_secret)
       VALUES ('s@y.dev', $1, TRUE, '\\x00aabb'::bytea)`, [PW]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM speaker_accounts`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('expertise_tags GIN searchable', async () => {
    await db.query(`INSERT INTO speaker_accounts (email, expertise_tags) VALUES ('s@y.dev', ARRAY['ai','design'])`);
    const r = await db.query<{ id: string }>(`SELECT id FROM speaker_accounts WHERE expertise_tags && ARRAY['ai']`);
    expect(r.rows).toHaveLength(1);
  });

  it('citext email UNIQUE case-fold', async () => {
    await db.query(`INSERT INTO speaker_accounts (email) VALUES ('S@Y.DEV')`);
    const err = await tryExec(db, `INSERT INTO speaker_accounts (email) VALUES ('s@y.dev')`);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('RLS pair', async () => {
    await db.query(`INSERT INTO speaker_accounts (email) VALUES ('s@y.dev')`);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM speaker_accounts`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM speaker_accounts`)).rows.length);
    expect(svc).toBe(1);
  });
});
