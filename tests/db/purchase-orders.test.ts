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

describe('purchase_orders — schema correctness (Phase 2 Unit 33)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid pending PO', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency)
       VALUES ($1, 'PO-2026-001', 500000.00, 'INR')`,
      [t],
    );
    const r = await db.query<{ status: string }>(`SELECT status FROM purchase_orders`);
    expect(r.rows[0]!.status).toBe('pending_review');
  });

  it('rejects po_amount <= 0', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency)
       VALUES ($1, 'PO-001', 0, 'INR')`,
      [t],
    );
    expect(err).toMatch(/amount_pos|check/i);
  });

  it('rejects bad currency', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency)
       VALUES ($1, 'PO-001', 1000, 'inr')`,
      [t],
    );
    expect(err).toMatch(/currency|check/i);
  });

  it('rejects amount_consumed > po_amount', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency, amount_consumed)
       VALUES ($1, 'PO-001', 1000, 'INR', 1001)`,
      [t],
    );
    expect(err).toMatch(/consumed_under_amount|check/i);
  });

  it('rejects po_expires_date <= po_issued_date', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency, po_issued_date, po_expires_date)
       VALUES ($1, 'PO-001', 1000, 'INR', '2026-06-01', '2026-05-01')`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('rejects approved_at without approved_by_admin (XOR)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency, approved_at)
       VALUES ($1, 'PO-001', 1000, 'INR', now())`,
      [t],
    );
    expect(err).toMatch(/approved_pair|check/i);
  });

  it("rejects 'active' without approval", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency, status)
       VALUES ($1, 'PO-001', 1000, 'INR', 'active')`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it("rejects 'exhausted' when amount_consumed < po_amount", async () => {
    const t = await mkTenant(db, 'acme-co');
    const ad = await mkAdmin(db, 'admin@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency, approved_at, approved_by_admin, status, amount_consumed)
       VALUES ($1, 'PO-001', 1000, 'INR', now(), $2, 'exhausted', 500)`,
      [t, ad],
    );
    expect(err).toMatch(/check/i);
  });

  it('rejects non-https po_document_url', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency, po_document_url)
       VALUES ($1, 'PO-001', 1000, 'INR', 'http://insecure/po.pdf')`,
      [t],
    );
    expect(err).toMatch(/document_url|check/i);
  });

  it('UNIQUE (tenant_id, po_number) blocks duplicates', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency)
       VALUES ($1, 'PO-001', 1000, 'INR')`,
      [t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency)
       VALUES ($1, 'PO-001', 2000, 'INR')`,
      [t],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('full happy path to active', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ad = await mkAdmin(db, 'admin@y.dev');
    await db.query(
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency, approved_at, approved_by_admin, status)
       VALUES ($1, 'PO-001', 1000, 'INR', now(), $2, 'active')`,
      [t, ad],
    );
    const r = await db.query<{ status: string }>(`SELECT status FROM purchase_orders`);
    expect(r.rows[0]!.status).toBe('active');
  });

  it('CASCADE: deleting tenant removes its POs', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency)
       VALUES ($1, 'PO-001', 1000, 'INR')`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM purchase_orders`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO purchase_orders (tenant_id, po_number, po_amount, po_currency)
       VALUES ($1, 'PO-001', 1000, 'INR')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM purchase_orders`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM purchase_orders`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
