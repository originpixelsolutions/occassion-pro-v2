import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenantId: string, uid: string, email: string, role = 'owner'): Promise<void> {
  await db.query(
    `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($1, $2, $3, 'M', $4)`,
    [uid, tenantId, email, role]);
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on invoices (Phase 12 Unit 104a)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('member sees own tenant invoices only', async () => {
    const t1 = await mkTenant(db, 'inv2-aaa');
    const t2 = await mkTenant(db, 'inv2-bbb');
    await db.query(`INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, discount_total, grand_total, amount_paid, currency_code, status) VALUES ($1, 'INV-1', 'A', '[{"desc":"item","amount":100}]'::jsonb, 100, 0, 0, 100, 0, 'INR', 'draft')`, [t1]);
    await db.query(`INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, discount_total, grand_total, amount_paid, currency_code, status) VALUES ($1, 'INV-2', 'B', '[{"desc":"item","amount":100}]'::jsonb, 100, 0, 0, 100, 0, 'INR', 'draft')`, [t2]);
    const u = '00000000-0000-0000-0000-000000003600';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const nums = (await db.query<{ invoice_number: string }>(`SELECT invoice_number FROM invoices`)).rows.map(r => r.invoice_number);
    await asSuperuser(db);
    expect(nums).toEqual(['INV-1']);
  });

  it('anon sees zero invoices', async () => {
    const t = await mkTenant(db, 'inv2-ccc');
    await db.query(`INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, discount_total, grand_total, amount_paid, currency_code, status) VALUES ($1, 'INV-X', 'X', '[{"desc":"item","amount":100}]'::jsonb, 100, 0, 0, 100, 0, 'INR', 'draft')`, [t]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM invoices`)).rows.length);
    expect(n).toBe(0);
  });

  it('team_member cannot INSERT (manager-gated)', async () => {
    const t = await mkTenant(db, 'inv2-ddd');
    const u = '00000000-0000-0000-0000-000000003610';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(`INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, discount_total, grand_total, amount_paid, currency_code, status) VALUES ($1, 'INV-Y', 'Y', '[{"desc":"item","amount":100}]'::jsonb, 100, 0, 0, 100, 0, 'INR', 'draft')`, [t]); }
    catch (e) { err = e instanceof Error ? e.message : String(e); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });

  it('tenant_member cannot DELETE (super_admin only)', async () => {
    const t = await mkTenant(db, 'inv2-eee');
    const id = (await db.query<{ id: string }>(
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, discount_total, grand_total, amount_paid, currency_code, status) VALUES ($1, 'INV-Z', 'Z', '[{"desc":"item","amount":100}]'::jsonb, 100, 0, 0, 100, 0, 'INR', 'draft') RETURNING id`, [t])).rows[0]!.id;
    const u = '00000000-0000-0000-0000-000000003620';
    await mkMember(db, t, u, 'o@y.dev', 'owner');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH d AS (DELETE FROM invoices WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM d`, [id]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });
});
