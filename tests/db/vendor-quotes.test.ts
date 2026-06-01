import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
const PW = '$argon2id$v=19$m=65536,t=3,p=4$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenant: string, code='evt-001'): Promise<string> {
  const ty = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'W', FALSE) RETURNING id`, [tenant])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`, [tenant, ty, code])).rows[0]!.id;
}
async function mkVendor(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO vendor_accounts (email, password_hash) VALUES ($1,$2) RETURNING id`, [email, PW])).rows[0]!.id;
}
async function mkAssignment(db: TestDb, t: string, e: string, v: string, cat='catering'): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category)
     VALUES ($1,$2,$3,$4) RETURNING id`, [v, t, e, cat])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1,$2,'M','event_manager') RETURNING id`, [tenant, email])).rows[0]!.id;
}

describe('vendor_quotes — schema correctness (Phase 3 Unit 35)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid submitted quote', async () => {
    const t = await mkTenant(db, 'vq-aaa');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v1@y.dev');
    const a = await mkAssignment(db, t, e, v);
    await db.query(
      `INSERT INTO vendor_quotes (tenant_id, event_id, vendor_assignment_id, vendor_account_id, amount, currency_code, status, submitted_at)
       VALUES ($1,$2,$3,$4, 250000.00, 'INR', 'submitted', now())`, [t, e, a, v]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_quotes`)).rows[0]!.c).toBe(1);
  });

  it('submitted requires submitted_at', async () => {
    const t = await mkTenant(db, 'vq-bbb');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v2@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const err = await tryExec(db,
      `INSERT INTO vendor_quotes (tenant_id, event_id, vendor_assignment_id, vendor_account_id, amount, currency_code, status)
       VALUES ($1,$2,$3,$4, 1000, 'INR', 'submitted')`, [t, e, a, v]);
    expect(err).toMatch(/check/i);
  });

  it('tenant_approved requires reviewer + reviewed_at', async () => {
    const t = await mkTenant(db, 'vq-ccc');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v3@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const err = await tryExec(db,
      `INSERT INTO vendor_quotes (tenant_id, event_id, vendor_assignment_id, vendor_account_id, amount, currency_code, status, submitted_at)
       VALUES ($1,$2,$3,$4, 1000, 'INR', 'tenant_approved', now())`, [t, e, a, v]);
    expect(err).toMatch(/check/i);
  });

  it('tenant_rejected requires review_notes', async () => {
    const t = await mkTenant(db, 'vq-ddd');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v4@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const m = await mkMember(db, t, 'r@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_quotes (tenant_id, event_id, vendor_assignment_id, vendor_account_id, amount, currency_code, status, submitted_at, tenant_reviewed_at, tenant_reviewed_by)
       VALUES ($1,$2,$3,$4, 1000, 'INR', 'tenant_rejected', now(), now(), $5)`, [t, e, a, v, m]);
    expect(err).toMatch(/check/i);
  });

  it('client_approved requires full review chain', async () => {
    const t = await mkTenant(db, 'vq-eee');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v5@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const err = await tryExec(db,
      `INSERT INTO vendor_quotes (tenant_id, event_id, vendor_assignment_id, vendor_account_id, amount, currency_code, status, submitted_at, tenant_reviewed_at)
       VALUES ($1,$2,$3,$4, 1000, 'INR', 'client_approved', now(), now())`, [t, e, a, v]);
    expect(err).toMatch(/check/i);
  });

  it('rejects bad currency_code', async () => {
    const t = await mkTenant(db, 'vq-fff');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v6@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const err = await tryExec(db,
      `INSERT INTO vendor_quotes (tenant_id, event_id, vendor_assignment_id, vendor_account_id, amount, currency_code, status, submitted_at)
       VALUES ($1,$2,$3,$4, 1000, 'inr', 'submitted', now())`, [t, e, a, v]);
    expect(err).toMatch(/currency|check/i);
  });

  it('rejects non-https document_url', async () => {
    const t = await mkTenant(db, 'vq-ggg');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v7@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const err = await tryExec(db,
      `INSERT INTO vendor_quotes (tenant_id, event_id, vendor_assignment_id, vendor_account_id, amount, currency_code, document_url, status, submitted_at)
       VALUES ($1,$2,$3,$4, 1000, 'INR', 'http://insecure/q.pdf', 'submitted', now())`, [t, e, a, v]);
    expect(err).toMatch(/document_url|check/i);
  });

  it('superseded cycle: A->B, B->A rejected', async () => {
    const t = await mkTenant(db, 'vq-hhh');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v8@y.dev');
    const a = await mkAssignment(db, t, e, v);
    const q1 = (await db.query<{ id: string }>(
      `INSERT INTO vendor_quotes (tenant_id, event_id, vendor_assignment_id, vendor_account_id, amount, currency_code, status, submitted_at)
       VALUES ($1,$2,$3,$4, 1000, 'INR', 'submitted', now()) RETURNING id`, [t, e, a, v])).rows[0]!.id;
    const q2 = (await db.query<{ id: string }>(
      `INSERT INTO vendor_quotes (tenant_id, event_id, vendor_assignment_id, vendor_account_id, amount, currency_code, status, submitted_at, superseded_by)
       VALUES ($1,$2,$3,$4, 1200, 'INR', 'submitted', now(), $5) RETURNING id`, [t, e, a, v, q1])).rows[0]!.id;
    const err = await tryExec(db, `UPDATE vendor_quotes SET superseded_by = $1 WHERE id = $2`, [q2, q1]);
    expect(err).toMatch(/cycle|check/i);
  });

  it('assignment vendor mismatch rejected', async () => {
    const t = await mkTenant(db, 'vq-iii');
    const e = await mkEvent(db, t);
    const v1 = await mkVendor(db, 'va@y.dev');
    const v2 = await mkVendor(db, 'vb@y.dev');
    const a1 = await mkAssignment(db, t, e, v1);
    const err = await tryExec(db,
      `INSERT INTO vendor_quotes (tenant_id, event_id, vendor_assignment_id, vendor_account_id, amount, currency_code, status, submitted_at)
       VALUES ($1,$2,$3,$4, 1000, 'INR', 'submitted', now())`, [t, e, a1, v2]);
    expect(err).toMatch(/vendor_assignment_id|tenant\/event\/vendor/i);
  });

  it('cross-tenant reviewer rejected', async () => {
    const t1 = await mkTenant(db, 'vq-ttt');
    const e1 = await mkEvent(db, t1);
    const v = await mkVendor(db, 'vc@y.dev');
    const a = await mkAssignment(db, t1, e1, v);
    const t2 = await mkTenant(db, 'vq-uuu');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_quotes (tenant_id, event_id, vendor_assignment_id, vendor_account_id, amount, currency_code, status, submitted_at, tenant_reviewed_at, tenant_reviewed_by)
       VALUES ($1,$2,$3,$4, 1000, 'INR', 'tenant_approved', now(), now(), $5)`, [t1, e1, a, v, mOther]);
    expect(err).toMatch(/tenant_reviewed_by|tenant/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'vq-www');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'vd@y.dev');
    const a = await mkAssignment(db, t, e, v);
    await db.query(
      `INSERT INTO vendor_quotes (tenant_id, event_id, vendor_assignment_id, vendor_account_id, amount, currency_code, status, submitted_at)
       VALUES ($1,$2,$3,$4, 1000, 'INR', 'submitted', now())`, [t, e, a, v]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM vendor_quotes`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM vendor_quotes`)).rows.length);
    expect(svc).toBe(1);
  });
});
