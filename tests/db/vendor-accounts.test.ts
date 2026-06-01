import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}

const PW = '$argon2id$v=19$m=65536,t=3,p=4$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);

describe('vendor_accounts — schema correctness (Phase 3 Unit 14)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid vendor', async () => {
    await db.query(
      `INSERT INTO vendor_accounts (email, company_name, contact_name, phone, password_hash, tax_id, default_currency)
       VALUES ('v@y.dev','Acme Catering Ltd','Bob','+919876543210',$1,'TAX-001','INR')`, [PW]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_accounts`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('UNIQUE email blocks duplicate (citext case-fold)', async () => {
    await db.query(`INSERT INTO vendor_accounts (email, password_hash) VALUES ('v@y.dev', $1)`, [PW]);
    const err = await tryExec(db, `INSERT INTO vendor_accounts (email, password_hash) VALUES ('V@Y.DEV', $1)`, [PW]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('rejects malformed currency', async () => {
    const err = await tryExec(db,
      `INSERT INTO vendor_accounts (email, password_hash, default_currency) VALUES ('v@y.dev', $1, 'usd')`, [PW]);
    expect(err).toMatch(/currency|check/i);
  });

  it('rejects bad phone', async () => {
    const err = await tryExec(db,
      `INSERT INTO vendor_accounts (email, phone, password_hash) VALUES ('v@y.dev', '9876543210', $1)`, [PW]);
    expect(err).toMatch(/phone|check/i);
  });

  it('rejects short password_hash', async () => {
    const err = await tryExec(db,
      `INSERT INTO vendor_accounts (email, password_hash) VALUES ('v@y.dev', 'short')`);
    expect(err).toMatch(/password_hash|check/i);
  });

  it('mfa_coupling: enabled=TRUE without secret rejected', async () => {
    const err = await tryExec(db,
      `INSERT INTO vendor_accounts (email, password_hash, mfa_enabled) VALUES ('v@y.dev', $1, TRUE)`, [PW]);
    expect(err).toMatch(/mfa|check/i);
  });

  it('suspend_coupling: suspended_at without reason rejected', async () => {
    const err = await tryExec(db,
      `INSERT INTO vendor_accounts (email, password_hash, suspended_at) VALUES ('v@y.dev', $1, now())`, [PW]);
    expect(err).toMatch(/suspend|check/i);
  });

  it('bank_coupling: encrypted without kms_key_id rejected', async () => {
    const err = await tryExec(db,
      `INSERT INTO vendor_accounts (email, password_hash, bank_account_encrypted) VALUES ('v@y.dev', $1, '\\x00aabb'::bytea)`, [PW]);
    expect(err).toMatch(/bank|check/i);
  });

  it('bank_coupling: kms_key_id without encrypted rejected', async () => {
    const err = await tryExec(db,
      `INSERT INTO vendor_accounts (email, password_hash, bank_kms_key_id) VALUES ('v@y.dev', $1, 'arn:kms:key/abc')`, [PW]);
    expect(err).toMatch(/bank|check/i);
  });

  it('bank_coupling: both present accepted', async () => {
    await db.query(
      `INSERT INTO vendor_accounts (email, password_hash, bank_account_encrypted, bank_kms_key_id)
       VALUES ('v@y.dev', $1, '\\x00aabb'::bytea, 'arn:kms:key/abc')`, [PW]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_accounts`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('RLS pair', async () => {
    await db.query(`INSERT INTO vendor_accounts (email, password_hash) VALUES ('v@y.dev', $1)`, [PW]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM vendor_accounts`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM vendor_accounts`)).rows.length);
    expect(svc).toBe(1);
  });
});
