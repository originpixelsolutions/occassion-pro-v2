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
async function mkEvent(db: TestDb, tenantId: string, code: string): Promise<string> {
  const etId = (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'w-' || $2, 'W', FALSE) RETURNING id`,
      [tenantId, code],
    )
  ).rows[0]!.id;
  return (
    await db.query<{ id: string }>(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, $3, 'E', '2026-12-01', '2026-12-03', 'INR') RETURNING id`,
      [tenantId, etId, code],
    )
  ).rows[0]!.id;
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

describe('RLS on runsheet_versions (Phase 12 Unit 78)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('member can INSERT own snapshot', async () => {
    const t = await mkTenant(db, 'rv-aaa');
    const e = await mkEvent(db, t, 'e-a');
    const u = '00000000-0000-0000-0000-000000001100';
    await mkMember(db, t, u, 'm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(
      `INSERT INTO runsheet_versions (tenant_id, event_id, is_full, snapshot, task_count, created_by)
       VALUES ($1, $2, TRUE, '{}'::jsonb, 0, $3)`,
      [t, e, u],
    );
    await asSuperuser(db);
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM runsheet_versions`)).rows[0]!
        .c,
    ).toBe(1);
  });

  it('member cannot INSERT with someone-else attribution', async () => {
    const t = await mkTenant(db, 'rv-bbb');
    const e = await mkEvent(db, t, 'e-b');
    const me = '00000000-0000-0000-0000-000000001110';
    const other = '00000000-0000-0000-0000-000000001111';
    await mkMember(db, t, me, 'me@y.dev', 'team_member');
    await mkMember(db, t, other, 'ot@y.dev', 'team_member');
    await setCtx(db, me, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try {
      await db.query(
        `INSERT INTO runsheet_versions (tenant_id, event_id, is_full, snapshot, task_count, created_by)
       VALUES ($1, $2, TRUE, '{}'::jsonb, 0, $3)`,
        [t, e, other],
      );
    } catch (e2) {
      err = e2 instanceof Error ? e2.message : String(e2);
    }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });

  it('anon sees zero', async () => {
    const t = await mkTenant(db, 'rv-ccc');
    const e = await mkEvent(db, t, 'e-c');
    await db.query(
      `INSERT INTO runsheet_versions (tenant_id, event_id, is_full, snapshot, task_count) VALUES ($1, $2, TRUE, '{}'::jsonb, 0)`,
      [t, e],
    );
    const n = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM runsheet_versions`)).rows.length,
    );
    expect(n).toBe(0);
  });

  it('team_member cannot DELETE', async () => {
    const t = await mkTenant(db, 'rv-ddd');
    const e = await mkEvent(db, t, 'e-d');
    const u = '00000000-0000-0000-0000-000000001120';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO runsheet_versions (tenant_id, event_id, is_full, snapshot, task_count) VALUES ($1, $2, TRUE, '{}'::jsonb, 0) RETURNING id`,
        [t, e],
      )
    ).rows[0]!.id;
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH d AS (DELETE FROM runsheet_versions WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM d`,
      [id],
    );
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });
});
