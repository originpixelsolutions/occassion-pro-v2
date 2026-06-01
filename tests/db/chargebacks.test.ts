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

describe('chargebacks — schema correctness (Phase 2 Unit 38)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid chargeback (default status = received)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code)
       VALUES ($1, 'stripe', 'dp_1234', 1500.00, 'USD')`, [t]);
    const r = await db.query<{ status: string }>(`SELECT status FROM chargebacks`);
    expect(r.rows[0]!.status).toBe('received');
  });

  it('rejects bogus gateway', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code)
       VALUES ($1, 'paypal', 'd-1', 100, 'USD')`, [t]);
    expect(err).toMatch(/gateway|check/i);
  });

  it('rejects amount <= 0', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code)
       VALUES ($1, 'stripe', 'dp_1', 0, 'USD')`, [t]);
    expect(err).toMatch(/amount_pos|check/i);
  });

  it('rejects bad currency_code', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code)
       VALUES ($1, 'stripe', 'dp_1', 100, 'usd')`, [t]);
    expect(err).toMatch(/currency|check/i);
  });

  it('UNIQUE (gateway, gateway_dispute_id) gives idempotent webhook handling', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    await db.query(
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code)
       VALUES ($1, 'stripe', 'dp_shared', 100, 'USD')`, [t1]);
    const err = await tryExec(db,
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code)
       VALUES ($1, 'stripe', 'dp_shared', 100, 'USD')`, [t2]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('rejects bogus account_action', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code, account_action)
       VALUES ($1, 'stripe', 'dp_1', 100, 'USD', 'kidnapped')`, [t]);
    expect(err).toMatch(/account_action|check/i);
  });

  it('rejects non-array evidence_files', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code, evidence_files)
       VALUES ($1, 'stripe', 'dp_1', 100, 'USD', '{"k":"v"}'::jsonb)`, [t]);
    expect(err).toMatch(/evidence_array_only|check/i);
  });

  it("rejects 'evidence_submitted' without evidence_submitted_at + evidence_files", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code, status)
       VALUES ($1, 'stripe', 'dp_1', 100, 'USD', 'evidence_submitted')`, [t]);
    expect(err).toMatch(/check/i);
  });

  it("rejects 'won'/'lost'/'accepted' without resolution_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const e1 = await tryExec(db,
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code, status)
       VALUES ($1, 'stripe', 'dp_w', 100, 'USD', 'won')`, [t]);
    expect(e1).toMatch(/check/i);
    const e2 = await tryExec(db,
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code, status)
       VALUES ($1, 'stripe', 'dp_a', 100, 'USD', 'accepted')`, [t]);
    expect(e2).toMatch(/check/i);
  });

  it('happy path through to won with evidence', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code,
         status, evidence_submitted_at, evidence_files, resolution_at)
       VALUES ($1, 'stripe', 'dp_won', 100, 'USD',
         'won', now(), '[{"r2_key":"k","filename":"f.pdf","content_type":"application/pdf"}]'::jsonb,
         now())`, [t]);
    const r = await db.query<{ status: string }>(`SELECT status FROM chargebacks`);
    expect(r.rows[0]!.status).toBe('won');
  });

  it('CASCADE: deleting tenant removes its chargebacks', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code)
       VALUES ($1, 'stripe', 'dp_1', 100, 'USD')`, [t]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM chargebacks`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO chargebacks (tenant_id, gateway, gateway_dispute_id, amount, currency_code)
       VALUES ($1, 'stripe', 'dp_1', 100, 'USD')`, [t]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM chargebacks`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM chargebacks`)).rows.length);
    expect(svc).toBe(1);
  });
});
