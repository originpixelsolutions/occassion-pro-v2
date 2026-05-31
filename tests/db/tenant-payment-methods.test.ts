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

describe('tenant_payment_methods — schema correctness (Phase 2 Unit 12)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid method', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id, last4, brand, exp_month, exp_year)
       VALUES ($1, 'razorpay', 'pm_tok_1', '4242', 'visa', 6, 2030)`,
      [t],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_payment_methods`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bogus gateway', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id)
       VALUES ($1, 'paypal', 'pm_x')`,
      [t],
    );
    expect(err).toMatch(/gateway|check/i);
  });

  it('rejects bogus brand', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id, brand)
       VALUES ($1, 'razorpay', 'pm_x', 'monopoly')`,
      [t],
    );
    expect(err).toMatch(/brand|check/i);
  });

  it('rejects bad last4 format', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id, last4)
       VALUES ($1, 'razorpay', 'pm_x', '42')`,
      [t],
    );
    expect(err).toMatch(/last4|check/i);
  });

  it('rejects exp_month outside 1..12', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id, exp_month, exp_year)
       VALUES ($1, 'razorpay', 'pm_x', 13, 2030)`,
      [t],
    );
    expect(err).toMatch(/month|check/i);
  });

  it('rejects exp_month without exp_year', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id, exp_month)
       VALUES ($1, 'razorpay', 'pm_x', 6)`,
      [t],
    );
    expect(err).toMatch(/exp_pair|check/i);
  });

  it('rejects a method that is BOTH primary AND backup', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id, is_primary, is_backup)
       VALUES ($1, 'razorpay', 'pm_x', TRUE, TRUE)`,
      [t],
    );
    expect(err).toMatch(/primary_backup_mx|check/i);
  });

  it('partial UNIQUE: only one active primary per tenant', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id, is_primary)
       VALUES ($1, 'razorpay', 'pm_a', TRUE)`,
      [t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id, is_primary)
       VALUES ($1, 'razorpay', 'pm_b', TRUE)`,
      [t],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('partial UNIQUE: a removed primary does not block a new primary', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id, is_primary, removed_at)
       VALUES ($1, 'razorpay', 'pm_a', TRUE, now())`,
      [t],
    );
    await db.query(
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id, is_primary)
       VALUES ($1, 'razorpay', 'pm_b', TRUE)`,
      [t],
    );
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM tenant_payment_methods WHERE is_primary`,
      )
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('partial UNIQUE: gateway token de-dup blocks reuse of same token', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id)
       VALUES ($1, 'razorpay', 'pm_dup')`,
      [t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id)
       VALUES ($1, 'razorpay', 'pm_dup')`,
      [t],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('CASCADE: deleting tenant removes its payment methods', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id)
       VALUES ($1, 'razorpay', 'pm_x')`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_payment_methods`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_payment_methods (tenant_id, gateway, gateway_payment_method_id)
       VALUES ($1, 'razorpay', 'pm_x')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_payment_methods`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_payment_methods`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
