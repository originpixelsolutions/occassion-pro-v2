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

describe('RLS on event_websites (Phase 12 Unit 74)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('anon CAN read published websites (public surface)', async () => {
    const t = await mkTenant(db, 'rew-aaa');
    const e = await mkEvent(db, t, 'e-a');
    await db.query(`INSERT INTO event_websites (event_id, tenant_id, is_published, published_at, sections) VALUES ($1, $2, TRUE, now(), '{}'::jsonb)`, [e, t]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ event_id: string }>(`SELECT event_id FROM event_websites`)).rows.length);
    expect(n).toBe(1);
  });

  it('anon CANNOT read draft websites (unpublished)', async () => {
    const t = await mkTenant(db, 'rew-bbb');
    const e = await mkEvent(db, t, 'e-b');
    await db.query(`INSERT INTO event_websites (event_id, tenant_id, is_published, sections) VALUES ($1, $2, FALSE, '{}'::jsonb)`, [e, t]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ event_id: string }>(`SELECT event_id FROM event_websites`)).rows.length);
    expect(n).toBe(0);
  });

  it('tenant_member sees own drafts but not other tenants', async () => {
    const t1 = await mkTenant(db, 'rew-ccc');
    const t2 = await mkTenant(db, 'rew-ddd');
    const e1 = await mkEvent(db, t1, 'e-c1');
    const e2 = await mkEvent(db, t2, 'e-c2');
    await db.query(`INSERT INTO event_websites (event_id, tenant_id, is_published, sections) VALUES ($1, $2, FALSE, '{}'::jsonb)`, [e1, t1]);
    await db.query(`INSERT INTO event_websites (event_id, tenant_id, is_published, sections) VALUES ($1, $2, FALSE, '{}'::jsonb)`, [e2, t2]);
    const u = '00000000-0000-0000-0000-000000000700';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ event_id: string }>(`SELECT event_id FROM event_websites`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });

  it('owner can INSERT', async () => {
    const t = await mkTenant(db, 'rew-eee');
    const e = await mkEvent(db, t, 'e-e');
    const u = '00000000-0000-0000-0000-000000000710';
    await mkMember(db, t, u, 'o@y.dev', 'owner');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(`INSERT INTO event_websites (event_id, tenant_id, is_published, sections) VALUES ($1, $2, FALSE, '{}'::jsonb)`, [e, t]);
    await asSuperuser(db);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_websites`)).rows[0]!.c).toBe(1);
  });

  it('team_member cannot INSERT', async () => {
    const t = await mkTenant(db, 'rew-fff');
    const e = await mkEvent(db, t, 'e-f');
    const u = '00000000-0000-0000-0000-000000000720';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(`INSERT INTO event_websites (event_id, tenant_id, is_published, sections) VALUES ($1, $2, FALSE, '{}'::jsonb)`, [e, t]); }
    catch (e2) { err = e2 instanceof Error ? e2.message : String(e2); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });
});
