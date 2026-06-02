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

describe('RLS on guest_refresh_tokens (Phase 12 Unit 94)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('tenant_member and guest see zero (secret material)', async () => {
    const t = await mkTenant(db, 'grt-aaa');
    const e = await mkEvent(db, t, 'e-a');
    const gid = (await db.query<{ id: string }>(
      `INSERT INTO guests (tenant_id, event_id, name, rsvp_status, registration_status, check_in_status) VALUES ($1, $2, 'G', 'pending', 'pending_approval', 'not_checked_in') RETURNING id`,
      [t, e])).rows[0]!.id;
    await db.query(
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, gen_random_uuid(), 'abcdefghijklmnopqrstuvwxyz012345'::bytea, now() + interval '30 days')`,
      [t, e, gid]);
    const u = '00000000-0000-0000-0000-000000002700';
    await mkMember(db, t, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    expect((await db.query<{ id: string }>(`SELECT id FROM guest_refresh_tokens`)).rows.length).toBe(0);
    await asSuperuser(db);
    await setCtx(db, gid, 'guest', t);
    await asRole(db, 'authenticated');
    expect((await db.query<{ id: string }>(`SELECT id FROM guest_refresh_tokens`)).rows.length).toBe(0);
    await asSuperuser(db);
  });

  it('service_role sees all (BYPASSRLS)', async () => {
    const t = await mkTenant(db, 'grt-bbb');
    const e = await mkEvent(db, t, 'e-b');
    const gid = (await db.query<{ id: string }>(
      `INSERT INTO guests (tenant_id, event_id, name, rsvp_status, registration_status, check_in_status) VALUES ($1, $2, 'G', 'pending', 'pending_approval', 'not_checked_in') RETURNING id`,
      [t, e])).rows[0]!.id;
    await db.query(
      `INSERT INTO guest_refresh_tokens (tenant_id, event_id, guest_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, gen_random_uuid(), 'abcdefghijklmnopqrstuvwxyz012345'::bytea, now() + interval '30 days')`,
      [t, e, gid]);
    const n = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM guest_refresh_tokens`)).rows.length);
    expect(n).toBe(1);
  });
});
