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

describe('RLS on storage_objects (Phase 12 Unit 105a)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('member sees own tenant objects only', async () => {
    const t1 = await mkTenant(db, 'so-aaa');
    const t2 = await mkTenant(db, 'so-bbb');
    await db.query(`INSERT INTO storage_objects (tenant_id, category, r2_key, mime_type, size_bytes, storage_class, filename) VALUES ($1, 'event_photo', 't1/a.jpg', 'image/jpeg', 1024, 'standard', 'file.jpg')`, [t1]);
    await db.query(`INSERT INTO storage_objects (tenant_id, category, r2_key, mime_type, size_bytes, storage_class, filename) VALUES ($1, 'event_photo', 't2/a.jpg', 'image/jpeg', 1024, 'standard', 'file.jpg')`, [t2]);
    const u = '00000000-0000-0000-0000-000000003700';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const keys = (await db.query<{ r2_key: string }>(`SELECT r2_key FROM storage_objects`)).rows.map(r => r.r2_key);
    await asSuperuser(db);
    expect(keys).toEqual(['t1/a.jpg']);
  });

  it('anon sees zero', async () => {
    const t = await mkTenant(db, 'so-ccc');
    await db.query(`INSERT INTO storage_objects (tenant_id, category, r2_key, mime_type, size_bytes, storage_class, filename) VALUES ($1, 'event_photo', 'x/y.jpg', 'image/jpeg', 1024, 'standard', 'file.jpg')`, [t]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM storage_objects`)).rows.length);
    expect(n).toBe(0);
  });

  it('team_member CAN INSERT (broad - upload from any member)', async () => {
    const t = await mkTenant(db, 'so-ddd');
    const u = '00000000-0000-0000-0000-000000003710';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(`INSERT INTO storage_objects (tenant_id, category, r2_key, mime_type, size_bytes, storage_class, filename) VALUES ($1, 'event_photo', 't/new.jpg', 'image/jpeg', 2048, 'standard', 'file.jpg')`, [t]);
    await asSuperuser(db);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM storage_objects`)).rows[0]!.c).toBe(1);
  });

  it('team_member cannot DELETE (manager-gated)', async () => {
    const t = await mkTenant(db, 'so-eee');
    const id = (await db.query<{ id: string }>(
      `INSERT INTO storage_objects (tenant_id, category, r2_key, mime_type, size_bytes, storage_class, filename) VALUES ($1, 'event_photo', 'x/z.jpg', 'image/jpeg', 1024, 'standard', 'file.jpg') RETURNING id`, [t])).rows[0]!.id;
    const u = '00000000-0000-0000-0000-000000003720';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH d AS (DELETE FROM storage_objects WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM d`, [id]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });
});
