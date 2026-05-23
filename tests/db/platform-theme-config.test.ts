/**
 * platform_theme_config — Phase 1, Unit 4.
 *
 * Singleton invariant, hex_color DOMAIN enforcement, bounds CHECKs on
 * gradient angle / radius / version, status state-machine guard rails,
 * draft-vs-approver invariant, RLS pair.
 * Spec refs: 33.10, 33.10.3.
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

describe('platform_theme_config — schema correctness (Phase 1, Unit 4)', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  // -------------------------------------------------------------------------
  // Singleton + default v2 palette
  // -------------------------------------------------------------------------

  it('seeds one row at id = 1 with the v2 palette defaults', async () => {
    const r = await db.query<{
      id: number;
      brand_primary: string;
      brand_secondary: string;
      status: string;
      version: number;
    }>(`SELECT id, brand_primary, brand_secondary, status, version FROM platform_theme_config`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      id: 1,
      brand_primary: '#CA4B32',
      brand_secondary: '#E2A528',
      status: 'live',
      version: 1,
    });
  });

  it('rejects a second config row (singleton via PK + CHECK)', async () => {
    const err = await tryExec(db, `INSERT INTO platform_theme_config (id) VALUES (2)`);
    expect(err).toMatch(/ptc_singleton|check constraint|primary key/i);
  });

  // -------------------------------------------------------------------------
  // hex_color DOMAIN
  // -------------------------------------------------------------------------

  it('rejects a non-hex brand_primary via the hex_color DOMAIN', async () => {
    const err = await tryExec(
      db,
      `UPDATE platform_theme_config SET brand_primary = 'red' WHERE id = 1`,
    );
    expect(err).toMatch(/hex_color|domain|check/i);
  });

  it('rejects a short hex (#FFF) — domain requires 6 digits', async () => {
    const err = await tryExec(
      db,
      `UPDATE platform_theme_config SET brand_primary = '#FFF' WHERE id = 1`,
    );
    expect(err).toMatch(/hex_color|domain|check/i);
  });

  it('accepts a valid 6-digit hex with mixed case', async () => {
    await db.query(`UPDATE platform_theme_config SET brand_primary = '#aBcDeF' WHERE id = 1`);
    const r = await db.query<{ brand_primary: string }>(
      `SELECT brand_primary FROM platform_theme_config WHERE id = 1`,
    );
    expect(r.rows[0]!.brand_primary).toBe('#aBcDeF');
  });

  // -------------------------------------------------------------------------
  // Bounds CHECKs
  // -------------------------------------------------------------------------

  it('rejects a gradient angle outside 0..360', async () => {
    const err = await tryExec(
      db,
      `UPDATE platform_theme_config SET brand_gradient_angle = 400 WHERE id = 1`,
    );
    expect(err).toMatch(/gradient_angle|check/i);
  });

  it('rejects a negative radius', async () => {
    const err = await tryExec(db, `UPDATE platform_theme_config SET radius_sm = -1 WHERE id = 1`);
    expect(err).toMatch(/radius|check/i);
  });

  it('rejects version below 1', async () => {
    const err = await tryExec(db, `UPDATE platform_theme_config SET version = 0 WHERE id = 1`);
    expect(err).toMatch(/version|check/i);
  });

  // -------------------------------------------------------------------------
  // Enumerated CHECKs
  // -------------------------------------------------------------------------

  it('rejects a bogus default_theme_mode', async () => {
    const err = await tryExec(
      db,
      `UPDATE platform_theme_config SET default_theme_mode = 'neon' WHERE id = 1`,
    );
    expect(err).toMatch(/theme_mode|check/i);
  });

  it('rejects a bogus status', async () => {
    const err = await tryExec(
      db,
      `UPDATE platform_theme_config SET status = 'reviewing' WHERE id = 1`,
    );
    expect(err).toMatch(/status|check/i);
  });

  // -------------------------------------------------------------------------
  // State-machine invariants
  // -------------------------------------------------------------------------

  it("rejects 'staged' status without staged_at", async () => {
    const err = await tryExec(
      db,
      `UPDATE platform_theme_config SET status = 'staged' WHERE id = 1`,
    );
    expect(err).toMatch(/staged_at|check/i);
  });

  it("rejects 'rollback' status without rolled_back_at", async () => {
    const err = await tryExec(
      db,
      `UPDATE platform_theme_config SET status = 'rollback' WHERE id = 1`,
    );
    expect(err).toMatch(/rolled_back_at|check/i);
  });

  // -------------------------------------------------------------------------
  // Approver vs drafter (two-person principle)
  // -------------------------------------------------------------------------

  it('rejects approved_by without draft_by (cannot approve nothing)', async () => {
    const approver = await insertSuperAdmin(db, 'a@y.dev');
    const err = await tryExec(
      db,
      `UPDATE platform_theme_config SET approved_by = $1 WHERE id = 1`,
      [approver],
    );
    expect(err).toMatch(/draft_by|check/i);
  });

  it('rejects same user as drafter and approver', async () => {
    const u = await insertSuperAdmin(db, 'd@y.dev');
    const err = await tryExec(
      db,
      `UPDATE platform_theme_config SET draft_by = $1, approved_by = $1 WHERE id = 1`,
      [u],
    );
    expect(err).toMatch(/check/i);
  });

  it('allows different drafter and approver', async () => {
    const drafter = await insertSuperAdmin(db, 'd1@y.dev');
    const approver = await insertSuperAdmin(db, 'a1@y.dev');
    await db.query(
      `UPDATE platform_theme_config SET draft_by = $1, approved_by = $2 WHERE id = 1`,
      [drafter, approver],
    );
    const r = await db.query<{ draft_by: string; approved_by: string }>(
      `SELECT draft_by, approved_by FROM platform_theme_config WHERE id = 1`,
    );
    expect(r.rows[0]!.draft_by).toBe(drafter);
    expect(r.rows[0]!.approved_by).toBe(approver);
  });

  // -------------------------------------------------------------------------
  // FK ON DELETE SET NULL
  // -------------------------------------------------------------------------

  it('sets draft_by to NULL when the super_admin is hard-deleted', async () => {
    const drafter = await insertSuperAdmin(db, 'd2@y.dev');
    await db.query(`UPDATE platform_theme_config SET draft_by = $1 WHERE id = 1`, [drafter]);
    await db.query(`DELETE FROM super_admins WHERE id = $1`, [drafter]);
    const r = await db.query<{ draft_by: string | null }>(
      `SELECT draft_by FROM platform_theme_config WHERE id = 1`,
    );
    expect(r.rows[0]!.draft_by).toBeNull();
  });

  // -------------------------------------------------------------------------
  // updated_at trigger
  // -------------------------------------------------------------------------

  it('advances updated_at on UPDATE', async () => {
    const before = await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM platform_theme_config WHERE id = 1`,
    );
    await new Promise((r) => setTimeout(r, 20));
    await db.query(`UPDATE platform_theme_config SET brand_primary = '#112233' WHERE id = 1`);
    const after = await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM platform_theme_config WHERE id = 1`,
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
      const r = await db.query<{ id: number }>(`SELECT id FROM platform_theme_config`);
      return r.rows.length;
    });
    expect(seen).toBe(0);
  });

  it('RLS: service_role bypasses RLS and sees the singleton', async () => {
    const seen = await withRole(db, 'service_role', async () => {
      const r = await db.query<{ id: number }>(`SELECT id FROM platform_theme_config`);
      return r.rows.length;
    });
    expect(seen).toBe(1);
  });
});
