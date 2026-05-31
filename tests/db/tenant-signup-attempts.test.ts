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

const HASH64 = '0'.repeat(64);

describe('tenant_signup_attempts — schema correctness (Phase 2 Unit 4)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid attempt', async () => {
    await db.query(
      `INSERT INTO tenant_signup_attempts (email_hash, email, ip_address, outcome)
       VALUES ($1, 'a@y.dev', '1.2.3.4'::inet, 'verified')`,
      [HASH64],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_signup_attempts`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects email_hash of wrong length', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO tenant_signup_attempts (email_hash, email, ip_address, outcome)
       VALUES ('short', 'a@y.dev', '1.2.3.4'::inet, 'verified')`,
    );
    expect(err).toMatch(/email_hash|check/i);
  });

  it('rejects outcome outside enum', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO tenant_signup_attempts (email_hash, email, ip_address, outcome)
       VALUES ($1, 'a@y.dev', '1.2.3.4'::inet, 'maybe')`,
      [HASH64],
    );
    expect(err).toMatch(/outcome|check/i);
  });

  it('rejects ip_country lowercase', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO tenant_signup_attempts (email_hash, email, ip_address, outcome, ip_country)
       VALUES ($1, 'a@y.dev', '1.2.3.4'::inet, 'verified', 'in')`,
      [HASH64],
    );
    expect(err).toMatch(/ip_country|check/i);
  });

  it('rejects risk_score above 1', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO tenant_signup_attempts (email_hash, email, ip_address, outcome, risk_score)
       VALUES ($1, 'a@y.dev', '1.2.3.4'::inet, 'verified', 1.5)`,
      [HASH64],
    );
    expect(err).toMatch(/risk_score|check/i);
  });

  it('RLS pair', async () => {
    await db.query(
      `INSERT INTO tenant_signup_attempts (email_hash, email, ip_address, outcome)
       VALUES ($1, 'a@y.dev', '1.2.3.4'::inet, 'verified')`,
      [HASH64],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_signup_attempts`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_signup_attempts`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
