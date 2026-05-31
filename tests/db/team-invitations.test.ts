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

const TOK = 'a'.repeat(32);
const TOK2 = 'b'.repeat(32);

describe('team_invitations — schema correctness (Phase 2 Unit 25)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid pending invitation', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'a@y.dev', 'team_member', $2, now() + interval '7 days')`, [t, TOK]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM team_invitations`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects malformed email', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'not-an-email', 'team_member', $2, now() + interval '7 days')`, [t, TOK]);
    expect(err).toMatch(/email|check/i);
  });

  it('rejects bogus role (owner not allowed)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'a@y.dev', 'owner', $2, now() + interval '7 days')`, [t, TOK]);
    expect(err).toMatch(/role|check/i);
  });

  it('rejects short token (< 32 chars)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'a@y.dev', 'team_member', 'short', now() + interval '7 days')`, [t]);
    expect(err).toMatch(/token|check/i);
  });

  it('rejects token with disallowed characters', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'a@y.dev', 'team_member', $2, now() + interval '7 days')`, [t, 'x'.repeat(40) + '!@#']);
    expect(err).toMatch(/token|check/i);
  });

  it('rejects expires_at <= created_at', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'a@y.dev', 'team_member', $2, now() - interval '1 day')`, [t, TOK]);
    expect(err).toMatch(/expires|check/i);
  });

  it("rejects 'accepted' without accepted_at and accepted_by", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, status, expires_at)
       VALUES ($1, 'a@y.dev', 'team_member', $2, 'accepted', now() + interval '7 days')`, [t, TOK]);
    expect(err).toMatch(/accepted|check/i);
  });

  it('UNIQUE on token blocks duplicates', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    await db.query(
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'a@y.dev', 'team_member', $2, now() + interval '7 days')`, [t1, TOK]);
    const err = await tryExec(db,
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'b@y.dev', 'team_member', $2, now() + interval '7 days')`, [t2, TOK]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('partial UNIQUE: blocks second open invitation per (tenant, email)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'a@y.dev', 'team_member', $2, now() + interval '7 days')`, [t, TOK]);
    const err = await tryExec(db,
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'a@y.dev', 'event_manager', $2, now() + interval '7 days')`, [t, TOK2]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('revoked invitation does not block a new pending one (same email)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, status, revoked_at, expires_at)
       VALUES ($1, 'a@y.dev', 'team_member', $2, 'revoked', now(), now() + interval '7 days')`, [t, TOK]);
    await db.query(
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'a@y.dev', 'team_member', $2, now() + interval '7 days')`, [t, TOK2]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM team_invitations`)).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('citext case-fold blocks case-variant duplicate', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'a@y.dev', 'team_member', $2, now() + interval '7 days')`, [t, TOK]);
    const err = await tryExec(db,
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'A@Y.DEV', 'team_member', $2, now() + interval '7 days')`, [t, TOK2]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('CASCADE: deleting tenant removes invitations', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'a@y.dev', 'team_member', $2, now() + interval '7 days')`, [t, TOK]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM team_invitations`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO team_invitations (tenant_id, invited_email, role, token, expires_at)
       VALUES ($1, 'a@y.dev', 'team_member', $2, now() + interval '7 days')`, [t, TOK]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM team_invitations`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM team_invitations`)).rows.length);
    expect(svc).toBe(1);
  });
});
