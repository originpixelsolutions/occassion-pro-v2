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
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'W', FALSE) RETURNING id`, [tenant])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`, [tenant, ty, code])).rows[0]!.id;
}
async function mkGuest(db: TestDb, tenant: string, event: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO guests (tenant_id, event_id, name) VALUES ($1,$2,'G') RETURNING id`,
    [tenant, event])).rows[0]!.id;
}

const HASH = 'h'.repeat(64);

describe('guest_refresh_tokens — schema correctness (Phase 3 Unit 18)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid token', async () => {
    const t = await mkTenant(db, 'grt-aaa');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    await db.query(
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at)
       VALUES ($1,$2,$3, gen_random_uuid(), $4, now()+interval '7 days')`, [t, e, g, HASH]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM guest_refresh_tokens`)).rows[0]!.c).toBe(1);
  });

  it('UNIQUE token_hash blocks dupe', async () => {
    const t = await mkTenant(db, 'grt-bbb');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    await db.query(
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at)
       VALUES ($1,$2,$3, gen_random_uuid(), $4, now()+interval '7 days')`, [t, e, g, HASH]);
    const err = await tryExec(db,
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at)
       VALUES ($1,$2,$3, gen_random_uuid(), $4, now()+interval '7 days')`, [t, e, g, HASH]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('rejects expiry > 90 days', async () => {
    const t = await mkTenant(db, 'grt-ccc');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(db,
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at)
       VALUES ($1,$2,$3, gen_random_uuid(), $4, now()+interval '120 days')`, [t, e, g, HASH]);
    expect(err).toMatch(/expiry|check/i);
  });

  it('rev_coupling: revoked_at without reason rejected', async () => {
    const t = await mkTenant(db, 'grt-ddd');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(db,
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at, revoked_at)
       VALUES ($1,$2,$3, gen_random_uuid(), $4, now()+interval '7 days', now())`, [t, e, g, HASH]);
    expect(err).toMatch(/rev_coupling|check/i);
  });

  it('replaced_by requires revoked_at', async () => {
    const t = await mkTenant(db, 'grt-eee');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const old = (await db.query<{ id: string }>(
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at)
       VALUES ($1,$2,$3, gen_random_uuid(), $4, now()+interval '7 days') RETURNING id`, [t, e, g, HASH])).rows[0]!.id;
    const err = await tryExec(db,
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at, replaced_by)
       VALUES ($1,$2,$3, gen_random_uuid(), $4, now()+interval '7 days', $5)`,
      [t, e, g, 'h2'.repeat(40), old]);
    expect(err).toMatch(/replaced|check/i);
  });

  it('rotation: revoked + replaced_by accepted', async () => {
    const t = await mkTenant(db, 'grt-fff');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const fam = (await db.query<{ id: string }>(`SELECT gen_random_uuid() AS id`)).rows[0]!.id;
    const newTok = (await db.query<{ id: string }>(
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at)
       VALUES ($1,$2,$3,$4, $5, now()+interval '7 days') RETURNING id`,
      [t, e, g, fam, 'n'.repeat(64)])).rows[0]!.id;
    await db.query(
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at, revoked_at, revoked_reason, replaced_by)
       VALUES ($1,$2,$3,$4, $5, now()+interval '7 days', now(), 'rotated', $6)`,
      [t, e, g, fam, 'o'.repeat(64), newTok]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM guest_refresh_tokens WHERE family_id=$1`, [fam])).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('partial family-live index excludes revoked', async () => {
    const t = await mkTenant(db, 'grt-ggg');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const fam = (await db.query<{ id: string }>(`SELECT gen_random_uuid() AS id`)).rows[0]!.id;
    await db.query(
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at, revoked_at, revoked_reason)
       VALUES ($1,$2,$3,$4, $5, now()+interval '7 days', now(), 'rotated')`,
      [t, e, g, fam, 'r'.repeat(64)]);
    await db.query(
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at)
       VALUES ($1,$2,$3,$4, $5, now()+interval '7 days')`,
      [t, e, g, fam, 's'.repeat(64)]);
    const live = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM guest_refresh_tokens WHERE family_id=$1 AND revoked_at IS NULL`, [fam])).rows[0]!.c;
    expect(live).toBe(1);
  });

  it('cross-tenant: guest from another tenant rejected', async () => {
    const t1 = await mkTenant(db, 'grt-ttt');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'grt-uuu');
    const e2 = await mkEvent(db, t2);
    const gOther = await mkGuest(db, t2, e2);
    const err = await tryExec(db,
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at)
       VALUES ($1,$2,$3, gen_random_uuid(), $4, now()+interval '7 days')`, [t1, e1, gOther, HASH]);
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('guest belongs to wrong event rejected', async () => {
    const t = await mkTenant(db, 'grt-vvv');
    const e1 = await mkEvent(db, t, 'evt-aaa');
    const e2 = await mkEvent(db, t, 'evt-bbb');
    const gOnE2 = await mkGuest(db, t, e2);
    const err = await tryExec(db,
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at)
       VALUES ($1,$2,$3, gen_random_uuid(), $4, now()+interval '7 days')`, [t, e1, gOnE2, HASH]);
    expect(err).toMatch(/belongs to event/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'grt-www');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    await db.query(
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at)
       VALUES ($1,$2,$3, gen_random_uuid(), $4, now()+interval '7 days')`, [t, e, g, HASH]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM guest_refresh_tokens`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM guest_refresh_tokens`)).rows.length);
    expect(svc).toBe(1);
  });
});
