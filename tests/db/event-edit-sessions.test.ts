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

async function mkMember(
  db: TestDb,
  tenant: string,
  email: string,
  role = 'event_manager',
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1, $2, 'M', $3) RETURNING id`,
    [tenant, email, role],
  );
  return r.rows[0]!.id;
}

describe('event_edit_sessions — schema correctness (Phase 3 Unit 6)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid lock with default 60s expiry', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path) VALUES ($1, $2, 'name')`,
      [e, m],
    );
    const r = await db.query<{ secs: number }>(
      `SELECT EXTRACT(EPOCH FROM (expires_at - locked_at))::int AS secs FROM event_edit_sessions`,
    );
    expect(r.rows[0]!.secs).toBe(60);
  });

  it('rejects empty field_path', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const m = await mkMember(db, t, 'a@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path) VALUES ($1, $2, '   ')`,
      [e, m],
    );
    expect(err).toMatch(/field_path_len|check/i);
  });

  it('rejects expiry > 1 hour from locked_at (heartbeat ceiling)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const m = await mkMember(db, t, 'a@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path, expires_at)
       VALUES ($1, $2, 'name', now() + interval '90 minutes')`,
      [e, m],
    );
    expect(err).toMatch(/under_1h|check/i);
  });

  it('rejects released_at without released_reason (and vice versa)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const m = await mkMember(db, t, 'a@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path, released_at)
       VALUES ($1, $2, 'name', now())`,
      [e, m],
    );
    expect(err).toMatch(/released_pair|check/i);
  });

  it('rejects bogus released_reason', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const m = await mkMember(db, t, 'a@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path, released_at, released_reason)
       VALUES ($1, $2, 'name', now(), 'unicorn_escape')`,
      [e, m],
    );
    expect(err).toMatch(/released_reason|check/i);
  });

  it('partial UNIQUE: blocks two ACTIVE locks on same (event, field)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const m1 = await mkMember(db, t, 'a@y.dev');
    const m2 = await mkMember(db, t, 'b@y.dev', 'team_lead');
    await db.query(
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path) VALUES ($1, $2, 'name')`,
      [e, m1],
    );
    const err = await tryExec(
      db,
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path) VALUES ($1, $2, 'name')`,
      [e, m2],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('released lock does NOT block a new lock on same (event, field)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const m1 = await mkMember(db, t, 'a@y.dev');
    const m2 = await mkMember(db, t, 'b@y.dev', 'team_lead');
    await db.query(
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path, released_at, released_reason)
       VALUES ($1, $2, 'name', now(), 'user')`,
      [e, m1],
    );
    await db.query(
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path) VALUES ($1, $2, 'name')`,
      [e, m2],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_edit_sessions`))
      .rows[0]!.c;
    expect(c).toBe(2);
  });

  it('trigger: rejects cross-tenant lock attempt', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    const e_t1 = await mkEvent(db, t1);
    const m_t2 = await mkMember(db, t2, 'spy@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path) VALUES ($1, $2, 'name')`,
      [e_t1, m_t2],
    );
    expect(err).toMatch(/tenant_mismatch|check/i);
  });

  it('CASCADE: deleting event releases its locks', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path) VALUES ($1, $2, 'name')`,
      [e, m],
    );
    await db.query(`DELETE FROM events WHERE id = $1`, [e]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_edit_sessions`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO event_edit_sessions (event_id, user_id, field_path) VALUES ($1, $2, 'name')`,
      [e, m],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM event_edit_sessions`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM event_edit_sessions`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
