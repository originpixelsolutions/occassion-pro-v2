import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenantId: string, uid: string, email: string, role = 'owner'): Promise<void> {
  await db.query(
    `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($1, $2, $3, 'M', $4)`,
    [uid, tenantId, email, role]);
}
async function mkEvent(db: TestDb, tenantId: string, code: string): Promise<string> {
  const etId = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'w-' || $2, 'W', FALSE) RETURNING id`,
    [tenantId, code])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, $3, 'E', '2026-12-01', '2026-12-03', 'INR') RETURNING id`, [tenantId, etId, code])).rows[0]!.id;
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on floor_plans chain (Phase 12 Unit 100)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('member sees own tenant floor_plans only', async () => {
    const t1 = await mkTenant(db, 'fp-aaa');
    const t2 = await mkTenant(db, 'fp-bbb');
    const e1 = await mkEvent(db, t1, 'e-a');
    const e2 = await mkEvent(db, t2, 'e-b');
    await db.query(`INSERT INTO floor_plans (tenant_id, event_id, name, canvas, is_published, version) VALUES ($1, $2, 'FP A', '{}'::jsonb, FALSE, 1)`, [t1, e1]);
    await db.query(`INSERT INTO floor_plans (tenant_id, event_id, name, canvas, is_published, version) VALUES ($1, $2, 'FP B', '{}'::jsonb, FALSE, 1)`, [t2, e2]);
    const u = '00000000-0000-0000-0000-000000003300';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const names = (await db.query<{ name: string }>(`SELECT name FROM floor_plans`)).rows.map(r => r.name);
    await asSuperuser(db);
    expect(names).toEqual(['FP A']);
  });

  it('anon sees zero', async () => {
    const t = await mkTenant(db, 'fp-ccc');
    const e = await mkEvent(db, t, 'e-c');
    await db.query(`INSERT INTO floor_plans (tenant_id, event_id, name, canvas, is_published, version) VALUES ($1, $2, 'X', '{}'::jsonb, FALSE, 1)`, [t, e]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM floor_plans`)).rows.length);
    expect(n).toBe(0);
  });

  it('team_member cannot INSERT (manager-gated)', async () => {
    const t = await mkTenant(db, 'fp-ddd');
    const e = await mkEvent(db, t, 'e-d');
    const u = '00000000-0000-0000-0000-000000003310';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(`INSERT INTO floor_plans (tenant_id, event_id, name, canvas, is_published, version) VALUES ($1, $2, 'X', '{}'::jsonb, FALSE, 1)`, [t, e]); }
    catch (e2) { err = e2 instanceof Error ? e2.message : String(e2); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });
});
