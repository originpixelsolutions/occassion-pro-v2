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

const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);
const USER = '11111111-1111-1111-1111-111111111111';

describe('auth_sessions — schema correctness (Phase 2 Unit 28)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid tenant_member session', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO auth_sessions (user_id, user_type, tenant_id, portal, refresh_token_hash, expires_at)
       VALUES ($1, 'tenant_member', $2, 'tenant', $3, now() + interval '14 days')`, [USER, t, HASH]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM auth_sessions`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('allows super_admin session without tenant_id', async () => {
    await db.query(
      `INSERT INTO auth_sessions (user_id, user_type, portal, refresh_token_hash, expires_at)
       VALUES ($1, 'super_admin', 'super_admin', $2, now() + interval '14 days')`, [USER, HASH]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM auth_sessions`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects tenant_member without tenant_id', async () => {
    const err = await tryExec(db,
      `INSERT INTO auth_sessions (user_id, user_type, portal, refresh_token_hash, expires_at)
       VALUES ($1, 'tenant_member', 'tenant', $2, now() + interval '14 days')`, [USER, HASH]);
    expect(err).toMatch(/tenant_required_unless_super|check/i);
  });

  it('rejects bogus user_type', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO auth_sessions (user_id, user_type, tenant_id, portal, refresh_token_hash, expires_at)
       VALUES ($1, 'robot', $2, 'tenant', $3, now() + interval '14 days')`, [USER, t, HASH]);
    expect(err).toMatch(/user_type|check/i);
  });

  it('rejects bogus portal', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO auth_sessions (user_id, user_type, tenant_id, portal, refresh_token_hash, expires_at)
       VALUES ($1, 'tenant_member', $2, 'mainframe', $3, now() + interval '14 days')`, [USER, t, HASH]);
    expect(err).toMatch(/portal|check/i);
  });

  it('rejects wrong-length refresh_token_hash', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO auth_sessions (user_id, user_type, tenant_id, portal, refresh_token_hash, expires_at)
       VALUES ($1, 'tenant_member', $2, 'tenant', 'short', now() + interval '14 days')`, [USER, t]);
    expect(err).toMatch(/refresh_hash|check/i);
  });

  it('rejects revoked_at without revoke_reason (and vice versa)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e1 = await tryExec(db,
      `INSERT INTO auth_sessions (user_id, user_type, tenant_id, portal, refresh_token_hash, expires_at, revoked_at)
       VALUES ($1, 'tenant_member', $2, 'tenant', $3, now() + interval '14 days', now())`, [USER, t, HASH]);
    expect(e1).toMatch(/revoked_pair|check/i);
    const e2 = await tryExec(db,
      `INSERT INTO auth_sessions (user_id, user_type, tenant_id, portal, refresh_token_hash, expires_at, revoke_reason)
       VALUES ($1, 'tenant_member', $2, 'tenant', $3, now() + interval '14 days', 'user_logout')`, [USER, t, HASH2]);
    expect(e2).toMatch(/revoked_pair|check/i);
  });

  it('partial UNIQUE: two ACTIVE sessions cannot share refresh_token_hash', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO auth_sessions (user_id, user_type, tenant_id, portal, refresh_token_hash, expires_at)
       VALUES ($1, 'tenant_member', $2, 'tenant', $3, now() + interval '14 days')`, [USER, t, HASH]);
    const err = await tryExec(db,
      `INSERT INTO auth_sessions (user_id, user_type, tenant_id, portal, refresh_token_hash, expires_at)
       VALUES ($1, 'tenant_member', $2, 'tenant', $3, now() + interval '14 days')`, [USER, t, HASH]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('partial UNIQUE: revoked row + new active row CAN share the same hash (rotation)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO auth_sessions (user_id, user_type, tenant_id, portal, refresh_token_hash, expires_at, revoked_at, revoke_reason)
       VALUES ($1, 'tenant_member', $2, 'tenant', $3, now() + interval '14 days', now(), 'refresh_rotation')`, [USER, t, HASH]);
    await db.query(
      `INSERT INTO auth_sessions (user_id, user_type, tenant_id, portal, refresh_token_hash, expires_at)
       VALUES ($1, 'tenant_member', $2, 'tenant', $3, now() + interval '14 days')`, [USER, t, HASH]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM auth_sessions`)).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting tenant removes its sessions', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO auth_sessions (user_id, user_type, tenant_id, portal, refresh_token_hash, expires_at)
       VALUES ($1, 'tenant_member', $2, 'tenant', $3, now() + interval '14 days')`, [USER, t, HASH]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM auth_sessions`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO auth_sessions (user_id, user_type, tenant_id, portal, refresh_token_hash, expires_at)
       VALUES ($1, 'tenant_member', $2, 'tenant', $3, now() + interval '14 days')`, [USER, t, HASH]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM auth_sessions`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM auth_sessions`)).rows.length);
    expect(svc).toBe(1);
  });
});
