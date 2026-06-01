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
async function mkFull(db: TestDb, t: string, e: string, label='v0'): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO runsheet_versions (tenant_id, event_id, is_full, snapshot, version_label)
     VALUES ($1,$2, TRUE, '{"tasks":[]}'::jsonb, $3) RETURNING id`, [t, e, label])).rows[0]!.id;
}

describe('runsheet_versions — schema correctness (Phase 3 Unit 28)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid FULL snapshot', async () => {
    const t = await mkTenant(db, 'rv-aaa');
    const e = await mkEvent(db, t);
    await mkFull(db, t, e, 'baseline');
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM runsheet_versions WHERE is_full=TRUE`)).rows[0]!.c).toBe(1);
  });

  it('inserts a valid DIFF on top of a FULL', async () => {
    const t = await mkTenant(db, 'rv-bbb');
    const e = await mkEvent(db, t);
    const base = await mkFull(db, t, e);
    await db.query(
      `INSERT INTO runsheet_versions (tenant_id, event_id, is_full, diff, base_version_id)
       VALUES ($1,$2, FALSE, '{"ops":[{"add":"task1"}]}'::jsonb, $3)`, [t, e, base]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM runsheet_versions WHERE is_full=FALSE`)).rows[0]!.c).toBe(1);
  });

  it('FULL with diff field rejected', async () => {
    const t = await mkTenant(db, 'rv-ccc');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO runsheet_versions (tenant_id, event_id, is_full, snapshot, diff)
       VALUES ($1,$2, TRUE, '{}'::jsonb, '{}'::jsonb)`, [t, e]);
    expect(err).toMatch(/full_or_diff|check/i);
  });

  it('DIFF without base rejected', async () => {
    const t = await mkTenant(db, 'rv-ddd');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO runsheet_versions (tenant_id, event_id, is_full, diff)
       VALUES ($1,$2, FALSE, '{}'::jsonb)`, [t, e]);
    expect(err).toMatch(/full_or_diff|check/i);
  });

  it('FULL without snapshot rejected', async () => {
    const t = await mkTenant(db, 'rv-eee');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO runsheet_versions (tenant_id, event_id, is_full) VALUES ($1,$2, TRUE)`, [t, e]);
    expect(err).toMatch(/full_or_diff|check/i);
  });

  it('rejects array snapshot (must be object)', async () => {
    const t = await mkTenant(db, 'rv-fff');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO runsheet_versions (tenant_id, event_id, is_full, snapshot)
       VALUES ($1,$2, TRUE, '[]'::jsonb)`, [t, e]);
    expect(err).toMatch(/snapshot|check/i);
  });

  it('cycle: v1 base=v2, v2 base=v1 rejected', async () => {
    const t = await mkTenant(db, 'rv-ggg');
    const e = await mkEvent(db, t);
    const a = await mkFull(db, t, e, 'a');
    const b = (await db.query<{ id: string }>(
      `INSERT INTO runsheet_versions (tenant_id, event_id, is_full, diff, base_version_id)
       VALUES ($1,$2, FALSE, '{}'::jsonb, $3) RETURNING id`, [t, e, a])).rows[0]!.id;
    const err = await tryExec(db,
      `UPDATE runsheet_versions SET base_version_id = $1 WHERE id = $2`, [b, a]);
    expect(err).toMatch(/cycle|full_or_diff|check/i);
  });

  it('base_version from another event rejected', async () => {
    const t = await mkTenant(db, 'rv-hhh');
    const e1 = await mkEvent(db, t, 'evt-aaa');
    const e2 = await mkEvent(db, t, 'evt-bbb');
    const baseOnE2 = await mkFull(db, t, e2);
    const err = await tryExec(db,
      `INSERT INTO runsheet_versions (tenant_id, event_id, is_full, diff, base_version_id)
       VALUES ($1,$2, FALSE, '{}'::jsonb, $3)`, [t, e1, baseOnE2]);
    expect(err).toMatch(/base_version_id|tenant\/event/i);
  });

  it('cross-tenant event rejected', async () => {
    const t1 = await mkTenant(db, 'rv-ttt');
    const t2 = await mkTenant(db, 'rv-uuu');
    const e2 = await mkEvent(db, t2);
    const err = await tryExec(db,
      `INSERT INTO runsheet_versions (tenant_id, event_id, is_full, snapshot)
       VALUES ($1,$2, TRUE, '{}'::jsonb)`, [t1, e2]);
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'rv-www');
    const e = await mkEvent(db, t);
    await mkFull(db, t, e);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM runsheet_versions`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM runsheet_versions`)).rows.length);
    expect(svc).toBe(1);
  });
});
