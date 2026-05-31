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
     VALUES ($1, 'Acme Co', 'INR') RETURNING id`,
    [slug],
  );
  return r.rows[0]!.id;
}

async function mkFlag(db: TestDb, code: string, def = false): Promise<void> {
  await db.query(
    `INSERT INTO feature_flags (code, name, default_enabled) VALUES ($1, 'flag', $2)`,
    [code, def],
  );
}

async function mkAdmin(db: TestDb, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO super_admins (email, full_name, role) VALUES ($1, 'A', 'owner') RETURNING id`,
    [email],
  );
  return r.rows[0]!.id;
}

describe('tenant_feature_overrides — schema correctness (Phase 2 Unit 6)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts an override and respects composite PK', async () => {
    const t = await mkTenant(db, 'acme-co');
    await mkFlag(db, 'beta_calendar');
    await db.query(
      `INSERT INTO tenant_feature_overrides (tenant_id, flag_code, enabled)
       VALUES ($1, 'beta_calendar', true)`,
      [t],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_feature_overrides`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('composite PK rejects a duplicate (tenant_id, flag_code)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await mkFlag(db, 'beta_calendar');
    await db.query(
      `INSERT INTO tenant_feature_overrides (tenant_id, flag_code, enabled)
       VALUES ($1, 'beta_calendar', true)`,
      [t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_feature_overrides (tenant_id, flag_code, enabled)
       VALUES ($1, 'beta_calendar', false)`,
      [t],
    );
    expect(err).toMatch(/duplicate|primary key|unique/i);
  });

  it('allows the same flag enabled per tenant on different tenants', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    await mkFlag(db, 'beta_calendar');
    await db.query(
      `INSERT INTO tenant_feature_overrides (tenant_id, flag_code, enabled)
       VALUES ($1, 'beta_calendar', true), ($2, 'beta_calendar', false)`,
      [t1, t2],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_feature_overrides`)
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('rejects reason longer than 500 chars', async () => {
    const t = await mkTenant(db, 'acme-co');
    await mkFlag(db, 'beta_calendar');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_feature_overrides (tenant_id, flag_code, enabled, reason)
       VALUES ($1, 'beta_calendar', true, $2)`,
      [t, 'x'.repeat(501)],
    );
    expect(err).toMatch(/reason_len|check/i);
  });

  it('FK to feature_flags: unknown flag is rejected', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_feature_overrides (tenant_id, flag_code, enabled)
       VALUES ($1, 'unknown_flag', true)`,
      [t],
    );
    expect(err).toMatch(/foreign key/i);
  });

  it('CASCADE: deleting tenant removes its overrides', async () => {
    const t = await mkTenant(db, 'acme-co');
    await mkFlag(db, 'beta_calendar');
    await db.query(
      `INSERT INTO tenant_feature_overrides (tenant_id, flag_code, enabled)
       VALUES ($1, 'beta_calendar', true)`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_feature_overrides`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('CASCADE: deleting feature_flag removes the override', async () => {
    const t = await mkTenant(db, 'acme-co');
    await mkFlag(db, 'beta_calendar');
    await db.query(
      `INSERT INTO tenant_feature_overrides (tenant_id, flag_code, enabled)
       VALUES ($1, 'beta_calendar', true)`,
      [t],
    );
    await db.query(`DELETE FROM feature_flags WHERE code = 'beta_calendar'`);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_feature_overrides`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('SET NULL: deleting set_by_admin nulls it but keeps the override', async () => {
    const t = await mkTenant(db, 'acme-co');
    await mkFlag(db, 'beta_calendar');
    const admin = await mkAdmin(db, 'a@y.dev');
    await db.query(
      `INSERT INTO tenant_feature_overrides (tenant_id, flag_code, enabled, set_by_admin)
       VALUES ($1, 'beta_calendar', true, $2)`,
      [t, admin],
    );
    await db.query(`DELETE FROM super_admins WHERE id = $1`, [admin]);
    const r = await db.query<{ set_by_admin: string | null }>(
      `SELECT set_by_admin FROM tenant_feature_overrides WHERE tenant_id = $1`,
      [t],
    );
    expect(r.rows[0]!.set_by_admin).toBeNull();
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await mkFlag(db, 'beta_calendar');
    await db.query(
      `INSERT INTO tenant_feature_overrides (tenant_id, flag_code, enabled)
       VALUES ($1, 'beta_calendar', true)`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM tenant_feature_overrides`))
          .rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM tenant_feature_overrides`))
          .rows.length,
    );
    expect(svc).toBe(1);
  });
});
