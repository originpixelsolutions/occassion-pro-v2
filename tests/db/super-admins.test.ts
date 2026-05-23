/**
 * super_admins — Phase 1, Unit 1 — schema, constraint, and RLS tests.
 *
 * Covers every CHECK, every NOT NULL, the partial-unique soft-delete behaviour,
 * the updated_at trigger, and the RLS pair (non-privileged default-deny vs
 * service-role bypass).
 *
 * Spec refs: Part 2.9.1, 2.9.5, 2.9.7, 2.9.8, Part 19.2, Part 34.0 Phase 1.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

const VALID = {
  email: 'founder@occasionpro.dev',
  full_name: 'Solo Founder',
  role: 'owner',
} as const;

/** Insert helper. Returns the new row. Throws on SQL error. */
async function insertSuperAdmin(
  db: TestDb,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const row = { ...VALID, ...overrides } as Record<string, unknown>;
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const result = await db.query<Record<string, unknown>>(
    `INSERT INTO super_admins (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    cols.map((c) => row[c]),
  );
  if (result.rows.length === 0) throw new Error('insert returned no rows');
  return result.rows[0]!;
}

/** Run a statement and capture the error message, returning '' on success. */
async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params);
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe('super_admins — schema correctness (Phase 1, Unit 1)', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  // -------------------------------------------------------------------------
  // Happy paths
  // -------------------------------------------------------------------------

  it('inserts a minimal valid super admin', async () => {
    const row = await insertSuperAdmin(db);
    expect(row.email).toBe('founder@occasionpro.dev');
    expect(row.role).toBe('owner');
    expect(row.removed_at).toBeNull();
    expect(row.created_at).toBeTruthy();
    expect(row.updated_at).toBeTruthy();
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('accepts every one of the 7 spec roles (2.9.1)', async () => {
    const roles = ['owner', 'admin', 'engineering', 'support', 'sales', 'finance', 'auditor'];
    for (const [i, role] of roles.entries()) {
      const row = await insertSuperAdmin(db, {
        email: `${role}-${i}@occasionpro.dev`,
        role,
      });
      expect(row.role).toBe(role);
    }
  });

  it('accepts a valid E.164 recovery_phone', async () => {
    const row = await insertSuperAdmin(db, { recovery_phone: '+14155552671' });
    expect(row.recovery_phone).toBe('+14155552671');
  });

  it('treats email as case-insensitive (citext)', async () => {
    await insertSuperAdmin(db, { email: 'Mixed.Case@Example.COM' });
    const result = await db.query<{ email: string }>(
      `SELECT email FROM super_admins WHERE email = 'mixed.case@example.com'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // CHECK constraints
  // -------------------------------------------------------------------------

  it('rejects a role outside the 7-role enum', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO super_admins (email, full_name, role) VALUES ($1, $2, $3)`,
      ['x@y.dev', 'X Y', 'root'],
    );
    expect(err).toMatch(/super_admins_role_check|check constraint/i);
  });

  it('rejects an empty / whitespace-only full_name', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO super_admins (email, full_name, role) VALUES ($1, $2, $3)`,
      ['x@y.dev', '   ', 'owner'],
    );
    expect(err).toMatch(/super_admins_full_name_check|check constraint/i);
  });

  it('rejects a malformed recovery_phone', async () => {
    const cases = ['12345', '+0123456789', 'not-a-phone', '+1', '+12345678901234567890'];
    for (const phone of cases) {
      const err = await tryExec(
        db,
        `INSERT INTO super_admins (email, full_name, role, recovery_phone) VALUES ($1, $2, $3, $4)`,
        [`p-${phone}@y.dev`, 'X', 'owner', phone],
      );
      expect(err).toMatch(/recovery_phone_check|check constraint/i);
    }
  });

  it('rejects a removed_at in the future', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO super_admins (email, full_name, role, removed_at)
       VALUES ($1, $2, $3, now() + interval '1 day')`,
      ['future@y.dev', 'X', 'owner'],
    );
    expect(err).toMatch(/removed_at_check|check constraint/i);
  });

  // -------------------------------------------------------------------------
  // NOT NULL
  // -------------------------------------------------------------------------

  it('rejects a missing email', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO super_admins (full_name, role) VALUES ($1, $2)`,
      ['No Email', 'owner'],
    );
    expect(err).toMatch(/email.*null|null.*email/i);
  });

  it('rejects a missing full_name', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO super_admins (email, role) VALUES ($1, $2)`,
      ['noname@y.dev', 'owner'],
    );
    expect(err).toMatch(/full_name.*null|null.*full_name/i);
  });

  it('rejects a missing role', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO super_admins (email, full_name) VALUES ($1, $2)`,
      ['norole@y.dev', 'No Role'],
    );
    expect(err).toMatch(/role.*null|null.*role/i);
  });

  // -------------------------------------------------------------------------
  // Partial unique index — soft-delete-aware
  // -------------------------------------------------------------------------

  it('blocks a duplicate email while the first row is active', async () => {
    await insertSuperAdmin(db, { email: 'dup@y.dev' });
    const err = await tryExec(
      db,
      `INSERT INTO super_admins (email, full_name, role) VALUES ($1, $2, $3)`,
      ['dup@y.dev', 'Second', 'admin'],
    );
    expect(err).toMatch(/uq_super_admins_email_active|unique/i);
  });

  it('allows reusing an email once the first row is soft-deleted', async () => {
    const first = await insertSuperAdmin(db, { email: 'rotate@y.dev' });
    await db.query(`UPDATE super_admins SET removed_at = now() WHERE id = $1`, [first.id]);
    const second = await insertSuperAdmin(db, { email: 'rotate@y.dev', role: 'admin' });
    expect(second.id).not.toBe(first.id);
    expect(second.role).toBe('admin');
  });

  // -------------------------------------------------------------------------
  // updated_at trigger
  // -------------------------------------------------------------------------

  it('advances updated_at on UPDATE via the trigger', async () => {
    const before = await insertSuperAdmin(db, { email: 'touch@y.dev' });
    // Force a measurable gap so the comparison is unambiguous.
    await new Promise((r) => setTimeout(r, 20));
    await db.query(`UPDATE super_admins SET full_name = 'Renamed' WHERE id = $1`, [before.id]);
    const result = await db.query<{ updated_at: string; created_at: string }>(
      `SELECT updated_at, created_at FROM super_admins WHERE id = $1`,
      [before.id],
    );
    const row = result.rows[0]!;
    expect(new Date(row.updated_at).getTime()).toBeGreaterThan(
      new Date(row.created_at).getTime(),
    );
  });

  // -------------------------------------------------------------------------
  // RLS — default-deny pair
  // super_admins isn't tenant-scoped, but RLS is enabled + FORCED. The
  // equivalent of the spec's "authorized + cross-tenant-empty" pair is
  // "service_role-can-read" + "anon-cannot-read".
  // -------------------------------------------------------------------------

  it('RLS: anon receives zero rows (default-deny, no policy)', async () => {
    await insertSuperAdmin(db, { email: 'rls@y.dev' });
    const seen = await withRole(db, 'anon', async () => {
      const r = await db.query<{ id: string }>(`SELECT id FROM super_admins`);
      return r.rows.length;
    });
    expect(seen).toBe(0);
  });

  it('RLS: authenticated also receives zero rows (no policy yet)', async () => {
    await insertSuperAdmin(db, { email: 'rls2@y.dev' });
    const seen = await withRole(db, 'authenticated', async () => {
      const r = await db.query<{ id: string }>(`SELECT id FROM super_admins`);
      return r.rows.length;
    });
    expect(seen).toBe(0);
  });

  it('RLS: service_role bypasses RLS and sees the row', async () => {
    await insertSuperAdmin(db, { email: 'rls3@y.dev' });
    const seen = await withRole(db, 'service_role', async () => {
      const r = await db.query<{ id: string }>(`SELECT id FROM super_admins`);
      return r.rows.length;
    });
    expect(seen).toBe(1);
  });

  it('RLS: anon cannot INSERT either (default-deny is total)', async () => {
    const err = await withRole(db, 'anon', () =>
      tryExec(
        db,
        `INSERT INTO super_admins (email, full_name, role) VALUES ($1, $2, $3)`,
        ['anon-insert@y.dev', 'No', 'owner'],
      ),
    );
    expect(err).toMatch(/row-level security|policy|permission/i);
  });
});
