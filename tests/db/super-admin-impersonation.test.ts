import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}

async function mkAdmin(db: TestDb, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO super_admins (email, full_name, role) VALUES ($1, 'A', 'owner') RETURNING id`,
    [email],
  );
  return r.rows[0]!.id;
}

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency)
     VALUES ($1, 'Acme', 'INR') RETURNING id`, [slug]);
  return r.rows[0]!.id;
}

async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role)
     VALUES ($1, $2, 'M', 'owner') RETURNING id`, [tenant, email]);
  return r.rows[0]!.id;
}

describe('super_admin_impersonation — schema correctness (Phase 2 Unit 26)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid session', async () => {
    const a = await mkAdmin(db, 'a@y.dev');
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'm@y.dev');
    await db.query(
      `INSERT INTO super_admin_impersonation (super_admin_id, tenant_id, impersonated_user, reason)
       VALUES ($1, $2, $3, 'Investigating support ticket OP-1234')`, [a, t, m]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM super_admin_impersonation`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects short reason (< 10 chars)', async () => {
    const a = await mkAdmin(db, 'a@y.dev');
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'm@y.dev');
    const err = await tryExec(db,
      `INSERT INTO super_admin_impersonation (super_admin_id, tenant_id, impersonated_user, reason)
       VALUES ($1, $2, $3, 'short')`, [a, t, m]);
    expect(err).toMatch(/reason|check/i);
  });

  it('rejects negative action_count', async () => {
    const a = await mkAdmin(db, 'a@y.dev');
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'm@y.dev');
    const err = await tryExec(db,
      `INSERT INTO super_admin_impersonation (super_admin_id, tenant_id, impersonated_user, reason, action_count)
       VALUES ($1, $2, $3, 'A reason long enough', -1)`, [a, t, m]);
    expect(err).toMatch(/action_count|check/i);
  });

  it('rejects ended_at before started_at', async () => {
    const a = await mkAdmin(db, 'a@y.dev');
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'm@y.dev');
    const err = await tryExec(db,
      `INSERT INTO super_admin_impersonation (super_admin_id, tenant_id, impersonated_user, reason, started_at, ended_at)
       VALUES ($1, $2, $3, 'A reason long enough', now(), now() - interval '1 minute')`, [a, t, m]);
    expect(err).toMatch(/ended_order|check/i);
  });

  it('RLS blocks anon DELETE (audit-trail integrity)', async () => {
    const a = await mkAdmin(db, 'a@y.dev');
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'm@y.dev');
    await db.query(
      `INSERT INTO super_admin_impersonation (super_admin_id, tenant_id, impersonated_user, reason)
       VALUES ($1, $2, $3, 'A reason long enough')`, [a, t, m]);
    await withRole(db, 'anon', () => tryExec(db, `DELETE FROM super_admin_impersonation`));
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM super_admin_impersonation`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('append-only trigger: rejects mutating reason', async () => {
    const a = await mkAdmin(db, 'a@y.dev');
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'm@y.dev');
    await db.query(
      `INSERT INTO super_admin_impersonation (super_admin_id, tenant_id, impersonated_user, reason)
       VALUES ($1, $2, $3, 'A reason long enough')`, [a, t, m]);
    const err = await tryExec(db,
      `UPDATE super_admin_impersonation SET reason = 'A different reason long enough'`);
    expect(err).toMatch(/immutable|reason|insufficient_privilege/i);
  });

  it('append-only trigger: allows closing session (ended_at + action_count)', async () => {
    const a = await mkAdmin(db, 'a@y.dev');
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'm@y.dev');
    await db.query(
      `INSERT INTO super_admin_impersonation (super_admin_id, tenant_id, impersonated_user, reason)
       VALUES ($1, $2, $3, 'A reason long enough')`, [a, t, m]);
    await db.query(
      `UPDATE super_admin_impersonation SET ended_at = now(), action_count = 5`);
    const r = await db.query<{ action_count: number; ended_at: string | null }>(
      `SELECT action_count, ended_at FROM super_admin_impersonation`);
    expect(r.rows[0]!.action_count).toBe(5);
    expect(r.rows[0]!.ended_at).not.toBeNull();
  });

  it('RESTRICT on super_admin_id: cannot drop admin while history exists', async () => {
    const a = await mkAdmin(db, 'a@y.dev');
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'm@y.dev');
    await db.query(
      `INSERT INTO super_admin_impersonation (super_admin_id, tenant_id, impersonated_user, reason)
       VALUES ($1, $2, $3, 'A reason long enough')`, [a, t, m]);
    const err = await tryExec(db, `DELETE FROM super_admins WHERE id = $1`, [a]);
    expect(err).toMatch(/foreign key|restrict/i);
  });

  it('CASCADE: deleting tenant removes its impersonation rows', async () => {
    const a = await mkAdmin(db, 'a@y.dev');
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'm@y.dev');
    await db.query(
      `INSERT INTO super_admin_impersonation (super_admin_id, tenant_id, impersonated_user, reason)
       VALUES ($1, $2, $3, 'A reason long enough')`, [a, t, m]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM super_admin_impersonation`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const a = await mkAdmin(db, 'a@y.dev');
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'm@y.dev');
    await db.query(
      `INSERT INTO super_admin_impersonation (super_admin_id, tenant_id, impersonated_user, reason)
       VALUES ($1, $2, $3, 'A reason long enough')`, [a, t, m]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM super_admin_impersonation`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM super_admin_impersonation`)).rows.length);
    expect(svc).toBe(1);
  });
});
