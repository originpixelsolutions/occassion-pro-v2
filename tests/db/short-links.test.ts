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
async function mkEvent(db: TestDb, tenant: string, code = 'evt-001'): Promise<string> {
  const ty = (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'W', FALSE) RETURNING id`,
      [tenant],
    )
  ).rows[0]!.id;
  return (
    await db.query<{ id: string }>(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`,
      [tenant, ty, code],
    )
  ).rows[0]!.id;
}
async function mkGuest(db: TestDb, tenant: string, event: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO guests (tenant_id, event_id, name) VALUES ($1,$2,'G') RETURNING id`,
      [tenant, event],
    )
  ).rows[0]!.id;
}

describe('short_links — schema correctness (Phase 3 Unit 24)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid event-wide rsvp link', async () => {
    const t = await mkTenant(db, 'sl-aaa');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO short_links (code, destination_url, tenant_id, event_id, link_type)
       VALUES ('aB3xY9', 'https://op.in/r/abc', $1, $2, 'rsvp')`,
      [t, e],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM short_links`)).rows[0]!.c,
    ).toBe(1);
  });

  it('UNIQUE code blocks duplicate', async () => {
    const t = await mkTenant(db, 'sl-bbb');
    await db.query(
      `INSERT INTO short_links (code, destination_url, tenant_id, link_type) VALUES ('aB3xY9','https://x.dev','` +
        t +
        `'::uuid,'generic')`,
    );
    const err = await tryExec(
      db,
      `INSERT INTO short_links (code, destination_url, tenant_id, link_type) VALUES ($1,$2,$3,'generic')`,
      ['aB3xY9', 'https://y.dev', t],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('rejects bad code (too short)', async () => {
    const t = await mkTenant(db, 'sl-ccc');
    const err = await tryExec(
      db,
      `INSERT INTO short_links (code, destination_url, tenant_id, link_type) VALUES ('ab', 'https://x.dev', $1, 'generic')`,
      [t],
    );
    expect(err).toMatch(/code|check/i);
  });

  it('rejects bad custom_alias (uppercase)', async () => {
    const t = await mkTenant(db, 'sl-ddd');
    const err = await tryExec(
      db,
      `INSERT INTO short_links (code, custom_alias, destination_url, tenant_id, link_type)
       VALUES ('aB3xY9','UPPER-CASE','https://x.dev', $1, 'generic')`,
      [t],
    );
    expect(err).toMatch(/custom_alias|check/i);
  });

  it('rejects bad link_type', async () => {
    const t = await mkTenant(db, 'sl-eee');
    const err = await tryExec(
      db,
      `INSERT INTO short_links (code, destination_url, tenant_id, link_type) VALUES ('aB3xY9','https://x.dev', $1, 'magnetic')`,
      [t],
    );
    expect(err).toMatch(/link_type|check/i);
  });

  it('rejects non-http(s) destination_url', async () => {
    const t = await mkTenant(db, 'sl-fff');
    const err = await tryExec(
      db,
      `INSERT INTO short_links (code, destination_url, tenant_id, link_type) VALUES ('aB3xY9','ftp://x.dev/file', $1, 'asset')`,
      [t],
    );
    expect(err).toMatch(/destination_url|check/i);
  });

  it('rejects expires_at in the past', async () => {
    const t = await mkTenant(db, 'sl-ggg');
    const err = await tryExec(
      db,
      `INSERT INTO short_links (code, destination_url, tenant_id, link_type, expires_at)
       VALUES ('aB3xY9','https://x.dev', $1, 'rsvp', now() - interval '1 day')`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('rejects negative click_count', async () => {
    const t = await mkTenant(db, 'sl-hhh');
    const err = await tryExec(
      db,
      `INSERT INTO short_links (code, destination_url, tenant_id, link_type, click_count)
       VALUES ('aB3xY9','https://x.dev', $1, 'rsvp', -1)`,
      [t],
    );
    expect(err).toMatch(/click|check/i);
  });

  it('per-guest link: guest belongs to wrong event rejected', async () => {
    const t = await mkTenant(db, 'sl-iii');
    const e1 = await mkEvent(db, t, 'evt-aaa');
    const e2 = await mkEvent(db, t, 'evt-bbb');
    const gOnE2 = await mkGuest(db, t, e2);
    const err = await tryExec(
      db,
      `INSERT INTO short_links (code, destination_url, tenant_id, event_id, guest_id, link_type)
       VALUES ('aB3xY9','https://x.dev', $1, $2, $3, 'invitation')`,
      [t, e1, gOnE2],
    );
    expect(err).toMatch(/belongs to event/i);
  });

  it('cross-tenant guest rejected', async () => {
    const t1 = await mkTenant(db, 'sl-ttt');
    const t2 = await mkTenant(db, 'sl-uuu');
    const e2 = await mkEvent(db, t2);
    const gOther = await mkGuest(db, t2, e2);
    const err = await tryExec(
      db,
      `INSERT INTO short_links (code, destination_url, tenant_id, guest_id, link_type)
       VALUES ('aB3xY9','https://x.dev', $1, $2, 'invitation')`,
      [t1, gOther],
    );
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('cross-tenant event rejected', async () => {
    const t1 = await mkTenant(db, 'sl-vvv');
    const t2 = await mkTenant(db, 'sl-www');
    const e2 = await mkEvent(db, t2);
    const err = await tryExec(
      db,
      `INSERT INTO short_links (code, destination_url, tenant_id, event_id, link_type)
       VALUES ('aB3xY9','https://x.dev', $1, $2, 'rsvp')`,
      [t1, e2],
    );
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'sl-xxx');
    await db.query(
      `INSERT INTO short_links (code, destination_url, tenant_id, link_type) VALUES ('aB3xY9','https://x.dev', $1, 'generic')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM short_links`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM short_links`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
