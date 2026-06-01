import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenant: string, code='evt-001'): Promise<string> {
  const ty = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'W', FALSE) RETURNING id`, [tenant])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`, [tenant, ty, code])).rows[0]!.id;
}

describe('storage_objects — schema correctness (Phase 7 Unit 48)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid object', async () => {
    const t = await mkTenant(db, 'so-aaa');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO storage_objects (tenant_id, event_id, category, r2_key, filename, mime_type, size_bytes, uploaded_by_type)
       VALUES ($1,$2,'event_photo','tenants/abc/event_photo/uuid.jpg','wedding.jpg','image/jpeg', 524288, 'tenant_member')`, [t, e]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM storage_objects`)).rows[0]!.c).toBe(1);
  });

  it('UNIQUE r2_key blocks dupe', async () => {
    const t = await mkTenant(db, 'so-bbb');
    await db.query(
      `INSERT INTO storage_objects (tenant_id, category, r2_key, filename, mime_type, size_bytes)
       VALUES ($1,'document','tenants/abc/doc/u1.pdf','x.pdf','application/pdf', 100)`, [t]);
    const err = await tryExec(db,
      `INSERT INTO storage_objects (tenant_id, category, r2_key, filename, mime_type, size_bytes)
       VALUES ($1,'document','tenants/abc/doc/u1.pdf','y.pdf','application/pdf', 200)`, [t]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('rejects bad category', async () => {
    const t = await mkTenant(db, 'so-ccc');
    const err = await tryExec(db,
      `INSERT INTO storage_objects (tenant_id, category, r2_key, filename, mime_type, size_bytes)
       VALUES ($1,'malware','tenants/abc/x','x','image/jpeg', 100)`, [t]);
    expect(err).toMatch(/category|check/i);
  });

  it('rejects r2_key with spaces', async () => {
    const t = await mkTenant(db, 'so-ddd');
    const err = await tryExec(db,
      `INSERT INTO storage_objects (tenant_id, category, r2_key, filename, mime_type, size_bytes)
       VALUES ($1,'document','tenants/has space/x.pdf','x.pdf','application/pdf', 100)`, [t]);
    expect(err).toMatch(/r2_key|check/i);
  });

  it('rejects bad mime_type', async () => {
    const t = await mkTenant(db, 'so-eee');
    const err = await tryExec(db,
      `INSERT INTO storage_objects (tenant_id, category, r2_key, filename, mime_type, size_bytes)
       VALUES ($1,'document','tenants/abc/x.pdf','x.pdf','not-a-mime', 100)`, [t]);
    expect(err).toMatch(/mime_type|check/i);
  });

  it('rejects size_bytes > 10 GiB', async () => {
    const t = await mkTenant(db, 'so-fff');
    const err = await tryExec(db,
      `INSERT INTO storage_objects (tenant_id, category, r2_key, filename, mime_type, size_bytes)
       VALUES ($1,'event_video','tenants/abc/v.mp4','v.mp4','video/mp4', 21474836480)`, [t]);
    expect(err).toMatch(/size_positive|check/i);
  });

  it('archive coupling: archived_at without destination rejected', async () => {
    const t = await mkTenant(db, 'so-ggg');
    const err = await tryExec(db,
      `INSERT INTO storage_objects (tenant_id, category, r2_key, filename, mime_type, size_bytes, archived_at)
       VALUES ($1,'document','tenants/abc/x.pdf','x.pdf','application/pdf', 100, now())`, [t]);
    expect(err).toMatch(/archive_coupling|check/i);
  });

  it('archive coupling: full archive accepted', async () => {
    const t = await mkTenant(db, 'so-hhh');
    await db.query(
      `INSERT INTO storage_objects (tenant_id, category, r2_key, filename, mime_type, size_bytes, archived_at, archive_destination, archive_expires_at, storage_class)
       VALUES ($1,'event_photo','tenants/abc/p.jpg','p.jpg','image/jpeg', 100, now(), 's3_glacier', now()+interval '90 days', 'archive')`, [t]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM storage_objects WHERE archived_at IS NOT NULL`)).rows[0]!.c).toBe(1);
  });

  it('restored_at without archive rejected', async () => {
    const t = await mkTenant(db, 'so-iii');
    const err = await tryExec(db,
      `INSERT INTO storage_objects (tenant_id, category, r2_key, filename, mime_type, size_bytes, restored_at)
       VALUES ($1,'document','tenants/abc/x.pdf','x.pdf','application/pdf', 100, now())`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('rejects bad sha256 hash', async () => {
    const t = await mkTenant(db, 'so-jjj');
    const err = await tryExec(db,
      `INSERT INTO storage_objects (tenant_id, category, r2_key, filename, mime_type, size_bytes, content_hash_sha256)
       VALUES ($1,'document','tenants/abc/x.pdf','x.pdf','application/pdf', 100, 'NOT-A-HASH')`, [t]);
    expect(err).toMatch(/content_hash|check/i);
  });

  it('cross-tenant event rejected', async () => {
    const t1 = await mkTenant(db, 'so-ttt');
    const t2 = await mkTenant(db, 'so-uuu');
    const e2 = await mkEvent(db, t2);
    const err = await tryExec(db,
      `INSERT INTO storage_objects (tenant_id, event_id, category, r2_key, filename, mime_type, size_bytes)
       VALUES ($1,$2,'document','tenants/abc/x.pdf','x.pdf','application/pdf', 100)`, [t1, e2]);
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'so-www');
    await db.query(
      `INSERT INTO storage_objects (tenant_id, category, r2_key, filename, mime_type, size_bytes)
       VALUES ($1,'document','tenants/abc/x.pdf','x.pdf','application/pdf', 100)`, [t]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM storage_objects`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM storage_objects`)).rows.length);
    expect(svc).toBe(1);
  });
});
