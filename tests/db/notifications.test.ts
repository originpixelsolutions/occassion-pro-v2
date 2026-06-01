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

describe('notifications — schema correctness (Phase 8 Unit 52)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid notification', async () => {
    const t = await mkTenant(db, 'n-aaa');
    await db.query(
      `INSERT INTO notifications (tenant_id, recipient_type, recipient_id, category, title, body, action_url)
       VALUES ($1,'tenant_member', gen_random_uuid(), 'event.updated','Event updated','Wedding details changed','https://app.x/e/1')`,
      [t],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM notifications`)).rows[0]!.c,
    ).toBe(1);
  });

  it('rejects bad recipient_type', async () => {
    const t = await mkTenant(db, 'n-bbb');
    const err = await tryExec(
      db,
      `INSERT INTO notifications (tenant_id, recipient_type, recipient_id, category, title, body)
       VALUES ($1,'admin', gen_random_uuid(),'x','t','b')`,
      [t],
    );
    expect(err).toMatch(/recipient_enum|check/i);
  });

  it('rejects bad priority', async () => {
    const t = await mkTenant(db, 'n-ccc');
    const err = await tryExec(
      db,
      `INSERT INTO notifications (tenant_id, recipient_type, recipient_id, category, title, body, priority)
       VALUES ($1,'client', gen_random_uuid(),'x','t','b','ultra')`,
      [t],
    );
    expect(err).toMatch(/priority_enum|check/i);
  });

  it('read coupling: is_read=TRUE without read_at rejected', async () => {
    const t = await mkTenant(db, 'n-ddd');
    const err = await tryExec(
      db,
      `INSERT INTO notifications (tenant_id, recipient_type, recipient_id, category, title, body, is_read)
       VALUES ($1,'client', gen_random_uuid(),'x','t','b', TRUE)`,
      [t],
    );
    expect(err).toMatch(/read_coupling|check/i);
  });

  it('read coupling: read_at without is_read=TRUE rejected', async () => {
    const t = await mkTenant(db, 'n-eee');
    const err = await tryExec(
      db,
      `INSERT INTO notifications (tenant_id, recipient_type, recipient_id, category, title, body, read_at)
       VALUES ($1,'client', gen_random_uuid(),'x','t','b', now())`,
      [t],
    );
    expect(err).toMatch(/read_coupling|check/i);
  });

  it('tenant_id required for non-super_admin', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO notifications (recipient_type, recipient_id, category, title, body)
       VALUES ('client', gen_random_uuid(),'x','t','b')`,
    );
    expect(err).toMatch(/tenant_or_super|check/i);
  });

  it('super_admin without tenant_id accepted', async () => {
    await db.query(
      `INSERT INTO notifications (recipient_type, recipient_id, category, title, body)
       VALUES ('super_admin', gen_random_uuid(),'platform.alert','SLA breach','queue 12% above threshold')`,
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM notifications WHERE recipient_type='super_admin'`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('rejects non-http(s) action_url', async () => {
    const t = await mkTenant(db, 'n-fff');
    const err = await tryExec(
      db,
      `INSERT INTO notifications (tenant_id, recipient_type, recipient_id, category, title, body, action_url)
       VALUES ($1,'client', gen_random_uuid(),'x','t','b','ftp://x/y')`,
      [t],
    );
    expect(err).toMatch(/action_url|check/i);
  });

  it('rejects array data', async () => {
    const t = await mkTenant(db, 'n-ggg');
    const err = await tryExec(
      db,
      `INSERT INTO notifications (tenant_id, recipient_type, recipient_id, category, title, body, data)
       VALUES ($1,'client', gen_random_uuid(),'x','t','b','[]'::jsonb)`,
      [t],
    );
    expect(err).toMatch(/data|check/i);
  });

  it('expires_at default ~30 days', async () => {
    const t = await mkTenant(db, 'n-hhh');
    await db.query(
      `INSERT INTO notifications (tenant_id, recipient_type, recipient_id, category, title, body)
       VALUES ($1,'client', gen_random_uuid(),'x','t','b')`,
      [t],
    );
    const r = await db.query<{ days: number }>(
      `SELECT EXTRACT(EPOCH FROM (expires_at - created_at))/86400 AS days FROM notifications`,
    );
    expect(Number(r.rows[0]!.days)).toBeGreaterThanOrEqual(29);
    expect(Number(r.rows[0]!.days)).toBeLessThanOrEqual(31);
  });

  it('mark-as-read happy path', async () => {
    const t = await mkTenant(db, 'n-iii');
    await db.query(
      `INSERT INTO notifications (tenant_id, recipient_type, recipient_id, category, title, body, is_read, read_at)
       VALUES ($1,'client', gen_random_uuid(),'x','t','b', TRUE, now())`,
      [t],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM notifications WHERE is_read=TRUE`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'n-www');
    await db.query(
      `INSERT INTO notifications (tenant_id, recipient_type, recipient_id, category, title, body)
       VALUES ($1,'client', gen_random_uuid(),'x','t','b')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM notifications`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM notifications`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
