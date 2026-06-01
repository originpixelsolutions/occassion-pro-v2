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

describe('subscription_pauses — schema correctness (Phase 2 Unit 37)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid 30-day pause', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO subscription_pauses (tenant_id, pause_resume_at)
       VALUES ($1, now() + interval '30 days')`,
      [t],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM subscription_pauses`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects a pause shorter than 7 days (spec minimum)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO subscription_pauses (tenant_id, pause_resume_at)
       VALUES ($1, now() + interval '6 days')`,
      [t],
    );
    expect(err).toMatch(/min_duration|check/i);
  });

  it('rejects a pause longer than 120 days (Enterprise ceiling)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO subscription_pauses (tenant_id, pause_resume_at)
       VALUES ($1, now() + interval '121 days')`,
      [t],
    );
    expect(err).toMatch(/max_duration|check/i);
  });

  it('accepts boundary cases: exactly 7 days and exactly 120 days', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    await db.query(
      `INSERT INTO subscription_pauses (tenant_id, pause_resume_at)
       VALUES ($1, now() + interval '7 days')`,
      [t1],
    );
    await db.query(
      `INSERT INTO subscription_pauses (tenant_id, pause_resume_at)
       VALUES ($1, now() + interval '120 days')`,
      [t2],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM subscription_pauses`))
      .rows[0]!.c;
    expect(c).toBe(2);
  });

  it('rejects resumed_at before paused_at', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO subscription_pauses (tenant_id, paused_at, pause_resume_at, resumed_at)
       VALUES ($1, now(), now() + interval '30 days', now() - interval '1 hour')`,
      [t],
    );
    expect(err).toMatch(/resumed_after_paused|check/i);
  });

  it('partial UNIQUE: blocks a second open pause for same tenant', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO subscription_pauses (tenant_id, pause_resume_at)
       VALUES ($1, now() + interval '30 days')`,
      [t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO subscription_pauses (tenant_id, pause_resume_at)
       VALUES ($1, now() + interval '30 days')`,
      [t],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('resumed pause does NOT block a new open pause for same tenant', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO subscription_pauses (tenant_id, pause_resume_at, resumed_at)
       VALUES ($1, now() + interval '30 days', now() + interval '20 days')`,
      [t],
    );
    await db.query(
      `INSERT INTO subscription_pauses (tenant_id, pause_resume_at)
       VALUES ($1, now() + interval '30 days')`,
      [t],
    );
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM subscription_pauses WHERE tenant_id = $1`,
        [t],
      )
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting tenant removes its pauses', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO subscription_pauses (tenant_id, pause_resume_at)
       VALUES ($1, now() + interval '30 days')`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM subscription_pauses`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO subscription_pauses (tenant_id, pause_resume_at)
       VALUES ($1, now() + interval '30 days')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM subscription_pauses`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM subscription_pauses`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
