/**
 * platform_theme_history — Phase 1, Unit 5.
 *
 * Append-only audit log. Covers happy-path INSERT, every CHECK, the
 * append-only trigger pair (UPDATE blocked, DELETE blocked), FK
 * ON DELETE SET NULL, and the RLS pair.
 *
 * Spec refs: 33.10, 33.10.3, Part 14 (audit log immutability).
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

async function insertSuperAdmin(db: TestDb, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO super_admins (email, full_name, role) VALUES ($1, 'X', 'owner') RETURNING id`,
    [email],
  );
  return r.rows[0]!.id;
}

const SNAPSHOT = JSON.stringify({
  brand_primary: '#CA4B32',
  brand_secondary: '#E2A528',
  version: 1,
});

describe('platform_theme_history — schema correctness (Phase 1, Unit 5)', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('inserts a row with defaults (published_at, id)', async () => {
    const r = await db.query<{
      id: string;
      version: number;
      snapshot: Record<string, unknown>;
      published_at: string;
    }>(
      `INSERT INTO platform_theme_history (version, snapshot)
       VALUES (1, $1::jsonb) RETURNING id, version, snapshot, published_at`,
      [SNAPSHOT],
    );
    expect(r.rows[0]!.version).toBe(1);
    expect(r.rows[0]!.snapshot).toMatchObject({ brand_primary: '#CA4B32' });
    expect(r.rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(r.rows[0]!.published_at).getTime()).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // CHECK constraints
  // -------------------------------------------------------------------------

  it('rejects version < 1', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO platform_theme_history (version, snapshot) VALUES (0, $1::jsonb)`,
      [SNAPSHOT],
    );
    expect(err).toMatch(/version|check/i);
  });

  it('rejects a snapshot that is a JSON array (not object)', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO platform_theme_history (version, snapshot)
       VALUES (1, '[1,2,3]'::jsonb)`,
    );
    expect(err).toMatch(/snapshot_shape|check/i);
  });

  it('rejects a snapshot that is a JSON scalar', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO platform_theme_history (version, snapshot)
       VALUES (1, '"a string"'::jsonb)`,
    );
    expect(err).toMatch(/snapshot_shape|check/i);
  });

  it('rejects a whitespace-only reason', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO platform_theme_history (version, snapshot, reason)
       VALUES (1, $1::jsonb, '   ')`,
      [SNAPSHOT],
    );
    expect(err).toMatch(/reason|check/i);
  });

  it('accepts a NULL reason', async () => {
    await db.query(`INSERT INTO platform_theme_history (version, snapshot) VALUES (1, $1::jsonb)`, [
      SNAPSHOT,
    ]);
    const r = await db.query<{ reason: string | null }>(
      `SELECT reason FROM platform_theme_history LIMIT 1`,
    );
    expect(r.rows[0]!.reason).toBeNull();
  });

  // -------------------------------------------------------------------------
  // NOT NULL
  // -------------------------------------------------------------------------

  it('rejects a NULL version', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO platform_theme_history (version, snapshot) VALUES (NULL, $1::jsonb)`,
      [SNAPSHOT],
    );
    expect(err).toMatch(/null|not.?null/i);
  });

  it('rejects a NULL snapshot', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO platform_theme_history (version, snapshot) VALUES (1, NULL)`,
    );
    expect(err).toMatch(/null|not.?null/i);
  });

  // -------------------------------------------------------------------------
  // Append-only — UPDATE and DELETE are blocked
  // -------------------------------------------------------------------------

  it('blocks UPDATE via the append-only trigger', async () => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO platform_theme_history (version, snapshot) VALUES (1, $1::jsonb) RETURNING id`,
      [SNAPSHOT],
    );
    const err = await tryExec(
      db,
      `UPDATE platform_theme_history SET reason = 'tampered' WHERE id = $1`,
      [r.rows[0]!.id],
    );
    expect(err).toMatch(/append-only|insufficient_privilege|not permitted/i);
  });

  it('blocks DELETE via the append-only trigger', async () => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO platform_theme_history (version, snapshot) VALUES (1, $1::jsonb) RETURNING id`,
      [SNAPSHOT],
    );
    const err = await tryExec(db, `DELETE FROM platform_theme_history WHERE id = $1`, [
      r.rows[0]!.id,
    ]);
    expect(err).toMatch(/append-only|insufficient_privilege|not permitted/i);
  });

  it('blocks UPDATE even with no WHERE-changed row (defense in depth)', async () => {
    await db.query(`INSERT INTO platform_theme_history (version, snapshot) VALUES (1, $1::jsonb)`, [
      SNAPSHOT,
    ]);
    const err = await tryExec(db, `UPDATE platform_theme_history SET version = 99`);
    expect(err).toMatch(/append-only|insufficient_privilege|not permitted/i);
  });

  // -------------------------------------------------------------------------
  // FK ON DELETE RESTRICT — append-only history protects attribution.
  // Hard-deleting a super_admin who appears in theme history must fail.
  // Use the removed_at soft-delete on super_admins instead.
  // -------------------------------------------------------------------------

  it('blocks hard-delete of a super_admin who has theme history (RESTRICT)', async () => {
    const admin = await insertSuperAdmin(db, 'hist@y.dev');
    await db.query(
      `INSERT INTO platform_theme_history (version, snapshot, changed_by)
       VALUES (1, $1::jsonb, $2)`,
      [SNAPSHOT, admin],
    );
    const err = await tryExec(db, `DELETE FROM super_admins WHERE id = $1`, [admin]);
    expect(err).toMatch(/foreign key|restrict|violates/i);
    // History row stays put and still references the admin.
    const r = await db.query<{ changed_by: string }>(
      `SELECT changed_by FROM platform_theme_history LIMIT 1`,
    );
    expect(r.rows[0]!.changed_by).toBe(admin);
  });

  it('still allows the soft-delete pattern (removed_at) without breaking history', async () => {
    const admin = await insertSuperAdmin(db, 'soft@y.dev');
    await db.query(
      `INSERT INTO platform_theme_history (version, snapshot, changed_by)
       VALUES (1, $1::jsonb, $2)`,
      [SNAPSHOT, admin],
    );
    await db.query(`UPDATE super_admins SET removed_at = now() WHERE id = $1`, [admin]);
    const r = await db.query<{ changed_by: string }>(
      `SELECT changed_by FROM platform_theme_history LIMIT 1`,
    );
    expect(r.rows[0]!.changed_by).toBe(admin);
  });

  // -------------------------------------------------------------------------
  // Newest-first index ordering
  // -------------------------------------------------------------------------

  it('returns rows in version DESC via the spec-named index', async () => {
    for (const v of [1, 2, 3, 4, 5]) {
      await db.query(
        `INSERT INTO platform_theme_history (version, snapshot) VALUES ($1, $2::jsonb)`,
        [v, SNAPSHOT],
      );
    }
    const r = await db.query<{ version: number }>(
      `SELECT version FROM platform_theme_history ORDER BY version DESC LIMIT 3`,
    );
    expect(r.rows.map((row) => row.version)).toEqual([5, 4, 3]);
  });

  // -------------------------------------------------------------------------
  // RLS pair
  // -------------------------------------------------------------------------

  it('RLS: anon sees zero rows (default-deny)', async () => {
    await db.query(`INSERT INTO platform_theme_history (version, snapshot) VALUES (1, $1::jsonb)`, [
      SNAPSHOT,
    ]);
    const seen = await withRole(db, 'anon', async () => {
      const r = await db.query<{ id: string }>(`SELECT id FROM platform_theme_history`);
      return r.rows.length;
    });
    expect(seen).toBe(0);
  });

  it('RLS: service_role bypasses and sees the row', async () => {
    await db.query(`INSERT INTO platform_theme_history (version, snapshot) VALUES (1, $1::jsonb)`, [
      SNAPSHOT,
    ]);
    const seen = await withRole(db, 'service_role', async () => {
      const r = await db.query<{ id: string }>(`SELECT id FROM platform_theme_history`);
      return r.rows.length;
    });
    expect(seen).toBe(1);
  });

  it('RLS: anon cannot INSERT (default-deny is total)', async () => {
    const err = await withRole(db, 'anon', () =>
      tryExec(db, `INSERT INTO platform_theme_history (version, snapshot) VALUES (1, $1::jsonb)`, [
        SNAPSHOT,
      ]),
    );
    expect(err).toMatch(/row-level security|policy|permission/i);
  });
});
