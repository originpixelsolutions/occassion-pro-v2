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

async function mkEventType(db: TestDb, tenant: string | null, code: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name) VALUES ($1, $2, $2) RETURNING id`,
    [tenant, code],
  );
  return r.rows[0]!.id;
}

describe('events — schema correctness (Phase 3 Unit 1)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid planning event', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    await db.query(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
       VALUES ($1, $2, 'sharma-wedding-2026', 'Sharma Wedding', '2026-12-10', '2026-12-12', 'INR')`,
      [t, ty],
    );
    const r = await db.query<{ status: string }>(`SELECT status FROM events`);
    expect(r.rows[0]!.status).toBe('planning');
  });

  it('rejects bad code format (uppercase)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    const err = await tryExec(
      db,
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
       VALUES ($1, $2, 'BAD_CODE', 'X', '2026-12-10', '2026-12-12', 'INR')`,
      [t, ty],
    );
    expect(err).toMatch(/code_fmt|check/i);
  });

  it('rejects end_date <= start_date', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    const err = await tryExec(
      db,
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
       VALUES ($1, $2, 'evt', 'X', '2026-12-12', '2026-12-10', 'INR')`,
      [t, ty],
    );
    expect(err).toMatch(/date_order|check/i);
  });

  it('rejects bad currency_code', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    const err = await tryExec(
      db,
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
       VALUES ($1, $2, 'evt', 'X', '2026-12-10', '2026-12-12', 'inr')`,
      [t, ty],
    );
    expect(err).toMatch(/currency|check/i);
  });

  it('rejects venue_lat without venue_lng (coord coupling)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    const err = await tryExec(
      db,
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code, venue_lat)
       VALUES ($1, $2, 'evt', 'X', '2026-12-10', '2026-12-12', 'INR', 28.6139)`,
      [t, ty],
    );
    expect(err).toMatch(/coord_coupling|check/i);
  });

  it('rejects expected_guest > max_guest', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    const err = await tryExec(
      db,
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code,
         expected_guest_count, max_guest_count)
       VALUES ($1, $2, 'evt', 'X', '2026-12-10', '2026-12-12', 'INR', 500, 400)`,
      [t, ty],
    );
    expect(err).toMatch(/check/i);
  });

  it("rejects 'completed' without completed_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    const err = await tryExec(
      db,
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code, status)
       VALUES ($1, $2, 'evt', 'X', '2026-12-10', '2026-12-12', 'INR', 'completed')`,
      [t, ty],
    );
    expect(err).toMatch(/check/i);
  });

  it("rejects 'cancelled' without reason", async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    const err = await tryExec(
      db,
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code, status, cancelled_at)
       VALUES ($1, $2, 'evt', 'X', '2026-12-10', '2026-12-12', 'INR', 'cancelled', now())`,
      [t, ty],
    );
    expect(err).toMatch(/check/i);
  });

  it("rejects 'archived' without completed_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    const err = await tryExec(
      db,
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code, status, archived_at)
       VALUES ($1, $2, 'evt', 'X', '2026-12-10', '2026-12-12', 'INR', 'archived', now())`,
      [t, ty],
    );
    expect(err).toMatch(/check/i);
  });

  it("rejects 'offloaded' without all four prereqs", async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    const err = await tryExec(
      db,
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code, status, offloaded_at)
       VALUES ($1, $2, 'evt', 'X', '2026-12-10', '2026-12-12', 'INR', 'offloaded', now())`,
      [t, ty],
    );
    expect(err).toMatch(/check/i);
  });

  it('UNIQUE (tenant_id, code) blocks duplicate code per tenant', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    await db.query(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
       VALUES ($1, $2, 'same-code', 'X', '2026-12-10', '2026-12-12', 'INR')`,
      [t, ty],
    );
    const err = await tryExec(
      db,
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
       VALUES ($1, $2, 'same-code', 'Y', '2027-01-10', '2027-01-12', 'INR')`,
      [t, ty],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('same code allowed across different tenants', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    const ty1 = await mkEventType(db, t1, 'wedding');
    const ty2 = await mkEventType(db, t2, 'wedding');
    await db.query(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code) VALUES
         ($1, $2, 'evt', 'X', '2026-12-10', '2026-12-12', 'INR'),
         ($3, $4, 'evt', 'Y', '2026-12-10', '2026-12-12', 'INR')`,
      [t1, ty1, t2, ty2],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM events`)).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('RESTRICT on event_type_id: cannot delete a type while events reference it', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    await db.query(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
       VALUES ($1, $2, 'evt', 'X', '2026-12-10', '2026-12-12', 'INR')`,
      [t, ty],
    );
    const err = await tryExec(db, `DELETE FROM event_types WHERE id = $1`, [ty]);
    expect(err).toMatch(/foreign key|restrict/i);
  });

  it('Phase 1 deferred FK resolved: tenant_sheets_syncs.event_id now CASCADEs from events', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    const er = await db.query<{ id: string }>(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
       VALUES ($1, $2, 'evt', 'X', '2026-12-10', '2026-12-12', 'INR') RETURNING id`,
      [t, ty],
    );
    const ev = er.rows[0]!.id;
    await db.query(
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping)
       VALUES ($1, $2, 'guests', 'sheet_a', 'Guests', '\\x00aa'::bytea, '{"a":"b"}'::jsonb)`,
      [t, ev],
    );
    await db.query(`DELETE FROM events WHERE id = $1`, [ev]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_sheets_syncs`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('CASCADE: deleting tenant removes its events', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    await db.query(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
       VALUES ($1, $2, 'evt', 'X', '2026-12-10', '2026-12-12', 'INR')`,
      [t, ty],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM events`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkEventType(db, t, 'wedding');
    await db.query(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
       VALUES ($1, $2, 'evt', 'X', '2026-12-10', '2026-12-12', 'INR')`,
      [t, ty],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM events`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM events`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
