import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenant: string, code='evt-001'): Promise<string> {
  const ty = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'W', FALSE) RETURNING id`, [tenant])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`, [tenant, ty, code])).rows[0]!.id;
}
async function mkInvoice(db: TestDb, t: string, e: string|null, num='INV-001'): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO invoices (tenant_id, event_id, invoice_number, bill_to_name, line_items, subtotal, tax_total, grand_total, currency_code)
     VALUES ($1,$2,$3,'X','[{"d":"x"}]'::jsonb, 1000, 180, 1180, 'INR') RETURNING id`, [t, e, num])).rows[0]!.id;
}

describe('payments — schema correctness (Phase 6 Unit 46)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid succeeded payment', async () => {
    const t = await mkTenant(db, 'pay-aaa');
    const e = await mkEvent(db, t);
    const inv = await mkInvoice(db, t, e);
    await db.query(
      `INSERT INTO payments (tenant_id, event_id, invoice_id, payer_type, payer_name, amount, currency_code, gateway, gateway_payment_id, status, paid_at)
       VALUES ($1,$2,$3,'client','Acme Wedding', 1180, 'INR','razorpay','pay_R123', 'succeeded', now())`, [t, e, inv]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM payments`)).rows[0]!.c).toBe(1);
  });

  it('amount > 0 enforced', async () => {
    const t = await mkTenant(db, 'pay-bbb');
    const err = await tryExec(db,
      `INSERT INTO payments (tenant_id, payer_type, amount, currency_code, gateway) VALUES ($1,'client', 0, 'INR','razorpay')`, [t]);
    expect(err).toMatch(/amount_positive|check/i);
  });

  it('refunded_amount > amount rejected', async () => {
    const t = await mkTenant(db, 'pay-ccc');
    const err = await tryExec(db,
      `INSERT INTO payments (tenant_id, payer_type, amount, currency_code, gateway, refunded_amount)
       VALUES ($1,'client', 100, 'INR','razorpay', 200)`, [t]);
    expect(err).toMatch(/refund_le_amount|check/i);
  });

  it('rejects bad gateway', async () => {
    const t = await mkTenant(db, 'pay-ddd');
    const err = await tryExec(db,
      `INSERT INTO payments (tenant_id, payer_type, amount, currency_code, gateway)
       VALUES ($1,'client', 100, 'INR','bitcoin')`, [t]);
    expect(err).toMatch(/gateway|check/i);
  });

  it('succeeded requires paid_at', async () => {
    const t = await mkTenant(db, 'pay-eee');
    const err = await tryExec(db,
      `INSERT INTO payments (tenant_id, payer_type, amount, currency_code, gateway, status)
       VALUES ($1,'client', 100, 'INR','razorpay','succeeded')`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('refunded requires full refund', async () => {
    const t = await mkTenant(db, 'pay-fff');
    const err = await tryExec(db,
      `INSERT INTO payments (tenant_id, payer_type, amount, currency_code, gateway, status, paid_at, refunded_at, refunded_amount)
       VALUES ($1,'client', 100, 'INR','razorpay','refunded', now(), now(), 50)`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('partially_refunded requires partial amount', async () => {
    const t = await mkTenant(db, 'pay-ggg');
    await db.query(
      `INSERT INTO payments (tenant_id, payer_type, amount, currency_code, gateway, status, paid_at, refunded_at, refunded_amount)
       VALUES ($1,'client', 100, 'INR','razorpay','partially_refunded', now(), now(), 30)`, [t]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM payments WHERE status='partially_refunded'`)).rows[0]!.c).toBe(1);
  });

  it('failed requires failure_reason', async () => {
    const t = await mkTenant(db, 'pay-hhh');
    const err = await tryExec(db,
      `INSERT INTO payments (tenant_id, payer_type, amount, currency_code, gateway, status, failed_at)
       VALUES ($1,'client', 100, 'INR','razorpay','failed', now())`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('UNIQUE (gateway, gateway_payment_id) blocks dupe', async () => {
    const t = await mkTenant(db, 'pay-iii');
    await db.query(
      `INSERT INTO payments (tenant_id, payer_type, amount, currency_code, gateway, gateway_payment_id)
       VALUES ($1,'client', 100, 'INR','razorpay','pay_X1')`, [t]);
    const err = await tryExec(db,
      `INSERT INTO payments (tenant_id, payer_type, amount, currency_code, gateway, gateway_payment_id)
       VALUES ($1,'client', 200, 'INR','razorpay','pay_X1')`, [t]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('NULL gateway_payment_id allowed multiple times', async () => {
    const t = await mkTenant(db, 'pay-jjj');
    await db.query(`INSERT INTO payments (tenant_id, payer_type, amount, currency_code, gateway) VALUES ($1,'client', 100, 'INR','razorpay')`, [t]);
    await db.query(`INSERT INTO payments (tenant_id, payer_type, amount, currency_code, gateway) VALUES ($1,'client', 200, 'INR','razorpay')`, [t]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM payments`)).rows[0]!.c).toBe(2);
  });

  it('net_amount generated column', async () => {
    const t = await mkTenant(db, 'pay-kkk');
    await db.query(
      `INSERT INTO payments (tenant_id, payer_type, amount, currency_code, gateway, fees, refunded_amount)
       VALUES ($1,'client', 1000, 'INR','razorpay', 25, 100)`, [t]);
    const n = (await db.query<{ n: string }>(`SELECT net_amount::text AS n FROM payments`)).rows[0]!.n;
    expect(Number(n)).toBe(875);
  });

  it('invoice from another tenant rejected', async () => {
    const t1 = await mkTenant(db, 'pay-ttt');
    const t2 = await mkTenant(db, 'pay-uuu');
    const e2 = await mkEvent(db, t2);
    const invOther = await mkInvoice(db, t2, e2);
    const err = await tryExec(db,
      `INSERT INTO payments (tenant_id, invoice_id, payer_type, amount, currency_code, gateway)
       VALUES ($1,$2,'client', 100, 'INR','razorpay')`, [t1, invOther]);
    expect(err).toMatch(/invoice|tenant|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'pay-www');
    await db.query(
      `INSERT INTO payments (tenant_id, payer_type, amount, currency_code, gateway) VALUES ($1,'client', 100, 'INR','razorpay')`, [t]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM payments`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM payments`)).rows.length);
    expect(svc).toBe(1);
  });
});
