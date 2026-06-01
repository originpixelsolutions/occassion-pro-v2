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

async function mkType(db: TestDb): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO event_types (code, name, is_system) VALUES ('wedding-' || gen_random_uuid()::text, 'Wedding', TRUE) RETURNING id`,
  );
  return r.rows[0]!.id;
}

describe('event_type_readiness_items — schema correctness (Phase 3 Unit 4)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid item', async () => {
    const ty = await mkType(db);
    await db.query(
      `INSERT INTO event_type_readiness_items (event_type_id, label, module, weight, sort_order)
       VALUES ($1, 'Confirm venue', 'events', 5, 0)`,
      [ty],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_type_readiness_items`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects empty label', async () => {
    const ty = await mkType(db);
    const err = await tryExec(
      db,
      `INSERT INTO event_type_readiness_items (event_type_id, label) VALUES ($1, '   ')`,
      [ty],
    );
    expect(err).toMatch(/label_len|check/i);
  });

  it('rejects bogus module', async () => {
    const ty = await mkType(db);
    const err = await tryExec(
      db,
      `INSERT INTO event_type_readiness_items (event_type_id, label, module) VALUES ($1, 'X', 'unicorns')`,
      [ty],
    );
    expect(err).toMatch(/module|check/i);
  });

  it('rejects weight outside 0..100', async () => {
    const ty = await mkType(db);
    const err = await tryExec(
      db,
      `INSERT INTO event_type_readiness_items (event_type_id, label, weight) VALUES ($1, 'X', 101)`,
      [ty],
    );
    expect(err).toMatch(/weight_bounds|check/i);
  });

  it('rejects check_query > 8000 chars', async () => {
    const ty = await mkType(db);
    const err = await tryExec(
      db,
      `INSERT INTO event_type_readiness_items (event_type_id, label, check_query) VALUES ($1, 'X', $2)`,
      [ty, 'x'.repeat(8001)],
    );
    expect(err).toMatch(/check_query|check/i);
  });

  it('UNIQUE: case-insensitive label per event_type', async () => {
    const ty = await mkType(db);
    await db.query(
      `INSERT INTO event_type_readiness_items (event_type_id, label) VALUES ($1, 'Confirm Venue')`,
      [ty],
    );
    const err = await tryExec(
      db,
      `INSERT INTO event_type_readiness_items (event_type_id, label) VALUES ($1, 'confirm venue')`,
      [ty],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('different event_types can share label', async () => {
    const t1 = await mkType(db);
    const t2 = await mkType(db);
    await db.query(
      `INSERT INTO event_type_readiness_items (event_type_id, label) VALUES ($1, 'Confirm Venue'), ($2, 'Confirm Venue')`,
      [t1, t2],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_type_readiness_items`)
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting event_type removes its readiness items', async () => {
    const ty = await mkType(db);
    await db.query(
      `INSERT INTO event_type_readiness_items (event_type_id, label) VALUES ($1, 'X')`,
      [ty],
    );
    await db.query(`DELETE FROM event_types WHERE id = $1`, [ty]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_type_readiness_items`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const ty = await mkType(db);
    await db.query(
      `INSERT INTO event_type_readiness_items (event_type_id, label) VALUES ($1, 'X')`,
      [ty],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM event_type_readiness_items`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM event_type_readiness_items`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
