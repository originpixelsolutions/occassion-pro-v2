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

async function mkEvent(db: TestDb, tenant: string): Promise<string> {
  const ty = (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (code, name, is_system) VALUES ('conf-' || gen_random_uuid()::text, 'Conf', TRUE) RETURNING id`,
    )
  ).rows[0]!.id;
  const r = await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, 'evt-' || gen_random_uuid()::text, 'X', '2026-12-10', '2026-12-12', 'INR') RETURNING id`,
    [tenant, ty],
  );
  return r.rows[0]!.id;
}

describe('event_tickets — schema correctness (Phase 3 Unit 11)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid general ticket', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, price, currency_code, quantity_total)
       VALUES ($1, $2, 'general', 'General Admission', 500.00, 'INR', 1000)`,
      [t, e],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_tickets`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bogus ticket_type', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, currency_code)
       VALUES ($1, $2, 'goldenrod', 'X', 'INR')`,
      [t, e],
    );
    expect(err).toMatch(/ticket_type|check/i);
  });

  it('rejects negative price', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, price, currency_code)
       VALUES ($1, $2, 'general', 'X', -1, 'INR')`,
      [t, e],
    );
    expect(err).toMatch(/price_pos|check/i);
  });

  it('capacity CHECK: sold + reserved <= total', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, currency_code,
         quantity_total, quantity_sold, quantity_reserved)
       VALUES ($1, $2, 'general', 'X', 'INR', 100, 60, 50)`,
      [t, e],
    );
    expect(err).toMatch(/capacity|check/i);
  });

  it('per-order CHECK: max < min rejected', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, currency_code, min_per_order, max_per_order)
       VALUES ($1, $2, 'general', 'X', 'INR', 5, 3)`,
      [t, e],
    );
    expect(err).toMatch(/per_order_range|check/i);
  });

  it('sale_window CHECK: sale_ends > sale_starts', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, currency_code, sale_starts_at, sale_ends_at)
       VALUES ($1, $2, 'general', 'X', 'INR', '2026-12-01', '2026-11-01')`,
      [t, e],
    );
    expect(err).toMatch(/sale_window|check/i);
  });

  it('late_fee_coupling: late_fee without late_window rejected', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, currency_code, sale_ends_at, late_fee)
       VALUES ($1, $2, 'general', 'X', 'INR', '2026-12-09', 250)`,
      [t, e],
    );
    expect(err).toMatch(/late_fee_coupling|check/i);
  });

  it('late_window > sale_ends', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, currency_code, sale_ends_at, late_fee, late_window_ends_at)
       VALUES ($1, $2, 'general', 'X', 'INR', '2026-12-09', 250, '2026-12-08')`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('partial UNIQUE: blocks duplicate active name per event (case-insensitive)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, currency_code)
       VALUES ($1, $2, 'general', 'VIP Pass', 'INR')`,
      [t, e],
    );
    const err = await tryExec(
      db,
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, currency_code)
       VALUES ($1, $2, 'vip', 'vip pass', 'INR')`,
      [t, e],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('soft-deleted ticket frees the name', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, currency_code, deleted_at, purge_after)
       VALUES ($1, $2, 'general', 'Early Bird', 'INR', now(), now() + interval '30 days')`,
      [t, e],
    );
    await db.query(
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, currency_code)
       VALUES ($1, $2, 'early_bird', 'Early Bird', 'INR')`,
      [t, e],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_tickets`))
      .rows[0]!.c;
    expect(c).toBe(2);
  });

  it('trigger: rejects cross-tenant ticket', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    const e_t1 = await mkEvent(db, t1);
    const err = await tryExec(
      db,
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, currency_code)
       VALUES ($1, $2, 'general', 'X', 'INR')`,
      [t2, e_t1],
    );
    expect(err).toMatch(/tenant_mismatch|check/i);
  });

  it('CASCADE: deleting event removes its tickets', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, currency_code)
       VALUES ($1, $2, 'general', 'X', 'INR')`,
      [t, e],
    );
    await db.query(`DELETE FROM events WHERE id = $1`, [e]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_tickets`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_tickets (tenant_id, event_id, ticket_type, name, currency_code)
       VALUES ($1, $2, 'general', 'X', 'INR')`,
      [t, e],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM event_tickets`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM event_tickets`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
