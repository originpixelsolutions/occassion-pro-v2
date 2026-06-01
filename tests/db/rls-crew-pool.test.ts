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

describe('RLS on crew_pool (Phase 12 Unit 80)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('member sees own tenant crew only', async () => {
    const t1 = await mkTenant(db, 'cp-aaa');
    const t2 = await mkTenant(db, 'cp-bbb');
    await db.query(
      `INSERT INTO crew_pool (tenant_id, full_name, is_freelance, is_active, total_events_worked) VALUES ($1,'Alice', FALSE, TRUE, 0)`,
      [t1],
    );
    await db.query(
      `INSERT INTO crew_pool (tenant_id, full_name, is_freelance, is_active, total_events_worked) VALUES ($1,'Bob', FALSE, TRUE, 0)`,
      [t2],
    );
    const u = '00000000-0000-0000-0000-000000001300';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const names = (
      await db.query<{ full_name: string }>(`SELECT full_name FROM crew_pool`)
    ).rows.map((r) => r.full_name);
    await asSuperuser(db);
    expect(names).toEqual(['Alice']);
  });

  it('anon sees zero', async () => {
    const t = await mkTenant(db, 'cp-ccc');
    await db.query(
      `INSERT INTO crew_pool (tenant_id, full_name, is_freelance, is_active, total_events_worked) VALUES ($1,'Z', FALSE, TRUE, 0)`,
      [t],
    );
    const n = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM crew_pool`)).rows.length,
    );
    expect(n).toBe(0);
  });

  it('owner can INSERT', async () => {
    const t = await mkTenant(db, 'cp-ddd');
    const u = '00000000-0000-0000-0000-000000001310';
    await mkMember(db, t, u, 'o@y.dev', 'owner');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(
      `INSERT INTO crew_pool (tenant_id, full_name, is_freelance, is_active, total_events_worked) VALUES ($1,'New', FALSE, TRUE, 0)`,
      [t],
    );
    await asSuperuser(db);
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM crew_pool`)).rows[0]!.c,
    ).toBe(1);
  });

  it('team_member cannot INSERT', async () => {
    const t = await mkTenant(db, 'cp-eee');
    const u = '00000000-0000-0000-0000-000000001320';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try {
      await db.query(
        `INSERT INTO crew_pool (tenant_id, full_name, is_freelance, is_active, total_events_worked) VALUES ($1,'X', FALSE, TRUE, 0)`,
        [t],
      );
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });
});
