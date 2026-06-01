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
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency)
     VALUES ($1, 'Acme', 'INR') RETURNING id`,
    [slug],
  );
  return r.rows[0]!.id;
}

async function mkEvent(db: TestDb, tenant: string): Promise<string> {
  const ty = (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (code, name, is_system) VALUES ('wedding-' || gen_random_uuid()::text, 'Wedding', TRUE) RETURNING id`,
    )
  ).rows[0]!.id;
  const r = await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, 'evt-' || gen_random_uuid()::text, 'X', '2026-12-10', '2026-12-12', 'INR') RETURNING id`,
    [tenant, ty],
  );
  return r.rows[0]!.id;
}

describe('event_websites — schema correctness (Phase 3 Unit 8)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts an unpublished draft', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_websites (event_id, tenant_id, sections)
       VALUES ($1, $2, '{"items": []}'::jsonb)`,
      [e, t],
    );
    const r = await db.query<{ is_published: boolean }>(`SELECT is_published FROM event_websites`);
    expect(r.rows[0]!.is_published).toBe(false);
  });

  it('PK = event_id (one website per event)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_websites (event_id, tenant_id, sections) VALUES ($1, $2, '{}'::jsonb)`,
      [e, t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO event_websites (event_id, tenant_id, sections) VALUES ($1, $2, '{}'::jsonb)`,
      [e, t],
    );
    expect(err).toMatch(/duplicate|primary key|unique/i);
  });

  it('rejects sections array (must be object)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_websites (event_id, tenant_id, sections) VALUES ($1, $2, '[1,2]'::jsonb)`,
      [e, t],
    );
    expect(err).toMatch(/sections|check/i);
  });

  it('rejects published=TRUE without published_at', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_websites (event_id, tenant_id, sections, is_published)
       VALUES ($1, $2, '{}'::jsonb, TRUE)`,
      [e, t],
    );
    expect(err).toMatch(/published_coupling|check/i);
  });

  it('rejects published=FALSE with published_at set', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_websites (event_id, tenant_id, sections, is_published, published_at)
       VALUES ($1, $2, '{}'::jsonb, FALSE, now())`,
      [e, t],
    );
    expect(err).toMatch(/published_coupling|check/i);
  });

  it('rejects uppercase custom_host', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_websites (event_id, tenant_id, sections, custom_host)
       VALUES ($1, $2, '{}'::jsonb, 'Sharma-Wedding.example.com')`,
      [e, t],
    );
    expect(err).toMatch(/custom_host|check/i);
  });

  it('rejects oversize custom_css (> 512 KiB)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_websites (event_id, tenant_id, sections, custom_css)
       VALUES ($1, $2, '{}'::jsonb, $3)`,
      [e, t, 'a'.repeat(524289)],
    );
    expect(err).toMatch(/custom_css|check/i);
  });

  it('partial UNIQUE: same custom_host blocked across LIVE event websites', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e1 = await mkEvent(db, t);
    const e2 = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_websites (event_id, tenant_id, sections, custom_host)
       VALUES ($1, $2, '{}'::jsonb, 'go.example.com')`,
      [e1, t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO event_websites (event_id, tenant_id, sections, custom_host)
       VALUES ($1, $2, '{}'::jsonb, 'go.example.com')`,
      [e2, t],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('soft-deleted website does NOT block reuse of custom_host', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e1 = await mkEvent(db, t);
    const e2 = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_websites (event_id, tenant_id, sections, custom_host, deleted_at, purge_after)
       VALUES ($1, $2, '{}'::jsonb, 'go.example.com', now(), now() + interval '30 days')`,
      [e1, t],
    );
    await db.query(
      `INSERT INTO event_websites (event_id, tenant_id, sections, custom_host)
       VALUES ($1, $2, '{}'::jsonb, 'go.example.com')`,
      [e2, t],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_websites`))
      .rows[0]!.c;
    expect(c).toBe(2);
  });

  it('trigger: rejects cross-tenant attempt', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    const e_t1 = await mkEvent(db, t1);
    const err = await tryExec(
      db,
      `INSERT INTO event_websites (event_id, tenant_id, sections) VALUES ($1, $2, '{}'::jsonb)`,
      [e_t1, t2],
    );
    expect(err).toMatch(/tenant_mismatch|check/i);
  });

  it('CASCADE: deleting event removes its website', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_websites (event_id, tenant_id, sections) VALUES ($1, $2, '{}'::jsonb)`,
      [e, t],
    );
    await db.query(`DELETE FROM events WHERE id = $1`, [e]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_websites`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_websites (event_id, tenant_id, sections) VALUES ($1, $2, '{}'::jsonb)`,
      [e, t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ event_id: string }>(`SELECT event_id FROM event_websites`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ event_id: string }>(`SELECT event_id FROM event_websites`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
