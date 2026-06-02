import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, type TestDb } from '../setup/pg.js';

async function mkVendor(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO vendor_accounts (email, company_name, contact_name, phone, password_hash, mfa_enabled, default_currency, failed_login_count)
     VALUES ($1, 'V Co', 'V', '+919999999999', '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX', FALSE, 'INR', 0) RETURNING id`,
    [email])).rows[0]!.id;
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on vendor_crew_members (Phase 12 Unit 102c)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('vendor sees only own crew members', async () => {
    const v1 = await mkVendor(db, 'v1@y.dev');
    const v2 = await mkVendor(db, 'v2@y.dev');
    await db.query(`INSERT INTO vendor_crew_members (vendor_account_id, full_name, status) VALUES ($1, 'Alice', 'active')`, [v1]);
    await db.query(`INSERT INTO vendor_crew_members (vendor_account_id, full_name, status) VALUES ($1, 'Bob', 'active')`, [v2]);
    await setCtx(db, v1, 'vendor', null);
    await asRole(db, 'authenticated');
    const names = (await db.query<{ full_name: string }>(`SELECT full_name FROM vendor_crew_members`)).rows.map(r => r.full_name);
    await asSuperuser(db);
    expect(names).toEqual(['Alice']);
  });

  it('vendor cannot INSERT for another vendor', async () => {
    const me = await mkVendor(db, 'me@y.dev');
    const other = await mkVendor(db, 'other@y.dev');
    await setCtx(db, me, 'vendor', null);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(`INSERT INTO vendor_crew_members (vendor_account_id, full_name, status) VALUES ($1, 'Spoof', 'active')`, [other]); }
    catch (e) { err = e instanceof Error ? e.message : String(e); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });
});
