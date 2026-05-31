import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency)
     VALUES ($1, 'Acme', 'INR') RETURNING id`, [slug]);
  return r.rows[0]!.id;
}

async function mkMember(db: TestDb, tenant: string, email: string, role = 'event_manager'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role)
     VALUES ($1, $2, 'M', $3) RETURNING id`, [tenant, email, role]);
  return r.rows[0]!.id;
}

async function mkAdmin(db: TestDb, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO super_admins (email, full_name, role) VALUES ($1, 'A', 'owner') RETURNING id`,
    [email],
  );
  return r.rows[0]!.id;
}

const REASON = 'Owner unreachable for 28 days; legal recovery requested by next of kin.';

describe('pending_emergency_transfers — schema correctness (Phase 2 Unit 27)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid pending transfer', async () => {
    const t = await mkTenant(db, 'acme-co');
    const cur = await mkMember(db, t, 'current@y.dev', 'owner');
    const nxt = await mkMember(db, t, 'next@y.dev');
    const ad = await mkAdmin(db, 'admin@y.dev');
    await db.query(
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, dispute_window_end)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 days')`, [t, cur, nxt, REASON, ad]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM pending_emergency_transfers`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects current = proposed', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev', 'owner');
    const ad = await mkAdmin(db, 'admin@y.dev');
    const err = await tryExec(db,
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, dispute_window_end)
       VALUES ($1, $2, $2, $3, $4, now() + interval '30 days')`, [t, m, REASON, ad]);
    expect(err).toMatch(/owners_differ|check/i);
  });

  it('rejects short reason (< 20 chars)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const cur = await mkMember(db, t, 'current@y.dev', 'owner');
    const nxt = await mkMember(db, t, 'next@y.dev');
    const ad = await mkAdmin(db, 'admin@y.dev');
    const err = await tryExec(db,
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, dispute_window_end)
       VALUES ($1, $2, $3, 'tooshort', $4, now() + interval '30 days')`, [t, cur, nxt, ad]);
    expect(err).toMatch(/reason|check/i);
  });

  it('rejects dispute_window_end <= initiated_at', async () => {
    const t = await mkTenant(db, 'acme-co');
    const cur = await mkMember(db, t, 'current@y.dev', 'owner');
    const nxt = await mkMember(db, t, 'next@y.dev');
    const ad = await mkAdmin(db, 'admin@y.dev');
    const err = await tryExec(db,
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, initiated_at, dispute_window_end)
       VALUES ($1, $2, $3, $4, $5, now(), now() - interval '1 day')`, [t, cur, nxt, REASON, ad]);
    expect(err).toMatch(/dispute_window|check/i);
  });

  it('rejects non-https evidence_url', async () => {
    const t = await mkTenant(db, 'acme-co');
    const cur = await mkMember(db, t, 'current@y.dev', 'owner');
    const nxt = await mkMember(db, t, 'next@y.dev');
    const ad = await mkAdmin(db, 'admin@y.dev');
    const err = await tryExec(db,
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, dispute_window_end, evidence_url)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 days', 'http://insecure/evidence.pdf')`,
      [t, cur, nxt, REASON, ad]);
    expect(err).toMatch(/evidence|check/i);
  });

  it('rejects both completed and cancelled set', async () => {
    const t = await mkTenant(db, 'acme-co');
    const cur = await mkMember(db, t, 'current@y.dev', 'owner');
    const nxt = await mkMember(db, t, 'next@y.dev');
    const ad = await mkAdmin(db, 'admin@y.dev');
    const err = await tryExec(db,
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, dispute_window_end,
         completed_at, completed_by, cancelled_at, cancelled_by)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 days', now() + interval '40 days', $5, now() + interval '40 days', $5)`,
      [t, cur, nxt, REASON, ad]);
    expect(err).toMatch(/terminal_mx|check/i);
  });

  it("rejects 'completed' before dispute_window_end", async () => {
    const t = await mkTenant(db, 'acme-co');
    const cur = await mkMember(db, t, 'current@y.dev', 'owner');
    const nxt = await mkMember(db, t, 'next@y.dev');
    const ad = await mkAdmin(db, 'admin@y.dev');
    const err = await tryExec(db,
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, dispute_window_end, completed_at, completed_by)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 days', now() + interval '5 days', $5)`,
      [t, cur, nxt, REASON, ad]);
    expect(err).toMatch(/check/i);
  });

  it('rejects disputed_at without dispute_channel', async () => {
    const t = await mkTenant(db, 'acme-co');
    const cur = await mkMember(db, t, 'current@y.dev', 'owner');
    const nxt = await mkMember(db, t, 'next@y.dev');
    const ad = await mkAdmin(db, 'admin@y.dev');
    const err = await tryExec(db,
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, dispute_window_end, disputed_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 days', now())`,
      [t, cur, nxt, REASON, ad]);
    expect(err).toMatch(/check/i);
  });

  it('partial UNIQUE: blocks second open transfer per tenant', async () => {
    const t = await mkTenant(db, 'acme-co');
    const cur = await mkMember(db, t, 'current@y.dev', 'owner');
    const nxt = await mkMember(db, t, 'next@y.dev');
    const nxt2 = await mkMember(db, t, 'next2@y.dev');
    const ad = await mkAdmin(db, 'admin@y.dev');
    await db.query(
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, dispute_window_end)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 days')`, [t, cur, nxt, REASON, ad]);
    const err = await tryExec(db,
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, dispute_window_end)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 days')`, [t, cur, nxt2, REASON, ad]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('a cancelled transfer does not block a new pending one', async () => {
    const t = await mkTenant(db, 'acme-co');
    const cur = await mkMember(db, t, 'current@y.dev', 'owner');
    const nxt = await mkMember(db, t, 'next@y.dev');
    const ad = await mkAdmin(db, 'admin@y.dev');
    await db.query(
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, dispute_window_end, cancelled_at, cancelled_by)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 days', now(), $5)`, [t, cur, nxt, REASON, ad]);
    await db.query(
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, dispute_window_end)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 days')`, [t, cur, nxt, REASON, ad]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM pending_emergency_transfers`)).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting tenant removes its transfer rows', async () => {
    const t = await mkTenant(db, 'acme-co');
    const cur = await mkMember(db, t, 'current@y.dev', 'owner');
    const nxt = await mkMember(db, t, 'next@y.dev');
    const ad = await mkAdmin(db, 'admin@y.dev');
    await db.query(
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, dispute_window_end)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 days')`, [t, cur, nxt, REASON, ad]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM pending_emergency_transfers`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const cur = await mkMember(db, t, 'current@y.dev', 'owner');
    const nxt = await mkMember(db, t, 'next@y.dev');
    const ad = await mkAdmin(db, 'admin@y.dev');
    await db.query(
      `INSERT INTO pending_emergency_transfers (tenant_id, current_owner_id, proposed_owner_id, reason, initiated_by_admin, dispute_window_end)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 days')`, [t, cur, nxt, REASON, ad]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM pending_emergency_transfers`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM pending_emergency_transfers`)).rows.length);
    expect(svc).toBe(1);
  });
});
