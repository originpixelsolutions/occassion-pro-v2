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

describe('tenant_data_exports — schema correctness (Phase 2 Unit 14)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a queued export (default state)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(`INSERT INTO tenant_data_exports (tenant_id, export_type) VALUES ($1, 'dsar')`, [
      t,
    ]);
    const r = await db.query<{ status: string }>(
      `SELECT status FROM tenant_data_exports WHERE tenant_id = $1`,
      [t],
    );
    expect(r.rows[0]!.status).toBe('queued');
  });

  it('rejects bogus export_type', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_data_exports (tenant_id, export_type) VALUES ($1, 'partial')`,
      [t],
    );
    expect(err).toMatch(/type|check/i);
  });

  it('rejects http (non-https) zip_url', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_data_exports (tenant_id, export_type, status, started_at, completed_at, zip_url, zip_expires_at)
       VALUES ($1, 'full', 'completed', now(), now(), 'http://insecure/zip', now() + interval '7 days')`,
      [t],
    );
    expect(err).toMatch(/https|check/i);
  });

  it('rejects negative zip_size_bytes', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_data_exports (tenant_id, export_type, zip_size_bytes) VALUES ($1, 'full', -1)`,
      [t],
    );
    expect(err).toMatch(/size|check/i);
  });

  it("rejects 'running' without started_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_data_exports (tenant_id, export_type, status) VALUES ($1, 'full', 'running')`,
      [t],
    );
    expect(err).toMatch(/started_at|check/i);
  });

  it("rejects 'completed' missing any prereq", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_data_exports (tenant_id, export_type, status, started_at, completed_at)
       VALUES ($1, 'full', 'completed', now(), now())`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it("rejects 'failed' without error_message", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_data_exports (tenant_id, export_type, status, completed_at)
       VALUES ($1, 'full', 'failed', now())`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('zip_expires_at must be after completed_at', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_data_exports (tenant_id, export_type, status, started_at, completed_at, zip_url, zip_expires_at)
       VALUES ($1, 'full', 'completed', now(), now(), 'https://r2.example/x.zip', now() - interval '1 day')`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('happy path to completed', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_data_exports (tenant_id, export_type, status, started_at, completed_at, zip_url, zip_expires_at, zip_size_bytes)
       VALUES ($1, 'full', 'completed', now() - interval '1 hour', now(), 'https://r2.example/x.zip', now() + interval '7 days', 12345)`,
      [t],
    );
    const r = await db.query<{ status: string }>(
      `SELECT status FROM tenant_data_exports WHERE tenant_id = $1`,
      [t],
    );
    expect(r.rows[0]!.status).toBe('completed');
  });

  it('CASCADE: deleting tenant removes its exports', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(`INSERT INTO tenant_data_exports (tenant_id, export_type) VALUES ($1, 'dsar')`, [
      t,
    ]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_data_exports`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(`INSERT INTO tenant_data_exports (tenant_id, export_type) VALUES ($1, 'dsar')`, [
      t,
    ]);
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_data_exports`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_data_exports`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
