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

async function mkEvent(db: TestDb, tenant: string, code = 'evt'): Promise<string> {
  const ty = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name) VALUES ($1, 'wedding-' || gen_random_uuid()::text, 'Wedding') RETURNING id`,
    [tenant])).rows[0]!.id;
  const r = await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, $3, 'X', '2026-12-10', '2026-12-12', 'INR') RETURNING id`, [tenant, ty, code]);
  return r.rows[0]!.id;
}

async function mkMember(db: TestDb, tenant: string, email: string, role = 'event_manager'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1, $2, 'M', $3) RETURNING id`,
    [tenant, email, role]);
  return r.rows[0]!.id;
}

describe('event_subteams — schema correctness (Phase 3 Unit 2)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid subteam', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'Catering Team')`, [t, e]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_subteams`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bad color_hex format', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO event_subteams (tenant_id, event_id, name, color_hex) VALUES ($1, $2, 'X', 'red')`, [t, e]);
    expect(err).toMatch(/color_fmt|check/i);
  });

  it('partial UNIQUE: blocks duplicate name per event (case-insensitive)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'Catering')`, [t, e]);
    const err = await tryExec(db,
      `INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'CATERING')`, [t, e]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('removed subteam frees the name slot', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_subteams (tenant_id, event_id, name, removed_at) VALUES ($1, $2, 'Catering', now())`, [t, e]);
    await db.query(
      `INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'Catering')`, [t, e]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_subteams`)).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('partial UNIQUE: same lead cannot head two subteams on same event', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const m = await mkMember(db, t, 'lead@y.dev');
    await db.query(
      `INSERT INTO event_subteams (tenant_id, event_id, name, lead_id) VALUES ($1, $2, 'A', $3)`, [t, e, m]);
    const err = await tryExec(db,
      `INSERT INTO event_subteams (tenant_id, event_id, name, lead_id) VALUES ($1, $2, 'B', $3)`, [t, e, m]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('NULL leads do not conflict (multiple unled subteams allowed)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'A'), ($1, $2, 'B')`, [t, e]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_subteams`)).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('trigger: rejects tenant_id mismatching events.tenant_id', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    const e = await mkEvent(db, t1);
    const err = await tryExec(db,
      `INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'X')`, [t2, e]);
    expect(err).toMatch(/tenant_mismatch|check/i);
  });

  it('same lead CAN head subteams on different events', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e1 = await mkEvent(db, t, 'evt-a');
    const e2 = await mkEvent(db, t, 'evt-b');
    const m = await mkMember(db, t, 'lead@y.dev');
    await db.query(
      `INSERT INTO event_subteams (tenant_id, event_id, name, lead_id) VALUES
         ($1, $2, 'Catering', $3),
         ($1, $4, 'Catering', $3)`, [t, e1, m, e2]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_subteams`)).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting event removes its subteams', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'X')`, [t, e]);
    await db.query(`DELETE FROM events WHERE id = $1`, [e]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_subteams`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('SET NULL: deleting lead member nulls lead_id but keeps the subteam', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const m = await mkMember(db, t, 'lead@y.dev');
    await db.query(
      `INSERT INTO event_subteams (tenant_id, event_id, name, lead_id) VALUES ($1, $2, 'X', $3)`, [t, e, m]);
    await db.query(`DELETE FROM tenant_members WHERE id = $1`, [m]);
    const r = await db.query<{ lead_id: string | null }>(`SELECT lead_id FROM event_subteams`);
    expect(r.rows[0]!.lead_id).toBeNull();
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'X')`, [t, e]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM event_subteams`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM event_subteams`)).rows.length);
    expect(svc).toBe(1);
  });
});
