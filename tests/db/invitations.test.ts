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

describe('invitations — schema correctness (Phase 3 Unit 23)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid draft', async () => {
    const t = await mkTenant(db, 'inv-aaa');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO invitations (tenant_id, event_id, template_code, variant, config)
       VALUES ($1,$2,'royal-gold','static','{"hero":"Welcome"}'::jsonb)`, [t, e]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM invitations`)).rows[0]!.c).toBe(1);
  });

  it('rejects bad template_code', async () => {
    const t = await mkTenant(db, 'inv-bbb');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO invitations (tenant_id, event_id, template_code, config)
       VALUES ($1,$2,'Royal Gold','{}'::jsonb)`, [t, e]);
    expect(err).toMatch(/template_code|check/i);
  });

  it('rejects bad variant', async () => {
    const t = await mkTenant(db, 'inv-ccc');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO invitations (tenant_id, event_id, template_code, variant, config)
       VALUES ($1,$2,'royal-gold','3d','{}'::jsonb)`, [t, e]);
    expect(err).toMatch(/variant|check/i);
  });

  it('rejects array config', async () => {
    const t = await mkTenant(db, 'inv-ddd');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO invitations (tenant_id, event_id, template_code, config)
       VALUES ($1,$2,'royal-gold','["a","b"]'::jsonb)`, [t, e]);
    expect(err).toMatch(/config|check/i);
  });

  it('video variant without video_url rejected', async () => {
    const t = await mkTenant(db, 'inv-eee');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO invitations (tenant_id, event_id, template_code, variant, config)
       VALUES ($1,$2,'cinematic','video','{}'::jsonb)`, [t, e]);
    expect(err).toMatch(/video|check/i);
  });

  it('publish coupling: is_published=TRUE requires publisher + at', async () => {
    const t = await mkTenant(db, 'inv-fff');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO invitations (tenant_id, event_id, template_code, config, is_published)
       VALUES ($1,$2,'royal-gold','{}'::jsonb, TRUE)`, [t, e]);
    expect(err).toMatch(/publish|check/i);
  });

  it('rejects non-https pdf_url', async () => {
    const t = await mkTenant(db, 'inv-ggg');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO invitations (tenant_id, event_id, template_code, config, pdf_url)
       VALUES ($1,$2,'royal-gold','{}'::jsonb, 'http://insecure/x.pdf')`, [t, e]);
    expect(err).toMatch(/pdf_url|check/i);
  });

  it('partial UNIQUE blocks dupe (event, template_code) active', async () => {
    const t = await mkTenant(db, 'inv-hhh');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO invitations (tenant_id, event_id, template_code, config)
       VALUES ($1,$2,'royal-gold','{}'::jsonb)`, [t, e]);
    const err = await tryExec(db,
      `INSERT INTO invitations (tenant_id, event_id, template_code, config)
       VALUES ($1,$2,'royal-gold','{}'::jsonb)`, [t, e]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('publish happy path with member', async () => {
    const t = await mkTenant(db, 'inv-iii');
    const e = await mkEvent(db, t);
    const m = await mkMember(db, t, 'p@y.dev');
    await db.query(
      `INSERT INTO invitations (tenant_id, event_id, template_code, config, is_published, published_at, published_by, created_by)
       VALUES ($1,$2,'royal-gold','{}'::jsonb, TRUE, now(), $3, $3)`, [t, e, m]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM invitations WHERE is_published=TRUE`)).rows[0]!.c).toBe(1);
  });

  it('cross-tenant publisher rejected', async () => {
    const t1 = await mkTenant(db, 'inv-ttt');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'inv-uuu');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(db,
      `INSERT INTO invitations (tenant_id, event_id, template_code, config, is_published, published_at, published_by)
       VALUES ($1,$2,'royal-gold','{}'::jsonb, TRUE, now(), $3)`, [t1, e1, mOther]);
    expect(err).toMatch(/published_by|tenant/i);
  });

  it('cross-tenant event rejected', async () => {
    const t1 = await mkTenant(db, 'inv-vvv');
    const t2 = await mkTenant(db, 'inv-www');
    const e2 = await mkEvent(db, t2);
    const err = await tryExec(db,
      `INSERT INTO invitations (tenant_id, event_id, template_code, config)
       VALUES ($1,$2,'royal-gold','{}'::jsonb)`, [t1, e2]);
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'inv-xxx');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO invitations (tenant_id, event_id, template_code, config)
       VALUES ($1,$2,'royal-gold','{}'::jsonb)`, [t, e]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM invitations`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM invitations`)).rows.length);
    expect(svc).toBe(1);
  });
});
