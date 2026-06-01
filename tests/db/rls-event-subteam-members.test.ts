import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`,
      [slug],
    )
  ).rows[0]!.id;
}
async function mkMember(
  db: TestDb,
  tenantId: string,
  uid: string,
  email: string,
  role = 'owner',
): Promise<void> {
  await db.query(
    `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($1, $2, $3, 'M', $4)`,
    [uid, tenantId, email, role],
  );
}
async function mkSubteam(
  db: TestDb,
  tenantId: string,
  code: string,
): Promise<{ subteamId: string }> {
  const etId = (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'wedding-' || $2, 'W', FALSE) RETURNING id`,
      [tenantId, code],
    )
  ).rows[0]!.id;
  const eid = (
    await db.query<{ id: string }>(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, $3, 'E', '2026-12-01', '2026-12-03', 'INR') RETURNING id`,
      [tenantId, etId, code],
    )
  ).rows[0]!.id;
  const sid = (
    await db.query<{ id: string }>(
      `INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, 'Decor') RETURNING id`,
      [tenantId, eid],
    )
  ).rows[0]!.id;
  return { subteamId: sid };
}
async function setCtx(
  db: TestDb,
  uid: string | null,
  userType: string | null,
  tenantId: string | null,
) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on event_subteam_members (Phase 12 Unit 72)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('member sees own tenant subteam members only', async () => {
    const t1 = await mkTenant(db, 'rsm-aaa');
    const t2 = await mkTenant(db, 'rsm-bbb');
    const u1 = '00000000-0000-0000-0000-000000000500';
    const u2 = '00000000-0000-0000-0000-000000000501';
    await mkMember(db, t1, u1, 'a@y.dev');
    await mkMember(db, t2, u2, 'b@y.dev');
    const { subteamId: s1 } = await mkSubteam(db, t1, 'c-1');
    const { subteamId: s2 } = await mkSubteam(db, t2, 'c-2');
    await db.query(`INSERT INTO event_subteam_members (subteam_id, member_id) VALUES ($1, $2)`, [
      s1,
      u1,
    ]);
    await db.query(`INSERT INTO event_subteam_members (subteam_id, member_id) VALUES ($1, $2)`, [
      s2,
      u2,
    ]);
    await setCtx(db, u1, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const n = (
      await db.query<{ subteam_id: string }>(`SELECT subteam_id FROM event_subteam_members`)
    ).rows.length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });

  it('anon sees zero', async () => {
    const t = await mkTenant(db, 'rsm-ccc');
    const u = '00000000-0000-0000-0000-000000000510';
    await mkMember(db, t, u, 'c@y.dev');
    const { subteamId } = await mkSubteam(db, t, 'c-3');
    await db.query(`INSERT INTO event_subteam_members (subteam_id, member_id) VALUES ($1, $2)`, [
      subteamId,
      u,
    ]);
    const n = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ subteam_id: string }>(`SELECT subteam_id FROM event_subteam_members`))
          .rows.length,
    );
    expect(n).toBe(0);
  });

  it('owner can INSERT', async () => {
    const t = await mkTenant(db, 'rsm-ddd');
    const u = '00000000-0000-0000-0000-000000000520';
    await mkMember(db, t, u, 'o@y.dev', 'owner');
    const { subteamId } = await mkSubteam(db, t, 'c-4');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(`INSERT INTO event_subteam_members (subteam_id, member_id) VALUES ($1, $2)`, [
      subteamId,
      u,
    ]);
    await asSuperuser(db);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_subteam_members`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('team_member cannot INSERT', async () => {
    const t = await mkTenant(db, 'rsm-eee');
    const u = '00000000-0000-0000-0000-000000000530';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    const { subteamId } = await mkSubteam(db, t, 'c-5');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try {
      await db.query(`INSERT INTO event_subteam_members (subteam_id, member_id) VALUES ($1, $2)`, [
        subteamId,
        u,
      ]);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });
});
