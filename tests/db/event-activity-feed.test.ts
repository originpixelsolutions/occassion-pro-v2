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
      `INSERT INTO event_types (code, name, is_system) VALUES ('w-' || gen_random_uuid()::text, 'W', TRUE) RETURNING id`,
    )
  ).rows[0]!.id;
  const r = await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, 'evt-' || gen_random_uuid()::text, 'X', '2026-12-10', '2026-12-12', 'INR') RETURNING id`,
    [tenant, ty],
  );
  return r.rows[0]!.id;
}

describe('event_activity_feed — schema correctness (Phase 3 Unit 12)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid activity', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_type, activity_type, description)
       VALUES ($1, $2, 'system', 'event_created', 'Event created from template')`,
      [t, e],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_activity_feed`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bogus actor_type', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_type, activity_type, description)
       VALUES ($1, $2, 'wizard', 'event_created', 'X')`,
      [t, e],
    );
    expect(err).toMatch(/actor_type|check/i);
  });

  it('rejects bogus activity_type', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_type, activity_type, description)
       VALUES ($1, $2, 'system', 'event_blessed_by_unicorn', 'X')`,
      [t, e],
    );
    expect(err).toMatch(/activity_type|check/i);
  });

  it('rejects empty description', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_type, activity_type, description)
       VALUES ($1, $2, 'system', 'event_created', '   ')`,
      [t, e],
    );
    expect(err).toMatch(/desc_len|check/i);
  });

  it('rejects non-object data (array)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_type, activity_type, description, data)
       VALUES ($1, $2, 'system', 'event_created', 'X', '[1,2]'::jsonb)`,
      [t, e],
    );
    expect(err).toMatch(/data_object|check/i);
  });

  it('rejects entity_id without entity_type', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_type, activity_type, description, entity_id)
       VALUES ($1, $2, 'system', 'guest_added', 'X', gen_random_uuid())`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('trigger: rejects cross-tenant activity', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    const e_t1 = await mkEvent(db, t1);
    const err = await tryExec(
      db,
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_type, activity_type, description)
       VALUES ($1, $2, 'system', 'event_created', 'X')`,
      [t2, e_t1],
    );
    expect(err).toMatch(/tenant_mismatch|check/i);
  });

  it('append-only trigger: rejects mutating description', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_type, activity_type, description)
       VALUES ($1, $2, 'system', 'event_created', 'Original description')`,
      [t, e],
    );
    const err = await tryExec(
      db,
      `UPDATE event_activity_feed SET description = 'Edited description'`,
    );
    expect(err).toMatch(/immutable|description|insufficient_privilege/i);
  });

  it('append-only trigger: allows mutating is_internal (visibility toggle)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_type, activity_type, description)
       VALUES ($1, $2, 'system', 'event_created', 'X')`,
      [t, e],
    );
    await db.query(`UPDATE event_activity_feed SET is_internal = TRUE`);
    const r = await db.query<{ is_internal: boolean }>(
      `SELECT is_internal FROM event_activity_feed`,
    );
    expect(r.rows[0]!.is_internal).toBe(true);
  });

  it('bigserial PK auto-increments across multiple events', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_type, activity_type, description) VALUES
         ($1, $2, 'system', 'event_created', 'A'),
         ($1, $2, 'system', 'guest_added', 'B'),
         ($1, $2, 'system', 'task_added', 'C')`,
      [t, e],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_activity_feed`))
      .rows[0]!.c;
    expect(c).toBe(3);
  });

  it('CASCADE: deleting event removes its activity', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_type, activity_type, description)
       VALUES ($1, $2, 'system', 'event_created', 'X')`,
      [t, e],
    );
    await db.query(`DELETE FROM events WHERE id = $1`, [e]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_activity_feed`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_activity_feed (tenant_id, event_id, actor_type, activity_type, description)
       VALUES ($1, $2, 'system', 'event_created', 'X')`,
      [t, e],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM event_activity_feed`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM event_activity_feed`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
