import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function mkSuperAdmin(db: TestDb, email: string, role = 'owner'): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO super_admins (email, role, full_name) VALUES ($1, $2, 'SA') RETURNING id`,
      [email, role],
    )
  ).rows[0]!.id;
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
}

describe('RLS on super_admins (Phase 12 Unit 69)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('anon sees zero super_admins', async () => {
    await mkSuperAdmin(db, 'a@y.dev');
    const n = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM super_admins`)).rows.length,
    );
    expect(n).toBe(0);
  });

  it('tenant_member sees zero super_admins (no policy match)', async () => {
    await mkSuperAdmin(db, 'a@y.dev');
    await setCtx(db, '00000000-0000-0000-0000-000000000200', 'tenant_member');
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM super_admins`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(0);
  });

  it('super_admin sees the whole roster', async () => {
    const sa1 = await mkSuperAdmin(db, 'a@y.dev', 'owner');
    await mkSuperAdmin(db, 'b@y.dev', 'support');
    await setCtx(db, sa1, 'super_admin');
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM super_admins`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(2);
  });

  it('owner can INSERT another super_admin', async () => {
    const owner = await mkSuperAdmin(db, 'o@y.dev', 'owner');
    await setCtx(db, owner, 'super_admin');
    await asRole(db, 'authenticated');
    await db.query(
      `INSERT INTO super_admins (email, role, full_name) VALUES ('new@y.dev','support','New')`,
    );
    await asSuperuser(db);
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM super_admins WHERE email='new@y.dev'`,
      )
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('non-owner/admin cannot INSERT a super_admin', async () => {
    const sup = await mkSuperAdmin(db, 's@y.dev', 'support');
    await setCtx(db, sup, 'super_admin');
    await asRole(db, 'authenticated');
    let err = '';
    try {
      await db.query(
        `INSERT INTO super_admins (email, role, full_name) VALUES ('x@y.dev','support','X')`,
      );
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });

  it('super_admin can UPDATE own row (self-edit)', async () => {
    const sup = await mkSuperAdmin(db, 's@y.dev', 'support');
    await setCtx(db, sup, 'super_admin');
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE super_admins SET full_name='Updated' WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`,
      [sup],
    );
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });

  it('non-owner cannot UPDATE someone else', async () => {
    const sup = await mkSuperAdmin(db, 's@y.dev', 'support');
    const target = await mkSuperAdmin(db, 't@y.dev', 'support');
    await setCtx(db, sup, 'super_admin');
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE super_admins SET full_name='Hacked' WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`,
      [target],
    );
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });

  it('owner CAN DELETE another super_admin', async () => {
    const owner = await mkSuperAdmin(db, 'o@y.dev', 'owner');
    const target = await mkSuperAdmin(db, 't@y.dev', 'support');
    await setCtx(db, owner, 'super_admin');
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH d AS (DELETE FROM super_admins WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM d`,
      [target],
    );
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });

  it('admin cannot DELETE a super_admin (owner-only)', async () => {
    const adm = await mkSuperAdmin(db, 'a@y.dev', 'admin');
    const target = await mkSuperAdmin(db, 't@y.dev', 'support');
    await setCtx(db, adm, 'super_admin');
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH d AS (DELETE FROM super_admins WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM d`,
      [target],
    );
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });
});
