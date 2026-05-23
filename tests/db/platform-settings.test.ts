/**
 * platform_settings — Phase 1, Unit 3.
 *
 * Singleton invariant, sole-operator-mode consistency, RLS pair.
 * Spec refs: 2.9.2 (Sole Operator Mode), 2.9.8 (auto-disable trigger).
 */
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

describe('platform_settings — schema correctness (Phase 1, Unit 3)', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  // -------------------------------------------------------------------------
  // Singleton invariant
  // -------------------------------------------------------------------------

  it('seeds exactly one row at id = 1 with sole_operator_mode = true', async () => {
    const r = await db.query<{
      id: number;
      sole_operator_mode: boolean;
      sole_operator_disabled_at: string | null;
    }>(`SELECT id, sole_operator_mode, sole_operator_disabled_at FROM platform_settings`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      id: 1,
      sole_operator_mode: true,
      sole_operator_disabled_at: null,
    });
  });

  it('rejects inserting a row with id != 1', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO platform_settings (id, sole_operator_mode) VALUES (2, true)`,
    );
    expect(err).toMatch(/platform_settings_singleton|check constraint/i);
  });

  it('rejects inserting a second row with id = 1 (PK duplicate)', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO platform_settings (id, sole_operator_mode) VALUES (1, true)`,
    );
    expect(err).toMatch(/duplicate|primary key|unique/i);
  });

  // -------------------------------------------------------------------------
  // sole_operator_mode consistency CHECK
  // -------------------------------------------------------------------------

  it('rejects disabling sole_operator_mode without disabled_at', async () => {
    const err = await tryExec(
      db,
      `UPDATE platform_settings SET sole_operator_mode = false WHERE id = 1`,
    );
    expect(err).toMatch(/sole_operator_consistency|check constraint/i);
  });

  it('rejects setting disabled_at while sole_operator_mode is still true', async () => {
    const err = await tryExec(
      db,
      `UPDATE platform_settings SET sole_operator_disabled_at = now() WHERE id = 1`,
    );
    expect(err).toMatch(/sole_operator_consistency|check constraint/i);
  });

  it('allows flipping both columns atomically (the legal transition)', async () => {
    await db.query(`
      UPDATE platform_settings
         SET sole_operator_mode = false,
             sole_operator_disabled_at = now()
       WHERE id = 1
    `);
    const r = await db.query<{
      sole_operator_mode: boolean;
      sole_operator_disabled_at: string | null;
    }>(
      `SELECT sole_operator_mode, sole_operator_disabled_at FROM platform_settings WHERE id = 1`,
    );
    expect(r.rows[0]!.sole_operator_mode).toBe(false);
    expect(r.rows[0]!.sole_operator_disabled_at).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // updated_at trigger
  // -------------------------------------------------------------------------

  it('advances updated_at on UPDATE', async () => {
    const before = await db.query<{ created_at: string; updated_at: string }>(
      `SELECT created_at, updated_at FROM platform_settings WHERE id = 1`,
    );
    await new Promise((r) => setTimeout(r, 20));
    await db.query(
      `UPDATE platform_settings SET sole_operator_mode = false, sole_operator_disabled_at = now() WHERE id = 1`,
    );
    const after = await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM platform_settings WHERE id = 1`,
    );
    expect(new Date(after.rows[0]!.updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0]!.updated_at).getTime(),
    );
  });

  // -------------------------------------------------------------------------
  // RLS pair
  // -------------------------------------------------------------------------

  it('RLS: anon sees zero rows (default-deny)', async () => {
    const seen = await withRole(db, 'anon', async () => {
      const r = await db.query<{ id: number }>(`SELECT id FROM platform_settings`);
      return r.rows.length;
    });
    expect(seen).toBe(0);
  });

  it('RLS: service_role bypasses RLS and sees the singleton', async () => {
    const seen = await withRole(db, 'service_role', async () => {
      const r = await db.query<{ id: number }>(`SELECT id FROM platform_settings`);
      return r.rows.length;
    });
    expect(seen).toBe(1);
  });

  it('RLS: anon cannot UPDATE either (default-deny is total)', async () => {
    const err = await withRole(db, 'anon', () =>
      tryExec(
        db,
        `UPDATE platform_settings SET sole_operator_mode = false WHERE id = 1`,
      ),
    );
    // anon doesn't see the row, so UPDATE matches 0 rows but should also
    // not be able to bypass RLS via a row-targeted WHERE.
    expect(err === '' || /row-level security|policy|permission/i.test(err)).toBe(true);
  });
});
