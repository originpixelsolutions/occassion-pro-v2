import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, type TestDb } from '../setup/pg.js';

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

describe('RLS on runsheet_locks (Phase 12 Unit 77)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('holder can INSERT their own lock', async () => {
    const t = await mkTenant(db, 'rlk-aaa');
    const e = await mkEvent(db, t, 'e-a');
    const u = '00000000-0000-0000-0000-000000001000';
    await mkMember(db, t, u, 'h@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(
      `INSERT INTO runsheet_locks (event_id, tenant_id, locked_by) VALUES ($1, $2, $3)`,
      [e, t, u],
    );
    await asSuperuser(db);
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM runsheet_locks`)).rows[0]!.c,
    ).toBe(1);
  });

  it('member cannot INSERT a lock in someone else name', async () => {
    const t = await mkTenant(db, 'rlk-bbb');
    const e = await mkEvent(db, t, 'e-b');
    const me = '00000000-0000-0000-0000-000000001010';
    const other = '00000000-0000-0000-0000-000000001011';
    await mkMember(db, t, me, 'me@y.dev', 'team_member');
    await mkMember(db, t, other, 'ot@y.dev', 'team_member');
    await setCtx(db, me, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try {
      await db.query(
        `INSERT INTO runsheet_locks (event_id, tenant_id, locked_by) VALUES ($1, $2, $3)`,
        [e, t, other],
      );
    } catch (e2) {
      err = e2 instanceof Error ? e2.message : String(e2);
    }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });

  it('non-holder cannot UPDATE the lock', async () => {
    const t = await mkTenant(db, 'rlk-ccc');
    const e = await mkEvent(db, t, 'e-c');
    const holder = '00000000-0000-0000-0000-000000001020';
    const intruder = '00000000-0000-0000-0000-000000001021';
    await mkMember(db, t, holder, 'h@y.dev', 'team_member');
    await mkMember(db, t, intruder, 'i@y.dev', 'team_member');
    await db.query(
      `INSERT INTO runsheet_locks (event_id, tenant_id, locked_by) VALUES ($1, $2, $3)`,
      [e, t, holder],
    );
    await setCtx(db, intruder, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE runsheet_locks SET expires_at=now() WHERE event_id=$1 RETURNING event_id) SELECT count(*)::int AS c FROM u`,
      [e],
    );
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });

  it('manager can force-release someone else lock', async () => {
    const t = await mkTenant(db, 'rlk-ddd');
    const e = await mkEvent(db, t, 'e-d');
    const holder = '00000000-0000-0000-0000-000000001030';
    const mgr = '00000000-0000-0000-0000-000000001031';
    await mkMember(db, t, holder, 'h@y.dev', 'team_member');
    await mkMember(db, t, mgr, 'm@y.dev', 'event_manager');
    await db.query(
      `INSERT INTO runsheet_locks (event_id, tenant_id, locked_by) VALUES ($1, $2, $3)`,
      [e, t, holder],
    );
    await setCtx(db, mgr, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH d AS (DELETE FROM runsheet_locks WHERE event_id=$1 RETURNING event_id) SELECT count(*)::int AS c FROM d`,
      [e],
    );
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });
});
