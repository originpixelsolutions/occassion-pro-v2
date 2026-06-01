import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`,
    [slug])).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenant: string, code='evt-001'): Promise<string> {
  const ty = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'conf-' || gen_random_uuid()::text, 'Conf', FALSE) RETURNING id`, [tenant])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`, [tenant, ty, code])).rows[0]!.id;
}

describe('sessions — schema correctness (Phase 3 Unit 22a)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid session', async () => {
    const t = await mkTenant(db, 'sess-aaa');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO sessions (tenant_id, event_id, session_type, title, starts_at, ends_at, room, language_code)
       VALUES ($1,$2,'keynote','Opening Keynote', now()+interval '1 hour', now()+interval '2 hours', 'Hall A', 'en')`,
      [t, e]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM sessions`)).rows[0]!.c).toBe(1);
  });

  it('rejects bad session_type', async () => {
    const t = await mkTenant(db, 'sess-bbb');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO sessions (tenant_id, event_id, session_type, title, starts_at, ends_at)
       VALUES ($1,$2,'masterclass','T', now(), now()+interval '1 hour')`, [t, e]);
    expect(err).toMatch(/type|check/i);
  });

  it('rejects ends_at <= starts_at', async () => {
    const t = await mkTenant(db, 'sess-ccc');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO sessions (tenant_id, event_id, title, starts_at, ends_at)
       VALUES ($1,$2,'T', now()+interval '2 hours', now()+interval '1 hour')`, [t, e]);
    expect(err).toMatch(/time_order|check/i);
  });

  it('cpd_credits without is_cpd_eligible rejected', async () => {
    const t = await mkTenant(db, 'sess-ddd');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO sessions (tenant_id, event_id, title, starts_at, ends_at, cpd_credits)
       VALUES ($1,$2,'T', now(), now()+interval '1 hour', 1.5)`, [t, e]);
    expect(err).toMatch(/cpd|check/i);
  });

  it('is_published without published_at rejected', async () => {
    const t = await mkTenant(db, 'sess-eee');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO sessions (tenant_id, event_id, title, starts_at, ends_at, is_published)
       VALUES ($1,$2,'T', now(), now()+interval '1 hour', TRUE)`, [t, e]);
    expect(err).toMatch(/publish|check/i);
  });

  it('rejects non-https streaming_url', async () => {
    const t = await mkTenant(db, 'sess-fff');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO sessions (tenant_id, event_id, title, starts_at, ends_at, streaming_url)
       VALUES ($1,$2,'T', now(), now()+interval '1 hour', 'http://insecure/stream')`, [t, e]);
    expect(err).toMatch(/streaming_url|check/i);
  });

  it('rejects bad language_code', async () => {
    const t = await mkTenant(db, 'sess-ggg');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO sessions (tenant_id, event_id, title, starts_at, ends_at, language_code)
       VALUES ($1,$2,'T', now(), now()+interval '1 hour', 'English')`, [t, e]);
    expect(err).toMatch(/language|check/i);
  });

  it('accepts cpd_eligible + cpd_credits + published with publish ts', async () => {
    const t = await mkTenant(db, 'sess-hhh');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO sessions (tenant_id, event_id, title, starts_at, ends_at, is_cpd_eligible, cpd_credits, is_published, published_at)
       VALUES ($1,$2,'CPD Workshop', now()+interval '1 day', now()+interval '1 day 2 hours', TRUE, 2.5, TRUE, now())`,
      [t, e]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM sessions`)).rows[0]!.c).toBe(1);
  });

  it('cross-tenant: session.tenant_id != event.tenant_id rejected', async () => {
    const t1 = await mkTenant(db, 'sess-ttt');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'sess-uuu');
    const err = await tryExec(db,
      `INSERT INTO sessions (tenant_id, event_id, title, starts_at, ends_at)
       VALUES ($1,$2,'X', now(), now()+interval '1 hour')`, [t2, e1]);
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'sess-www');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO sessions (tenant_id, event_id, title, starts_at, ends_at)
       VALUES ($1,$2,'T', now(), now()+interval '1 hour')`, [t, e]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM sessions`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM sessions`)).rows.length);
    expect(svc).toBe(1);
  });
});
