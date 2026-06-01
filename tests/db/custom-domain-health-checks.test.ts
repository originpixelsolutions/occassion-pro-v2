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

describe('custom_domain_health_checks — schema correctness (Phase 2 Unit 44)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a healthy CNAME check', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO custom_domain_health_checks (domain, tenant_id, check_type, status, observed_target, http_status, latency_ms)
       VALUES ('go.example.com', $1, 'cname_intact', 'healthy', 'shortlinks.occasionpro.in', 200, 45)`, [t]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM custom_domain_health_checks`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects uppercase / malformed domain', async () => {
    const err = await tryExec(db,
      `INSERT INTO custom_domain_health_checks (domain, check_type, status)
       VALUES ('GO.EXAMPLE.COM', 'cname_intact', 'healthy')`);
    expect(err).toMatch(/domain|check/i);
  });

  it('rejects bogus check_type', async () => {
    const err = await tryExec(db,
      `INSERT INTO custom_domain_health_checks (domain, check_type, status)
       VALUES ('go.example.com', 'tarot_reading', 'healthy')`);
    expect(err).toMatch(/check_type|check/i);
  });

  it('rejects bogus status', async () => {
    const err = await tryExec(db,
      `INSERT INTO custom_domain_health_checks (domain, check_type, status)
       VALUES ('go.example.com', 'cname_intact', 'on_fire')`);
    expect(err).toMatch(/status|check/i);
  });

  it('orphaned scope: status=orphaned requires check_type=orphaned', async () => {
    const err = await tryExec(db,
      `INSERT INTO custom_domain_health_checks (domain, check_type, status)
       VALUES ('go.example.com', 'ssl_valid', 'orphaned')`);
    expect(err).toMatch(/orphaned_scope|check/i);
  });

  it('orphaned scope: orphaned + orphaned is allowed', async () => {
    await db.query(
      `INSERT INTO custom_domain_health_checks (domain, check_type, status, notes)
       VALUES ('go.example.com', 'orphaned', 'orphaned', 'CNAME still points to us; tenant cancelled 14d ago')`);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM custom_domain_health_checks`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects http_status outside 100..599', async () => {
    const err = await tryExec(db,
      `INSERT INTO custom_domain_health_checks (domain, check_type, status, http_status)
       VALUES ('go.example.com', 'content_served', 'healthy', 99)`);
    expect(err).toMatch(/http_status|check/i);
  });

  it('rejects negative latency_ms', async () => {
    const err = await tryExec(db,
      `INSERT INTO custom_domain_health_checks (domain, check_type, status, latency_ms)
       VALUES ('go.example.com', 'content_served', 'healthy', -1)`);
    expect(err).toMatch(/latency|check/i);
  });

  it('SET NULL: deleting tenant keeps the audit row but nulls FK', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO custom_domain_health_checks (domain, tenant_id, check_type, status)
       VALUES ('go.example.com', $1, 'cname_intact', 'healthy')`, [t]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const r = await db.query<{ tenant_id: string | null }>(
      `SELECT tenant_id FROM custom_domain_health_checks`);
    expect(r.rows[0]!.tenant_id).toBeNull();
  });

  it('bigserial PK auto-increments', async () => {
    await db.query(
      `INSERT INTO custom_domain_health_checks (domain, check_type, status) VALUES
         ('go.example.com', 'cname_intact', 'healthy'),
         ('go.example.com', 'ssl_valid',    'warning')`);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM custom_domain_health_checks`)).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('RLS pair', async () => {
    await db.query(
      `INSERT INTO custom_domain_health_checks (domain, check_type, status)
       VALUES ('go.example.com', 'cname_intact', 'healthy')`);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM custom_domain_health_checks`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM custom_domain_health_checks`)).rows.length);
    expect(svc).toBe(1);
  });
});
