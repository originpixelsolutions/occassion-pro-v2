/**
 * tenants — Phase 2, Unit 1.
 * Covers: slug regex, currency regex, business_country regex, status enum +
 * timestamp invariants, white-label hex overrides via hex_color DOMAIN,
 * previous_company_names jsonb shape, FK SET NULL on suspended_by,
 * updated_at trigger, RLS pair. Plus the Phase-1 deferred FKs to event_types
 * and event_templates are exercised.
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

async function newTenant(db: TestDb, overrides: Record<string, unknown> = {}) {
  const cols = { slug: 'acme-co', company_name: 'Acme Co', billing_currency: 'INR', ...overrides };
  const keys = Object.keys(cols);
  const ph = keys.map((_, i) => `$${i + 1}`).join(', ');
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenants (${keys.join(',')}) VALUES (${ph}) RETURNING id`,
    keys.map((k) => (cols as Record<string, unknown>)[k]),
  );
  return r.rows[0]!.id;
}

describe('tenants — schema correctness (Phase 2 Unit 1)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a minimal valid tenant with defaults', async () => {
    const id = await newTenant(db);
    const r = await db.query<{ status: string; timezone: string; region: string }>(
      `SELECT status, timezone, region FROM tenants WHERE id = $1`,
      [id],
    );
    expect(r.rows[0]).toMatchObject({
      status: 'active',
      timezone: 'Asia/Kolkata',
      region: 'ap-south-1',
    });
  });

  it('rejects slug with bad format', async () => {
    for (const bad of [
      'UPPER',
      'a',
      '-leading',
      'trailing-',
      'spa ce',
      'sym!bol',
      'ab',
      'a'.repeat(31),
    ]) {
      const err = await tryExec(
        db,
        `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'X','INR')`,
        [bad],
      );
      expect(err, `slug=${bad}`).toMatch(/slug_format|check|unique|duplicate/i);
    }
  });

  it('rejects non-uppercase billing_currency', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ('t1','X','inr')`,
    );
    expect(err).toMatch(/billing_currency|check/i);
  });

  it('rejects bad business_country', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO tenants (slug, company_name, billing_currency, business_country) VALUES ('t2','X','USD','india')`,
    );
    expect(err).toMatch(/business_country|check/i);
  });

  it('rejects previous_company_names that is not a JSON array', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO tenants (slug, company_name, billing_currency, previous_company_names)
       VALUES ('t3','X','USD','{"k":1}'::jsonb)`,
    );
    expect(err).toMatch(/check/i);
  });

  it('rejects status=suspended without suspended_at + reason', async () => {
    const id = await newTenant(db, { slug: 't-sus' });
    const err = await tryExec(db, `UPDATE tenants SET status = 'suspended' WHERE id = $1`, [id]);
    expect(err).toMatch(/check/i);
  });

  it('rejects status=cancelled without cancelled_at', async () => {
    const id = await newTenant(db, { slug: 't-can' });
    const err = await tryExec(db, `UPDATE tenants SET status = 'cancelled' WHERE id = $1`, [id]);
    expect(err).toMatch(/check/i);
  });

  it('hex_color override rejects non-hex', async () => {
    const id = await newTenant(db, { slug: 't-hex' });
    const err = await tryExec(
      db,
      `UPDATE tenants SET brand_primary_override = 'red' WHERE id = $1`,
      [id],
    );
    expect(err).toMatch(/hex_color|check/i);
  });

  it('updated_at trigger advances on UPDATE', async () => {
    const id = await newTenant(db, { slug: 't-touch' });
    const before = await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM tenants WHERE id = $1`,
      [id],
    );
    await new Promise((r) => setTimeout(r, 20));
    await db.query(`UPDATE tenants SET logo_url = 'https://x' WHERE id = $1`, [id]);
    const after = await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM tenants WHERE id = $1`,
      [id],
    );
    expect(new Date(after.rows[0]!.updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0]!.updated_at).getTime(),
    );
  });

  it('FK to super_admins for suspended_by SET NULL on hard delete', async () => {
    const admin = (
      await db.query<{ id: string }>(
        `INSERT INTO super_admins (email, full_name, role) VALUES ('s@y.dev','S','owner') RETURNING id`,
      )
    ).rows[0]!.id;
    const id = await newTenant(db, { slug: 't-fk' });
    await db.query(
      `UPDATE tenants SET status = 'suspended', suspended_at = now(), suspended_reason = 'r', suspended_by = $1 WHERE id = $2`,
      [admin, id],
    );
    await db.query(`DELETE FROM super_admins WHERE id = $1`, [admin]);
    const r = await db.query<{ suspended_by: string | null }>(
      `SELECT suspended_by FROM tenants WHERE id = $1`,
      [id],
    );
    expect(r.rows[0]!.suspended_by).toBeNull();
  });

  it('CASCADE: deleting a tenant cleans up its event_types rows', async () => {
    const id = await newTenant(db, { slug: 't-casc' });
    await db.query(
      `INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'custom_wedding', 'Custom Wedding', false)`,
      [id],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [id]);
    const r = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM event_types WHERE tenant_id IS NOT NULL`,
    );
    expect(r.rows[0]!.c).toBe(0);
  });

  it('RLS pair: anon empty, service_role bypass', async () => {
    await newTenant(db, { slug: 't-rls' });
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM tenants`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM tenants`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
