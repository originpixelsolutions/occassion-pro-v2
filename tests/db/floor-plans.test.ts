import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenant: string, code='evt-001'): Promise<string> {
  const ty = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'W', FALSE) RETURNING id`, [tenant])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`, [tenant, ty, code])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1,$2,'M','event_manager') RETURNING id`, [tenant, email])).rows[0]!.id;
}

describe('floor_plans — schema correctness (Phase 3 Unit 32)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid draft', async () => {
    const t = await mkTenant(db, 'fp-aaa');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO floor_plans (tenant_id, event_id, name, canvas, width, height)
       VALUES ($1,$2,'Main Hall','{"layers":[]}'::jsonb, 1920, 1080)`, [t, e]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM floor_plans`)).rows[0]!.c).toBe(1);
  });

  it('rejects array canvas', async () => {
    const t = await mkTenant(db, 'fp-bbb');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO floor_plans (tenant_id, event_id, name, canvas)
       VALUES ($1,$2,'Plan','[]'::jsonb)`, [t, e]);
    expect(err).toMatch(/canvas|check/i);
  });

  it('publish coupling: is_published=TRUE requires publisher+at', async () => {
    const t = await mkTenant(db, 'fp-ccc');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO floor_plans (tenant_id, event_id, name, canvas, is_published)
       VALUES ($1,$2,'Plan','{}'::jsonb, TRUE)`, [t, e]);
    expect(err).toMatch(/publish|check/i);
  });

  it('unpublished_at must come after published_at', async () => {
    const t = await mkTenant(db, 'fp-ddd');
    const e = await mkEvent(db, t);
    const m = await mkMember(db, t, 'p@y.dev');
    const err = await tryExec(db,
      `INSERT INTO floor_plans (tenant_id, event_id, name, canvas, is_published, published_at, published_by, unpublished_at)
       VALUES ($1,$2,'Plan','{}'::jsonb, TRUE, now(), $3, now() - interval '1 hour')`, [t, e, m]);
    expect(err).toMatch(/check/i);
  });

  it('rejects non-https thumbnail_url', async () => {
    const t = await mkTenant(db, 'fp-eee');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO floor_plans (tenant_id, event_id, name, canvas, thumbnail_url)
       VALUES ($1,$2,'Plan','{}'::jsonb, 'http://insecure/thumb.png')`, [t, e]);
    expect(err).toMatch(/thumbnail_url|check/i);
  });

  it('rejects width <= 0', async () => {
    const t = await mkTenant(db, 'fp-fff');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO floor_plans (tenant_id, event_id, name, canvas, width)
       VALUES ($1,$2,'Plan','{}'::jsonb, 0)`, [t, e]);
    expect(err).toMatch(/width|check/i);
  });

  it('partial UNIQUE blocks dupe (event, lower(name))', async () => {
    const t = await mkTenant(db, 'fp-ggg');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO floor_plans (tenant_id, event_id, name, canvas) VALUES ($1,$2,'Main Hall','{}'::jsonb)`, [t, e]);
    const err = await tryExec(db,
      `INSERT INTO floor_plans (tenant_id, event_id, name, canvas) VALUES ($1,$2,'MAIN HALL','{}'::jsonb)`, [t, e]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('publish happy path', async () => {
    const t = await mkTenant(db, 'fp-hhh');
    const e = await mkEvent(db, t);
    const m = await mkMember(db, t, 'p@y.dev');
    await db.query(
      `INSERT INTO floor_plans (tenant_id, event_id, name, canvas, is_published, published_at, published_by, created_by)
       VALUES ($1,$2,'Plan','{}'::jsonb, TRUE, now(), $3, $3)`, [t, e, m]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM floor_plans WHERE is_published=TRUE`)).rows[0]!.c).toBe(1);
  });

  it('cross-tenant publisher rejected', async () => {
    const t1 = await mkTenant(db, 'fp-ttt');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'fp-uuu');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(db,
      `INSERT INTO floor_plans (tenant_id, event_id, name, canvas, is_published, published_at, published_by)
       VALUES ($1,$2,'Plan','{}'::jsonb, TRUE, now(), $3)`, [t1, e1, mOther]);
    expect(err).toMatch(/published_by|tenant/i);
  });

  it('cross-tenant event rejected', async () => {
    const t1 = await mkTenant(db, 'fp-vvv');
    const t2 = await mkTenant(db, 'fp-www');
    const e2 = await mkEvent(db, t2);
    const err = await tryExec(db,
      `INSERT INTO floor_plans (tenant_id, event_id, name, canvas) VALUES ($1,$2,'Plan','{}'::jsonb)`, [t1, e2]);
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'fp-xxx');
    const e = await mkEvent(db, t);
    await db.query(`INSERT INTO floor_plans (tenant_id, event_id, name, canvas) VALUES ($1,$2,'Plan','{}'::jsonb)`, [t, e]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM floor_plans`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM floor_plans`)).rows.length);
    expect(svc).toBe(1);
  });
});
