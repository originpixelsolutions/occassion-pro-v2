/**
 * super_admin_role_permissions — Phase 1, Unit 2.
 *
 * Constraint + RLS coverage for the permission matrix table.
 * Spec refs: 2.9.1 (7 roles), 2.9.3 (matrix), 2.9.4 (two-person approval).
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

describe('super_admin_role_permissions — schema correctness (Phase 1, Unit 2)', () => {
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

  it('inserts a minimal valid row with defaults', async () => {
    const r = await db.query<{
      role: string;
      capability: string;
      granted: boolean;
      needs_approval: boolean;
    }>(
      `INSERT INTO super_admin_role_permissions (role, capability)
       VALUES ('owner', 'approve_tenant_signups') RETURNING *`,
    );
    expect(r.rows[0]).toMatchObject({
      role: 'owner',
      capability: 'approve_tenant_signups',
      granted: false,
      needs_approval: false,
    });
  });

  it('accepts all 7 spec roles paired with one capability', async () => {
    const roles = ['owner', 'admin', 'engineering', 'support', 'sales', 'finance', 'auditor'];
    for (const role of roles) {
      await db.query(
        `INSERT INTO super_admin_role_permissions (role, capability, granted)
         VALUES ($1, 'view_security_alerts', true)`,
        [role],
      );
    }
    const r = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM super_admin_role_permissions WHERE granted = true`,
    );
    expect(r.rows[0]!.count).toBe('7');
  });

  it('stores needs_approval and conditional flags faithfully', async () => {
    await db.query(
      `INSERT INTO super_admin_role_permissions
        (role, capability, granted, needs_approval, conditional, notes)
       VALUES ('admin', 'force_purge_data', true, true, 'reason_required',
               'Marked dagger in spec 2.9.3 matrix')`,
    );
    const r = await db.query<{
      needs_approval: boolean;
      conditional: string;
      notes: string;
    }>(
      `SELECT needs_approval, conditional, notes FROM super_admin_role_permissions
       WHERE role = 'admin' AND capability = 'force_purge_data'`,
    );
    expect(r.rows[0]).toMatchObject({
      needs_approval: true,
      conditional: 'reason_required',
    });
  });

  // -------------------------------------------------------------------------
  // CHECK constraints
  // -------------------------------------------------------------------------

  it('rejects a role outside the 7-role enum', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO super_admin_role_permissions (role, capability) VALUES ('root', 'x')`,
    );
    expect(err).toMatch(/sarp_role_check|check constraint/i);
  });

  it('rejects an empty / whitespace-only capability', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO super_admin_role_permissions (role, capability) VALUES ('owner', '   ')`,
    );
    expect(err).toMatch(/sarp_capability_check|check constraint/i);
  });

  // -------------------------------------------------------------------------
  // NOT NULL
  // -------------------------------------------------------------------------

  it('rejects a NULL role', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO super_admin_role_permissions (role, capability) VALUES (NULL, 'x')`,
    );
    expect(err).toMatch(/null|not.?null/i);
  });

  it('rejects a NULL capability', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO super_admin_role_permissions (role, capability) VALUES ('owner', NULL)`,
    );
    expect(err).toMatch(/null|not.?null/i);
  });

  // -------------------------------------------------------------------------
  // Composite primary key
  // -------------------------------------------------------------------------

  it('blocks a duplicate (role, capability) pair', async () => {
    await db.query(
      `INSERT INTO super_admin_role_permissions (role, capability) VALUES ('owner', 'cap_x')`,
    );
    const err = await tryExec(
      db,
      `INSERT INTO super_admin_role_permissions (role, capability) VALUES ('owner', 'cap_x')`,
    );
    expect(err).toMatch(/duplicate|primary key|unique/i);
  });

  it('allows the same capability across different roles', async () => {
    await db.query(
      `INSERT INTO super_admin_role_permissions (role, capability) VALUES ('owner', 'cap_y')`,
    );
    await db.query(
      `INSERT INTO super_admin_role_permissions (role, capability) VALUES ('admin', 'cap_y')`,
    );
    const r = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM super_admin_role_permissions WHERE capability = 'cap_y'`,
    );
    expect(r.rows[0]!.count).toBe('2');
  });

  // -------------------------------------------------------------------------
  // updated_at trigger
  // -------------------------------------------------------------------------

  it('advances updated_at on UPDATE', async () => {
    await db.query(
      `INSERT INTO super_admin_role_permissions (role, capability) VALUES ('owner', 'cap_touch')`,
    );
    await new Promise((r) => setTimeout(r, 20));
    await db.query(
      `UPDATE super_admin_role_permissions SET granted = true
       WHERE role = 'owner' AND capability = 'cap_touch'`,
    );
    const r = await db.query<{ updated_at: string; created_at: string }>(
      `SELECT updated_at, created_at FROM super_admin_role_permissions
       WHERE role = 'owner' AND capability = 'cap_touch'`,
    );
    expect(new Date(r.rows[0]!.updated_at).getTime()).toBeGreaterThan(
      new Date(r.rows[0]!.created_at).getTime(),
    );
  });

  // -------------------------------------------------------------------------
  // RLS pair
  // -------------------------------------------------------------------------

  it('RLS: anon sees zero rows (default-deny)', async () => {
    await db.query(
      `INSERT INTO super_admin_role_permissions (role, capability, granted)
       VALUES ('owner', 'rls_x', true)`,
    );
    const seen = await withRole(db, 'anon', async () => {
      const r = await db.query<{ role: string }>(`SELECT role FROM super_admin_role_permissions`);
      return r.rows.length;
    });
    expect(seen).toBe(0);
  });

  it('RLS: service_role bypasses RLS and sees the row', async () => {
    await db.query(
      `INSERT INTO super_admin_role_permissions (role, capability, granted)
       VALUES ('owner', 'rls_y', true)`,
    );
    const seen = await withRole(db, 'service_role', async () => {
      const r = await db.query<{ role: string }>(`SELECT role FROM super_admin_role_permissions`);
      return r.rows.length;
    });
    expect(seen).toBe(1);
  });

  it('RLS: anon cannot INSERT (default-deny is total)', async () => {
    const err = await withRole(db, 'anon', () =>
      tryExec(
        db,
        `INSERT INTO super_admin_role_permissions (role, capability) VALUES ('owner', 'rls_z')`,
      ),
    );
    expect(err).toMatch(/row-level security|policy|permission/i);
  });
});
