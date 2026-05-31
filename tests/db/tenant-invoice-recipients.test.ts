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

describe('tenant_invoice_recipients — schema correctness (Phase 2 Unit 13)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid recipient', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_invoice_recipients (tenant_id, email, name, role)
       VALUES ($1, 'finance@acme.co', 'Finance Team', 'finance')`,
      [t],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_invoice_recipients`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects malformed email', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_invoice_recipients (tenant_id, email) VALUES ($1, 'not-an-email')`,
      [t],
    );
    expect(err).toMatch(/email|check/i);
  });

  it('rejects bogus role', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_invoice_recipients (tenant_id, email, role) VALUES ($1, 'a@y.dev', 'monarch')`,
      [t],
    );
    expect(err).toMatch(/role|check/i);
  });

  it('rejects all-channels-off', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_invoice_recipients (tenant_id, email, receive_invoices, receive_receipts, receive_dunning)
       VALUES ($1, 'a@y.dev', FALSE, FALSE, FALSE)`,
      [t],
    );
    expect(err).toMatch(/one_channel|check/i);
  });

  it('partial UNIQUE: blocks duplicate active email per tenant', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_invoice_recipients (tenant_id, email) VALUES ($1, 'a@y.dev')`,
      [t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_invoice_recipients (tenant_id, email) VALUES ($1, 'a@y.dev')`,
      [t],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('partial UNIQUE: citext compares case-insensitively', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_invoice_recipients (tenant_id, email) VALUES ($1, 'a@y.dev')`,
      [t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_invoice_recipients (tenant_id, email) VALUES ($1, 'A@Y.DEV')`,
      [t],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('a removed recipient does not block a new one with same email', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_invoice_recipients (tenant_id, email, removed_at) VALUES ($1, 'a@y.dev', now())`,
      [t],
    );
    await db.query(
      `INSERT INTO tenant_invoice_recipients (tenant_id, email) VALUES ($1, 'a@y.dev')`,
      [t],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_invoice_recipients`)
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('same email allowed across different tenants', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    await db.query(
      `INSERT INTO tenant_invoice_recipients (tenant_id, email) VALUES ($1, 'a@y.dev'), ($2, 'a@y.dev')`,
      [t1, t2],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_invoice_recipients`)
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting tenant removes its recipients', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_invoice_recipients (tenant_id, email) VALUES ($1, 'a@y.dev')`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_invoice_recipients`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_invoice_recipients (tenant_id, email) VALUES ($1, 'a@y.dev')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_invoice_recipients`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_invoice_recipients`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
