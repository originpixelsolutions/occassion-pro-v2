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
    `INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'wedding-' || $2, 'W', FALSE) RETURNING id`,
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

describe('RLS on event_subteams (Phase 12 Unit 71)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('member sees own tenant subteams only', async () => {
    const t1 = await mkTenant(db, 'res-aaa');
    const t2 = await mkTenant(db, 'res-bbb');
    const e1 = await mkEvent(db, t1, 'e-a');
    const e2 = await mkEvent(db, t2, 'e-b');
    await db.query(`INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'Decor')`, [t1, e1]);
    await db.query(`INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'Catering')`, [t2, e2]);
    const uid = '00000000-0000-0000-0000-000000000400';
    await mkMember(db, t1, uid, 'm@y.dev');
    await setCtx(db, uid, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const names = (await db.query<{ name: string }>(`SELECT name FROM event_subteams`)).rows.map(r => r.name);
    await asSuperuser(db);
    expect(names).toEqual(['Decor']);
  });

  it('anon sees zero subteams', async () => {
    const t = await mkTenant(db, 'res-ccc');
    const e = await mkEvent(db, t, 'e-c');
    await db.query(`INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'X')`, [t, e]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM event_subteams`)).rows.length);
    expect(n).toBe(0);
  });

  it('owner can INSERT subteams', async () => {
    const t = await mkTenant(db, 'res-ddd');
    const e = await mkEvent(db, t, 'e-d');
    const uid = '00000000-0000-0000-0000-000000000410';
    await mkMember(db, t, uid, 'o@y.dev', 'owner');
    await setCtx(db, uid, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(`INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'New')`, [t, e]);
    await asSuperuser(db);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_subteams WHERE name='New'`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('team_member cannot INSERT subteams', async () => {
    const t = await mkTenant(db, 'res-eee');
    const e = await mkEvent(db, t, 'e-e');
    const uid = '00000000-0000-0000-0000-000000000420';
    await mkMember(db, t, uid, 'tm@y.dev', 'team_member');
    await setCtx(db, uid, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(`INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'X')`, [t, e]); }
    catch (e2) { err = e2 instanceof Error ? e2.message : String(e2); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });
});
