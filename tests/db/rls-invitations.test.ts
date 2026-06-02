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

describe('RLS on invitations (Phase 12 Unit 97)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('anon CAN read published invitations', async () => {
    const t = await mkTenant(db, 'inv-aaa');
    const e = await mkEvent(db, t, 'e-a');
    const u = '00000000-0000-0000-0000-000000003020';
    await mkMember(db, t, u, 'p@y.dev');
    await db.query(
      `INSERT INTO invitations (tenant_id, event_id, template_code, variant, config, is_published, published_at, published_by, version) VALUES ($1, $2, 'classic-1', 'static', '{}'::jsonb, TRUE, now(), $3, 1)`,
      [t, e, u]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM invitations`)).rows.length);
    expect(n).toBe(1);
  });

  it('anon CANNOT read drafts', async () => {
    const t = await mkTenant(db, 'inv-bbb');
    const e = await mkEvent(db, t, 'e-b');
    await db.query(
      `INSERT INTO invitations (tenant_id, event_id, template_code, variant, config, is_published, version) VALUES ($1, $2, 'classic-1', 'static', '{}'::jsonb, FALSE, 1)`,
      [t, e]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM invitations`)).rows.length);
    expect(n).toBe(0);
  });

  it('cross-tenant draft isolation', async () => {
    const t1 = await mkTenant(db, 'inv-ccc');
    const t2 = await mkTenant(db, 'inv-ddd');
    const e1 = await mkEvent(db, t1, 'e-c');
    const e2 = await mkEvent(db, t2, 'e-d');
    await db.query(`INSERT INTO invitations (tenant_id, event_id, template_code, variant, config, is_published, version) VALUES ($1, $2, 'tpl-a', 'static', '{}'::jsonb, FALSE, 1)`, [t1, e1]);
    await db.query(`INSERT INTO invitations (tenant_id, event_id, template_code, variant, config, is_published, version) VALUES ($1, $2, 'tpl-b', 'static', '{}'::jsonb, FALSE, 1)`, [t2, e2]);
    const u = '00000000-0000-0000-0000-000000003000';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const codes = (await db.query<{ template_code: string }>(`SELECT template_code FROM invitations`)).rows.map(r => r.template_code);
    await asSuperuser(db);
    expect(codes).toEqual(['tpl-a']);
  });

  it('team_member cannot INSERT (manager-gated)', async () => {
    const t = await mkTenant(db, 'inv-eee');
    const e = await mkEvent(db, t, 'e-e');
    const u = '00000000-0000-0000-0000-000000003010';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(`INSERT INTO invitations (tenant_id, event_id, template_code, variant, config, is_published, version) VALUES ($1, $2, 'tpl-x', 'static', '{}'::jsonb, FALSE, 1)`, [t, e]); }
    catch (e2) { err = e2 instanceof Error ? e2.message : String(e2); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });
});
