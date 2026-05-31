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

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency)
     VALUES ($1, 'Acme', 'INR') RETURNING id`,
    [slug],
  );
  return r.rows[0]!.id;
}

async function mkAdmin(db: TestDb, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO super_admins (email, full_name, role) VALUES ($1, 'A', 'owner') RETURNING id`,
    [email],
  );
  return r.rows[0]!.id;
}

describe('tenant_custom_domains — schema correctness (Phase 2 Unit 8)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid domain (default status pending_dns)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_custom_domains (tenant_id, domain, purpose, cname_target)
       VALUES ($1, 'go.example.com', 'shortlinks', 'shortlinks.occasionpro.in')`,
      [t],
    );
    const r = await db.query<{ status: string }>(
      `SELECT status FROM tenant_custom_domains WHERE tenant_id = $1`,
      [t],
    );
    expect(r.rows[0]!.status).toBe('pending_dns');
  });

  it('UNIQUE on domain blocks duplicates across tenants', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    await db.query(
      `INSERT INTO tenant_custom_domains (tenant_id, domain, purpose, cname_target)
       VALUES ($1, 'go.example.com', 'shortlinks', 'x.occasionpro.in')`,
      [t1],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_custom_domains (tenant_id, domain, purpose, cname_target)
       VALUES ($1, 'go.example.com', 'website', 'x.occasionpro.in')`,
      [t2],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('rejects uppercase or malformed domain', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_custom_domains (tenant_id, domain, purpose, cname_target)
       VALUES ($1, 'GO.EXAMPLE.COM', 'shortlinks', 'x.occasionpro.in')`,
      [t],
    );
    expect(err).toMatch(/domain|check/i);
  });

  it('rejects bogus purpose', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_custom_domains (tenant_id, domain, purpose, cname_target)
       VALUES ($1, 'go.example.com', 'invalid', 'x.occasionpro.in')`,
      [t],
    );
    expect(err).toMatch(/purpose|check/i);
  });

  it('rejects bogus status', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_custom_domains (tenant_id, domain, purpose, cname_target, status)
       VALUES ($1, 'go.example.com', 'shortlinks', 'x.occasionpro.in', 'invalid')`,
      [t],
    );
    expect(err).toMatch(/status|check/i);
  });

  it("rejects 'dns_verified' without dns_verified_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_custom_domains (tenant_id, domain, purpose, cname_target, status)
       VALUES ($1, 'go.example.com', 'shortlinks', 'x.occasionpro.in', 'dns_verified')`,
      [t],
    );
    expect(err).toMatch(/dns_verified_at|check/i);
  });

  it("rejects 'active' without all four prereqs", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_custom_domains (tenant_id, domain, purpose, cname_target, status, dns_verified_at)
       VALUES ($1, 'go.example.com', 'shortlinks', 'x.occasionpro.in', 'active', now())`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('approved_at <-> approved_by are coupled (XOR rejected)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_custom_domains (tenant_id, domain, purpose, cname_target, approved_at)
       VALUES ($1, 'go.example.com', 'shortlinks', 'x.occasionpro.in', now())`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('full happy path to active', async () => {
    const t = await mkTenant(db, 'acme-co');
    const admin = await mkAdmin(db, 'a@y.dev');
    await db.query(
      `INSERT INTO tenant_custom_domains (
         tenant_id, domain, purpose, cname_target,
         dns_verified_at, approved_by, approved_at, ssl_provisioned_at, status
       ) VALUES (
         $1, 'go.example.com', 'shortlinks', 'x.occasionpro.in',
         now(), $2, now(), now(), 'active'
       )`,
      [t, admin],
    );
    const r = await db.query<{ status: string }>(
      `SELECT status FROM tenant_custom_domains WHERE tenant_id = $1`,
      [t],
    );
    expect(r.rows[0]!.status).toBe('active');
  });

  it('CASCADE: deleting tenant removes its domains', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_custom_domains (tenant_id, domain, purpose, cname_target)
       VALUES ($1, 'go.example.com', 'shortlinks', 'x.occasionpro.in')`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_custom_domains`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_custom_domains (tenant_id, domain, purpose, cname_target)
       VALUES ($1, 'go.example.com', 'shortlinks', 'x.occasionpro.in')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_custom_domains`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_custom_domains`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
