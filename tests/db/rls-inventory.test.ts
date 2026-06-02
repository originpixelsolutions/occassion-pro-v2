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
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on inventory_items (Phase 12 Unit 99a)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('member sees own tenant items only', async () => {
    const t1 = await mkTenant(db, 'iv-aaa');
    const t2 = await mkTenant(db, 'iv-bbb');
    await db.query(`INSERT INTO inventory_items (tenant_id, name, quantity_total, quantity_in_stock, quantity_in_use, quantity_damaged, status) VALUES ($1, 'Chair A', 100, 100, 0, 0, 'active')`, [t1]);
    await db.query(`INSERT INTO inventory_items (tenant_id, name, quantity_total, quantity_in_stock, quantity_in_use, quantity_damaged, status) VALUES ($1, 'Chair B', 100, 100, 0, 0, 'active')`, [t2]);
    const u = '00000000-0000-0000-0000-000000003200';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const names = (await db.query<{ name: string }>(`SELECT name FROM inventory_items`)).rows.map(r => r.name);
    await asSuperuser(db);
    expect(names).toEqual(['Chair A']);
  });

  it('anon sees zero', async () => {
    const t = await mkTenant(db, 'iv-ccc');
    await db.query(`INSERT INTO inventory_items (tenant_id, name, quantity_total, quantity_in_stock, quantity_in_use, quantity_damaged, status) VALUES ($1, 'X', 0, 0, 0, 0, 'active')`, [t]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM inventory_items`)).rows.length);
    expect(n).toBe(0);
  });

  it('team_member cannot INSERT (manager-gated)', async () => {
    const t = await mkTenant(db, 'iv-ddd');
    const u = '00000000-0000-0000-0000-000000003210';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(`INSERT INTO inventory_items (tenant_id, name, quantity_total, quantity_in_stock, quantity_in_use, quantity_damaged, status) VALUES ($1, 'X', 0, 0, 0, 0, 'active')`, [t]); }
    catch (e) { err = e instanceof Error ? e.message : String(e); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });
});
