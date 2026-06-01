import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
const PW = '$argon2id$v=19$m=65536,t=3,p=4$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);
async function mkVendor(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO vendor_accounts (email, password_hash) VALUES ($1,$2) RETURNING id`, [email, PW])).rows[0]!.id;
}

describe('vendor_crew_members — schema correctness (Phase 3 Unit 39)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid crew member', async () => {
    const v = await mkVendor(db, 'v1@y.dev');
    await db.query(
      `INSERT INTO vendor_crew_members (vendor_account_id, full_name, role, phone, email, hourly_rate, currency_code)
       VALUES ($1,'Ravi Kumar','head_chef','+919876543210','ravi@kitchen.in', 500.00, 'INR')`, [v]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_crew_members`)).rows[0]!.c).toBe(1);
  });

  it('rejects bad role', async () => {
    const v = await mkVendor(db, 'v2@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_crew_members (vendor_account_id, full_name, role) VALUES ($1,'A','barista')`, [v]);
    expect(err).toMatch(/role|check/i);
  });

  it('rejects bad phone (no +)', async () => {
    const v = await mkVendor(db, 'v3@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_crew_members (vendor_account_id, full_name, phone) VALUES ($1,'A','9876543210')`, [v]);
    expect(err).toMatch(/phone|check/i);
  });

  it('rejects bad email format', async () => {
    const v = await mkVendor(db, 'v4@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_crew_members (vendor_account_id, full_name, email) VALUES ($1,'A','not-an-email')`, [v]);
    expect(err).toMatch(/email|check/i);
  });

  it('citext email case-fold', async () => {
    const v = await mkVendor(db, 'v5@y.dev');
    await db.query(
      `INSERT INTO vendor_crew_members (vendor_account_id, full_name, email) VALUES ($1,'A','Ravi@Y.DEV')`, [v]);
    const r = await db.query<{ email: string }>(
      `SELECT email FROM vendor_crew_members WHERE email='ravi@y.dev'`);
    expect(r.rows).toHaveLength(1);
  });

  it('rate without currency rejected', async () => {
    const v = await mkVendor(db, 'v6@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_crew_members (vendor_account_id, full_name, hourly_rate) VALUES ($1,'A', 500.00)`, [v]);
    expect(err).toMatch(/rate_currency|check/i);
  });

  it('inactive requires deactivated_at', async () => {
    const v = await mkVendor(db, 'v7@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_crew_members (vendor_account_id, full_name, status) VALUES ($1,'A','inactive')`, [v]);
    expect(err).toMatch(/inactive_coupling|check/i);
  });

  it('inactive happy path', async () => {
    const v = await mkVendor(db, 'v8@y.dev');
    await db.query(
      `INSERT INTO vendor_crew_members (vendor_account_id, full_name, status, deactivated_at, deactivated_reason)
       VALUES ($1,'A','inactive', now(), 'left the team')`, [v]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_crew_members WHERE status='inactive'`)).rows[0]!.c).toBe(1);
  });

  it('rejects negative hourly_rate', async () => {
    const v = await mkVendor(db, 'v9@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_crew_members (vendor_account_id, full_name, hourly_rate, currency_code) VALUES ($1,'A', -1, 'INR')`, [v]);
    expect(err).toMatch(/hourly_rate|check/i);
  });

  it('two crew with same name on same vendor allowed (no UNIQUE)', async () => {
    const v = await mkVendor(db, 'va@y.dev');
    await db.query(`INSERT INTO vendor_crew_members (vendor_account_id, full_name) VALUES ($1,'John Smith')`, [v]);
    await db.query(`INSERT INTO vendor_crew_members (vendor_account_id, full_name) VALUES ($1,'John Smith')`, [v]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_crew_members`)).rows[0]!.c).toBe(2);
  });

  it('RLS pair', async () => {
    const v = await mkVendor(db, 'vw@y.dev');
    await db.query(`INSERT INTO vendor_crew_members (vendor_account_id, full_name) VALUES ($1,'A')`, [v]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM vendor_crew_members`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM vendor_crew_members`)).rows.length);
    expect(svc).toBe(1);
  });
});
