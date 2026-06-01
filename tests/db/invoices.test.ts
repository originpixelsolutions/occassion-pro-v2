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
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`,
      [slug],
    )
  ).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenant: string, code = 'evt-001'): Promise<string> {
  const ty = (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'W', FALSE) RETURNING id`,
      [tenant],
    )
  ).rows[0]!.id;
  return (
    await db.query<{ id: string }>(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`,
      [tenant, ty, code],
    )
  ).rows[0]!.id;
}

describe('invoices — schema correctness (Phase 6 Unit 45)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid draft invoice', async () => {
    const t = await mkTenant(db, 'inv-aaa');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO invoices (tenant_id, event_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code)
       VALUES ($1,$2,'INV-2026/01-001','Acme Wedding','[{"desc":"Catering","qty":1,"price":250000}]'::jsonb, 250000, 45000, 295000, 'INR')`,
      [t, e],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM invoices`)).rows[0]!.c,
    ).toBe(1);
  });

  it('grand_total math invariant enforced', async () => {
    const t = await mkTenant(db, 'inv-bbb');
    const err = await tryExec(
      db,
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code)
       VALUES ($1,'INV-001','X','[{"d":"x"}]'::jsonb, 100, 18, 999, 'INR')`,
      [t],
    );
    expect(err).toMatch(/grand_total_math|check/i);
  });

  it('amount_paid > grand_total rejected', async () => {
    const t = await mkTenant(db, 'inv-ccc');
    const err = await tryExec(
      db,
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code, amount_paid)
       VALUES ($1,'INV-001','X','[{"d":"x"}]'::jsonb, 100, 18, 118, 'INR', 200)`,
      [t],
    );
    expect(err).toMatch(/paid_le_grand|check/i);
  });

  it('rejects bad GSTIN format', async () => {
    const t = await mkTenant(db, 'inv-ddd');
    const err = await tryExec(
      db,
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, bill_to_gstin, line_items, subtotal, tax_total, grand_total, currency_code)
       VALUES ($1,'INV-001','X','NOT-A-GSTIN','[{"d":"x"}]'::jsonb, 100, 18, 118, 'INR')`,
      [t],
    );
    expect(err).toMatch(/gstin|check/i);
  });

  it('accepts valid GSTIN', async () => {
    const t = await mkTenant(db, 'inv-eee');
    await db.query(
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, bill_to_gstin, line_items, subtotal, tax_total, grand_total, currency_code)
       VALUES ($1,'INV-001','X','27AAAPL1234C1Z9','[{"d":"x"}]'::jsonb, 100, 18, 118, 'INR')`,
      [t],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM invoices`)).rows[0]!.c,
    ).toBe(1);
  });

  it('rejects empty line_items array', async () => {
    const t = await mkTenant(db, 'inv-fff');
    const err = await tryExec(
      db,
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code)
       VALUES ($1,'INV-001','X','[]'::jsonb, 0, 0, 0, 'INR')`,
      [t],
    );
    expect(err).toMatch(/line_items|check/i);
  });

  it('rejects object line_items (must be array)', async () => {
    const t = await mkTenant(db, 'inv-ggg');
    const err = await tryExec(
      db,
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code)
       VALUES ($1,'INV-001','X','{"item":"x"}'::jsonb, 0, 0, 0, 'INR')`,
      [t],
    );
    expect(err).toMatch(/line_items|check/i);
  });

  it('UNIQUE (tenant, invoice_number) blocks dupe', async () => {
    const t = await mkTenant(db, 'inv-hhh');
    await db.query(
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code)
       VALUES ($1,'INV-001','X','[{"d":"x"}]'::jsonb, 100, 18, 118, 'INR')`,
      [t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code)
       VALUES ($1,'INV-001','Y','[{"d":"y"}]'::jsonb, 50, 9, 59, 'INR')`,
      [t],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('sent without issued_at rejected', async () => {
    const t = await mkTenant(db, 'inv-iii');
    const err = await tryExec(
      db,
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code, status, sent_at)
       VALUES ($1,'INV-001','X','[{"d":"x"}]'::jsonb, 100, 18, 118, 'INR','sent', now())`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('paid requires paid_at AND amount_paid = grand_total', async () => {
    const t = await mkTenant(db, 'inv-jjj');
    const err = await tryExec(
      db,
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code, status, issued_at, sent_at, paid_at, amount_paid)
       VALUES ($1,'INV-001','X','[{"d":"x"}]'::jsonb, 100, 18, 118, 'INR','paid', now(), now(), now(), 100)`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('partially_paid happy path', async () => {
    const t = await mkTenant(db, 'inv-kkk');
    await db.query(
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code, status, issued_at, sent_at, amount_paid)
       VALUES ($1,'INV-001','X','[{"d":"x"}]'::jsonb, 100, 18, 118, 'INR','partially_paid', now(), now(), 50)`,
      [t],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM invoices WHERE status='partially_paid'`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('amount_outstanding generated column', async () => {
    const t = await mkTenant(db, 'inv-lll');
    await db.query(
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code, amount_paid)
       VALUES ($1,'INV-001','X','[{"d":"x"}]'::jsonb, 1000, 180, 1180, 'INR', 400)`,
      [t],
    );
    const out = (
      await db.query<{ o: string }>(`SELECT amount_outstanding::text AS o FROM invoices`)
    ).rows[0]!.o;
    expect(Number(out)).toBe(780);
  });

  it('cross-tenant event rejected', async () => {
    const t1 = await mkTenant(db, 'inv-ttt');
    const t2 = await mkTenant(db, 'inv-uuu');
    const e2 = await mkEvent(db, t2);
    const err = await tryExec(
      db,
      `INSERT INTO invoices (tenant_id, event_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code)
       VALUES ($1,$2,'INV-001','X','[{"d":"x"}]'::jsonb, 100, 18, 118, 'INR')`,
      [t1, e2],
    );
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'inv-www');
    await db.query(
      `INSERT INTO invoices (tenant_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code)
       VALUES ($1,'INV-001','X','[{"d":"x"}]'::jsonb, 100, 18, 118, 'INR')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM invoices`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM invoices`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
