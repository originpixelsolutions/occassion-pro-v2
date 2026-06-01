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

const EVENT = '11111111-1111-1111-1111-111111111111';
const EVENT2 = '22222222-2222-2222-2222-222222222222';

describe('bulk_operation_quota — schema correctness (Phase 2 Unit 45)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid quota row', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO bulk_operation_quota (tenant_id, operation_type, scope, scope_id, date, count, limit_value)
       VALUES ($1, 'guest_import', 'per_event', $2, current_date, 0, 10000)`, [t, EVENT]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM bulk_operation_quota`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bogus operation_type', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO bulk_operation_quota (tenant_id, operation_type, scope, scope_id, date)
       VALUES ($1, 'hex_curse', 'per_event', $2, current_date)`, [t, EVENT]);
    expect(err).toMatch(/operation_type|check/i);
  });

  it('rejects bogus scope', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO bulk_operation_quota (tenant_id, operation_type, scope, scope_id, date)
       VALUES ($1, 'guest_import', 'per_galaxy', $2, current_date)`, [t, EVENT]);
    expect(err).toMatch(/scope|check/i);
  });

  it('rejects negative count', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO bulk_operation_quota (tenant_id, operation_type, scope, scope_id, date, count)
       VALUES ($1, 'guest_import', 'per_event', $2, current_date, -1)`, [t, EVENT]);
    expect(err).toMatch(/count_non_neg|check/i);
  });

  it('rejects count > limit_value', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO bulk_operation_quota (tenant_id, operation_type, scope, scope_id, date, count, limit_value)
       VALUES ($1, 'guest_import', 'per_event', $2, current_date, 10001, 10000)`, [t, EVENT]);
    expect(err).toMatch(/count_under_limit|check/i);
  });

  it('atomic increment respects the cap', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO bulk_operation_quota (tenant_id, operation_type, scope, scope_id, date, count, limit_value)
       VALUES ($1, 'guest_import', 'per_event', $2, current_date, 9999, 10000)`, [t, EVENT]);
    // +1 OK
    await db.query(
      `UPDATE bulk_operation_quota SET count = count + 1 WHERE tenant_id = $1`, [t]);
    // +1 again trips the CHECK
    const err = await tryExec(db,
      `UPDATE bulk_operation_quota SET count = count + 1 WHERE tenant_id = $1`, [t]);
    expect(err).toMatch(/count_under_limit|check/i);
  });

  it('composite PK: same (tenant, op, scope, scope_id, date) blocked', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO bulk_operation_quota (tenant_id, operation_type, scope, scope_id, date)
       VALUES ($1, 'guest_import', 'per_event', $2, current_date)`, [t, EVENT]);
    const err = await tryExec(db,
      `INSERT INTO bulk_operation_quota (tenant_id, operation_type, scope, scope_id, date, count)
       VALUES ($1, 'guest_import', 'per_event', $2, current_date, 5)`, [t, EVENT]);
    expect(err).toMatch(/duplicate|primary key|unique/i);
  });

  it('different scope_ids, dates, op types all coexist', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO bulk_operation_quota (tenant_id, operation_type, scope, scope_id, date) VALUES
         ($1, 'guest_import', 'per_event', $2, current_date),
         ($1, 'guest_import', 'per_event', $3, current_date),
         ($1, 'guest_import', 'per_event', $2, current_date - interval '1 day'),
         ($1, 'email_send',   'per_workspace', $1, current_date)`, [t, EVENT, EVENT2]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM bulk_operation_quota`)).rows[0]!.c;
    expect(c).toBe(4);
  });

  it('CASCADE: deleting tenant removes its quota rows', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO bulk_operation_quota (tenant_id, operation_type, scope, scope_id, date)
       VALUES ($1, 'guest_import', 'per_event', $2, current_date)`, [t, EVENT]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM bulk_operation_quota`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO bulk_operation_quota (tenant_id, operation_type, scope, scope_id, date)
       VALUES ($1, 'guest_import', 'per_event', $2, current_date)`, [t, EVENT]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM bulk_operation_quota`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM bulk_operation_quota`)).rows.length);
    expect(svc).toBe(1);
  });
});
