import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}

const USER = '11111111-1111-1111-1111-111111111111';
const USER2 = '22222222-2222-2222-2222-222222222222';

function hash(suffix: string): string {
  const base = 'a'.repeat(64 - suffix.length);
  return base + suffix;
}

describe('account_recovery_codes — schema correctness (Phase 2 Unit 32)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid recovery code', async () => {
    await db.query(
      `INSERT INTO account_recovery_codes (user_id, user_type, code_hash)
       VALUES ($1, 'tenant_member', $2)`, [USER, hash('1')]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM account_recovery_codes`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bogus user_type', async () => {
    const err = await tryExec(db,
      `INSERT INTO account_recovery_codes (user_id, user_type, code_hash)
       VALUES ($1, 'guest', $2)`, [USER, hash('1')]);
    expect(err).toMatch(/user_type|check/i);
  });

  it('rejects wrong-length code_hash', async () => {
    const err = await tryExec(db,
      `INSERT INTO account_recovery_codes (user_id, user_type, code_hash)
       VALUES ($1, 'tenant_member', 'short')`, [USER]);
    expect(err).toMatch(/code_hash|check/i);
  });

  it('rejects consumed_at without consumed_ip', async () => {
    const err = await tryExec(db,
      `INSERT INTO account_recovery_codes (user_id, user_type, code_hash, consumed_at)
       VALUES ($1, 'tenant_member', $2, now())`, [USER, hash('1')]);
    expect(err).toMatch(/consumed_pair|check/i);
  });

  it('UNIQUE on code_hash blocks duplicates', async () => {
    await db.query(
      `INSERT INTO account_recovery_codes (user_id, user_type, code_hash)
       VALUES ($1, 'tenant_member', $2)`, [USER, hash('1')]);
    const err = await tryExec(db,
      `INSERT INTO account_recovery_codes (user_id, user_type, code_hash)
       VALUES ($1, 'client', $2)`, [USER2, hash('1')]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('trigger: cap at 20 unconsumed codes per (user, user_type)', async () => {
    for (let i = 1; i <= 20; i++) {
      await db.query(
        `INSERT INTO account_recovery_codes (user_id, user_type, code_hash)
         VALUES ($1, 'tenant_member', $2)`, [USER, hash(String(i).padStart(3, '0'))]);
    }
    const err = await tryExec(db,
      `INSERT INTO account_recovery_codes (user_id, user_type, code_hash)
       VALUES ($1, 'tenant_member', $2)`, [USER, hash('999')]);
    expect(err).toMatch(/too_many_active|check/i);
  });

  it('trigger: consuming a code frees a slot', async () => {
    for (let i = 1; i <= 20; i++) {
      await db.query(
        `INSERT INTO account_recovery_codes (user_id, user_type, code_hash)
         VALUES ($1, 'tenant_member', $2)`, [USER, hash(String(i).padStart(3, '0'))]);
    }
    // Consume one
    await db.query(
      `UPDATE account_recovery_codes SET consumed_at = now(), consumed_ip = '1.2.3.4'::inet
       WHERE code_hash = $1`, [hash('001')]);
    // 20th is consumed, now 19 active — one more should succeed
    await db.query(
      `INSERT INTO account_recovery_codes (user_id, user_type, code_hash)
       VALUES ($1, 'tenant_member', $2)`, [USER, hash('999')]);
    const active = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM account_recovery_codes WHERE consumed_at IS NULL AND user_id = $1`, [USER])).rows[0]!.c;
    expect(active).toBe(20);
  });

  it('different (user, user_type) tracks separately', async () => {
    // Fill USER:tenant_member to 20
    for (let i = 1; i <= 20; i++) {
      await db.query(
        `INSERT INTO account_recovery_codes (user_id, user_type, code_hash)
         VALUES ($1, 'tenant_member', $2)`, [USER, hash(String(i).padStart(3, '0'))]);
    }
    // Different user_type same user_id: still OK
    await db.query(
      `INSERT INTO account_recovery_codes (user_id, user_type, code_hash)
       VALUES ($1, 'client', $2)`, [USER, hash('CLI1')]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM account_recovery_codes`)).rows[0]!.c;
    expect(c).toBe(21);
  });

  it('RLS pair', async () => {
    await db.query(
      `INSERT INTO account_recovery_codes (user_id, user_type, code_hash)
       VALUES ($1, 'tenant_member', $2)`, [USER, hash('1')]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM account_recovery_codes`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM account_recovery_codes`)).rows.length);
    expect(svc).toBe(1);
  });
});
