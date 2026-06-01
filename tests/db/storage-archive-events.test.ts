import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params);
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`,
      [slug],
    )
  ).rows[0]!.id;
}
async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1,$2,'M','event_manager') RETURNING id`,
      [tenant, email],
    )
  ).rows[0]!.id;
}

describe('storage_archive_events — schema correctness (Phase 7 Unit 49)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid completed archive', async () => {
    const t = await mkTenant(db, 'sae-aaa');
    await db.query(
      `INSERT INTO storage_archive_events (tenant_id, archive_destination, bytes_archived, file_count, restore_window_ends_at)
       VALUES ($1,'s3_glacier', 1073741824, 250, now() + interval '90 days')`,
      [t],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM storage_archive_events`))
        .rows[0]!.c,
    ).toBe(1);
  });

  it('bytes_archived > 0 enforced', async () => {
    const t = await mkTenant(db, 'sae-bbb');
    const err = await tryExec(
      db,
      `INSERT INTO storage_archive_events (tenant_id, archive_destination, bytes_archived, file_count, restore_window_ends_at)
       VALUES ($1,'s3_glacier', 0, 5, now() + interval '90 days')`,
      [t],
    );
    expect(err).toMatch(/bytes_positive|check/i);
  });

  it('file_count > 0 enforced', async () => {
    const t = await mkTenant(db, 'sae-ccc');
    const err = await tryExec(
      db,
      `INSERT INTO storage_archive_events (tenant_id, archive_destination, bytes_archived, file_count, restore_window_ends_at)
       VALUES ($1,'s3_glacier', 100, 0, now() + interval '90 days')`,
      [t],
    );
    expect(err).toMatch(/file_positive|check/i);
  });

  it('restore_window must be after archived_at', async () => {
    const t = await mkTenant(db, 'sae-ddd');
    const err = await tryExec(
      db,
      `INSERT INTO storage_archive_events (tenant_id, archive_destination, bytes_archived, file_count, archived_at, restore_window_ends_at)
       VALUES ($1,'s3_glacier', 100, 5, now(), now() - interval '1 hour')`,
      [t],
    );
    expect(err).toMatch(/window_after_archive|check/i);
  });

  it('rejects bad archive_type', async () => {
    const t = await mkTenant(db, 'sae-eee');
    const err = await tryExec(
      db,
      `INSERT INTO storage_archive_events (tenant_id, archive_type, archive_destination, bytes_archived, file_count, restore_window_ends_at)
       VALUES ($1,'cosmic_ray','s3_glacier', 100, 5, now() + interval '90 days')`,
      [t],
    );
    expect(err).toMatch(/type_enum|check/i);
  });

  it('restored requires all three fields', async () => {
    const t = await mkTenant(db, 'sae-fff');
    const err = await tryExec(
      db,
      `INSERT INTO storage_archive_events (tenant_id, archive_destination, bytes_archived, file_count, restore_window_ends_at, status, restore_requested_at, restored_at)
       VALUES ($1,'s3_glacier', 100, 5, now() + interval '90 days','restored', now(), now())`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('restored_bytes > bytes_archived rejected', async () => {
    const t = await mkTenant(db, 'sae-ggg');
    const err = await tryExec(
      db,
      `INSERT INTO storage_archive_events (tenant_id, archive_destination, bytes_archived, file_count, restore_window_ends_at, restored_bytes)
       VALUES ($1,'s3_glacier', 100, 5, now() + interval '90 days', 200)`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('restored happy path', async () => {
    const t = await mkTenant(db, 'sae-hhh');
    const m = await mkMember(db, t, 'r@y.dev');
    await db.query(
      `INSERT INTO storage_archive_events (tenant_id, archive_destination, bytes_archived, file_count, restore_window_ends_at, status, restore_requested_at, restore_requested_by, restored_at, restored_bytes, restored_file_count)
       VALUES ($1,'s3_glacier', 1000, 10, now() + interval '90 days','restored', now() - interval '1 hour', $2, now(), 1000, 10)`,
      [t, m],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM storage_archive_events WHERE status='restored'`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('failed requires failure_reason', async () => {
    const t = await mkTenant(db, 'sae-iii');
    const err = await tryExec(
      db,
      `INSERT INTO storage_archive_events (tenant_id, archive_destination, bytes_archived, file_count, restore_window_ends_at, status, failed_at)
       VALUES ($1,'s3_glacier', 100, 5, now() + interval '90 days','failed', now())`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('cross-tenant initiator rejected', async () => {
    const t1 = await mkTenant(db, 'sae-ttt');
    const t2 = await mkTenant(db, 'sae-uuu');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO storage_archive_events (tenant_id, archive_destination, bytes_archived, file_count, restore_window_ends_at, initiated_by)
       VALUES ($1,'s3_glacier', 100, 5, now() + interval '90 days', $2)`,
      [t1, mOther],
    );
    expect(err).toMatch(/initiated_by|tenant/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'sae-www');
    await db.query(
      `INSERT INTO storage_archive_events (tenant_id, archive_destination, bytes_archived, file_count, restore_window_ends_at)
       VALUES ($1,'s3_glacier', 100, 5, now() + interval '90 days')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM storage_archive_events`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM storage_archive_events`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
