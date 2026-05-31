/**
 * tenant_members — Phase 2 Unit 2.
 * Covers: role enum, one-owner-per-tenant invariant, soft-delete-aware
 * email uniqueness, recovery phone E.164, FK CASCADE from tenants,
 * RLS pair.
 */
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

async function newTenant(db: TestDb, slug = 'acme-co') {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`,
    [slug],
  );
  return r.rows[0]!.id;
}

describe('tenant_members — schema correctness (Phase 2 Unit 2)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts an owner', async () => {
    const t = await newTenant(db);
    const r = await db.query<{ role: string }>(
      `INSERT INTO tenant_members (tenant_id, email, full_name, role)
       VALUES ($1,'owner@y.dev','Owner','owner') RETURNING role`,
      [t],
    );
    expect(r.rows[0]!.role).toBe('owner');
  });

  it('rejects role outside enum', async () => {
    const t = await newTenant(db);
    const err = await tryExec(
      db,
      `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1,'x@y.dev','X','overlord')`,
      [t],
    );
    expect(err).toMatch(/role|check/i);
  });

  it('enforces one_owner_per_workspace', async () => {
    const t = await newTenant(db);
    await db.query(
      `INSERT INTO tenant_members (tenant_id, email, full_name, role)
       VALUES ($1,'o1@y.dev','O1','owner')`,
      [t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_members (tenant_id, email, full_name, role)
       VALUES ($1,'o2@y.dev','O2','owner')`,
      [t],
    );
    expect(err).toMatch(/one_owner|unique|duplicate/i);
  });

  it('allows reusing email after soft-delete', async () => {
    const t = await newTenant(db);
    const first = await db.query<{ id: string }>(
      `INSERT INTO tenant_members (tenant_id, email, full_name, role)
       VALUES ($1,'reuse@y.dev','R','team_member') RETURNING id`,
      [t],
    );
    await db.query(`UPDATE tenant_members SET removed_at = now() WHERE id = $1`, [
      first.rows[0]!.id,
    ]);
    await db.query(
      `INSERT INTO tenant_members (tenant_id, email, full_name, role)
       VALUES ($1,'reuse@y.dev','R2','team_lead')`,
      [t],
    );
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM tenant_members WHERE email = 'reuse@y.dev'`,
      )
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('rejects bad E.164 recovery_phone', async () => {
    const t = await newTenant(db);
    const err = await tryExec(
      db,
      `INSERT INTO tenant_members (tenant_id, email, full_name, role, recovery_phone)
       VALUES ($1,'p@y.dev','P','team_member','not-a-phone')`,
      [t],
    );
    expect(err).toMatch(/recovery_phone|check/i);
  });

  it('CASCADE deletes members when tenant deleted', async () => {
    const t = await newTenant(db);
    await db.query(
      `INSERT INTO tenant_members (tenant_id, email, full_name, role)
       VALUES ($1,'casc@y.dev','C','owner')`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_members`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await newTenant(db);
    await db.query(
      `INSERT INTO tenant_members (tenant_id, email, full_name, role)
       VALUES ($1,'rls@y.dev','R','owner')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM tenant_members`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM tenant_members`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
