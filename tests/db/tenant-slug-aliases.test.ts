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

describe('tenant_slug_aliases — schema correctness (Phase 2 Unit 5)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid alias', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_slug_aliases (tenant_id, old_slug, new_slug, redirect_until)
       VALUES ($1, 'old-slug', 'new-slug', now() + interval '90 days')`,
      [t],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_slug_aliases`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects identical old and new slugs', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_slug_aliases (tenant_id, old_slug, new_slug, redirect_until)
       VALUES ($1, 'same', 'same', now() + interval '30 days')`,
      [t],
    );
    expect(err).toMatch(/differ|check/i);
  });

  it('rejects redirect_until in the past', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_slug_aliases (tenant_id, old_slug, new_slug, redirect_until)
       VALUES ($1, 'old', 'new', now() - interval '1 day')`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('rejects malformed slug', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_slug_aliases (tenant_id, old_slug, new_slug, redirect_until)
       VALUES ($1, 'BAD_SLUG', 'good-slug', now() + interval '30 days')`,
      [t],
    );
    expect(err).toMatch(/format|check/i);
  });

  it('trigger: blocks a second active alias on the same old_slug', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    await db.query(
      `INSERT INTO tenant_slug_aliases (tenant_id, old_slug, new_slug, redirect_until)
       VALUES ($1, 'shared-old', 'acme-new', now() + interval '30 days')`,
      [t1],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_slug_aliases (tenant_id, old_slug, new_slug, redirect_until)
       VALUES ($1, 'shared-old', 'beta-new', now() + interval '30 days')`,
      [t2],
    );
    expect(err).toMatch(/active_conflict|unique/i);
  });

  it('CASCADE: deleting tenant removes its aliases', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_slug_aliases (tenant_id, old_slug, new_slug, redirect_until)
       VALUES ($1, 'old', 'new', now() + interval '30 days')`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_slug_aliases`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_slug_aliases (tenant_id, old_slug, new_slug, redirect_until)
       VALUES ($1, 'old', 'new', now() + interval '30 days')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_slug_aliases`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_slug_aliases`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
