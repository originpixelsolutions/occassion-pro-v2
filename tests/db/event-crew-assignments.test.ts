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
      `INSERT INTO event_types (code, name, is_system) VALUES ('wedding-' || gen_random_uuid()::text, 'Wedding', TRUE) RETURNING id`,
    )
  ).rows[0]!.id;
  const r = await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, 'evt-' || gen_random_uuid()::text, 'X', '2026-12-10', '2026-12-12', 'INR') RETURNING id`,
    [tenant, ty],
  );
  return r.rows[0]!.id;
}

async function mkCrew(db: TestDb, tenant: string, name = 'A'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO crew_pool (tenant_id, full_name) VALUES ($1, $2) RETURNING id`,
    [tenant, name],
  );
  return r.rows[0]!.id;
}

describe('event_crew_assignments — schema correctness (Phase 3 Unit 10)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a scheduled assignment', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const c = await mkCrew(db, t);
    await db.query(
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end)
       VALUES ($1, $2, $3, '2026-12-10 14:00', '2026-12-10 23:00')`,
      [t, e, c],
    );
    const r = await db.query<{ status: string }>(`SELECT status FROM event_crew_assignments`);
    expect(r.rows[0]!.status).toBe('scheduled');
  });

  it('rejects shift_end <= shift_start', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const c = await mkCrew(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end)
       VALUES ($1, $2, $3, '2026-12-10 14:00', '2026-12-10 13:00')`,
      [t, e, c],
    );
    expect(err).toMatch(/shift_order|check/i);
  });

  it('rejects hours_worked > 168', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const c = await mkCrew(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end, hours_worked)
       VALUES ($1, $2, $3, '2026-12-10 14:00', '2026-12-10 23:00', 200)`,
      [t, e, c],
    );
    expect(err).toMatch(/hours_bounds|check/i);
  });

  it("rejects 'checked_in' without check_in_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const c = await mkCrew(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end, status)
       VALUES ($1, $2, $3, '2026-12-10 14:00', '2026-12-10 23:00', 'checked_in')`,
      [t, e, c],
    );
    expect(err).toMatch(/check/i);
  });

  it("rejects 'checked_out' missing hours_worked", async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const c = await mkCrew(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end, status, check_in_at, check_out_at)
       VALUES ($1, $2, $3, '2026-12-10 14:00', '2026-12-10 23:00', 'checked_out', '2026-12-10 14:00', '2026-12-10 23:00')`,
      [t, e, c],
    );
    expect(err).toMatch(/check/i);
  });

  it('rejects paid_at without payment_method/currency/total', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const c = await mkCrew(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end, paid_at)
       VALUES ($1, $2, $3, '2026-12-10 14:00', '2026-12-10 23:00', now())`,
      [t, e, c],
    );
    expect(err).toMatch(/payment_coupling|check/i);
  });

  it('partial UNIQUE: blocks two non-cancelled assignments for same (event, crew)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const c = await mkCrew(db, t);
    await db.query(
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end)
       VALUES ($1, $2, $3, '2026-12-10 14:00', '2026-12-10 23:00')`,
      [t, e, c],
    );
    const err = await tryExec(
      db,
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end)
       VALUES ($1, $2, $3, '2026-12-11 14:00', '2026-12-11 23:00')`,
      [t, e, c],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('cancelled assignment does NOT block a new one', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const c = await mkCrew(db, t);
    await db.query(
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end, status, cancelled_at)
       VALUES ($1, $2, $3, '2026-12-10 14:00', '2026-12-10 23:00', 'cancelled', now())`,
      [t, e, c],
    );
    await db.query(
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end)
       VALUES ($1, $2, $3, '2026-12-11 14:00', '2026-12-11 23:00')`,
      [t, e, c],
    );
    const n = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_crew_assignments`)
    ).rows[0]!.c;
    expect(n).toBe(2);
  });

  it('trigger: rejects cross-tenant event assignment', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    const e_t1 = await mkEvent(db, t1);
    const c_t1 = await mkCrew(db, t1);
    const err = await tryExec(
      db,
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end)
       VALUES ($1, $2, $3, '2026-12-10 14:00', '2026-12-10 23:00')`,
      [t2, e_t1, c_t1],
    );
    expect(err).toMatch(/tenant_mismatch|check/i);
  });

  it('trigger: rejects assigning crew from another tenant', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    const e_t1 = await mkEvent(db, t1);
    const c_t2 = await mkCrew(db, t2);
    const err = await tryExec(
      db,
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end)
       VALUES ($1, $2, $3, '2026-12-10 14:00', '2026-12-10 23:00')`,
      [t1, e_t1, c_t2],
    );
    expect(err).toMatch(/crew_tenant_mismatch|check/i);
  });

  it('full happy path through to paid', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const c = await mkCrew(db, t);
    await db.query(
      `INSERT INTO event_crew_assignments
         (tenant_id, event_id, crew_id, shift_start, shift_end, status, check_in_at, check_out_at,
          hours_worked, total_payable, currency_code, paid_at, payment_method)
       VALUES ($1, $2, $3, '2026-12-10 14:00', '2026-12-10 23:00', 'checked_out',
               '2026-12-10 14:05', '2026-12-10 22:55', 8.5, 5100.00, 'INR', now(), 'upi')`,
      [t, e, c],
    );
    const r = await db.query<{ status: string }>(`SELECT status FROM event_crew_assignments`);
    expect(r.rows[0]!.status).toBe('checked_out');
  });

  it('CASCADE: deleting event removes assignments', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const c = await mkCrew(db, t);
    await db.query(
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end)
       VALUES ($1, $2, $3, '2026-12-10 14:00', '2026-12-10 23:00')`,
      [t, e, c],
    );
    await db.query(`DELETE FROM events WHERE id = $1`, [e]);
    const n = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_crew_assignments`)
    ).rows[0]!.c;
    expect(n).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const c = await mkCrew(db, t);
    await db.query(
      `INSERT INTO event_crew_assignments (tenant_id, event_id, crew_id, shift_start, shift_end)
       VALUES ($1, $2, $3, '2026-12-10 14:00', '2026-12-10 23:00')`,
      [t, e, c],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM event_crew_assignments`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM event_crew_assignments`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
