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

const MAPPING = `'{"name":"A","email":"B"}'::jsonb`;
const EVENT = '11111111-1111-1111-1111-111111111111';
const EVENT2 = '22222222-2222-2222-2222-222222222222';

describe('tenant_sheets_syncs — schema correctness (Phase 2 Unit 19)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid sync', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping)
       VALUES ($1, $2, 'guests', 'sheet_abc', 'Guests', '\\x00aa'::bytea, ${MAPPING})`,
      [t, EVENT],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_sheets_syncs`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bogus resource', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping)
       VALUES ($1, $2, 'tasks', 'sheet_abc', 'Tasks', '\\x00aa'::bytea, ${MAPPING})`,
      [t, EVENT],
    );
    expect(err).toMatch(/resource|check/i);
  });

  it('rejects bogus sync_direction', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping, sync_direction)
       VALUES ($1, $2, 'guests', 'sheet_abc', 'Guests', '\\x00aa'::bytea, ${MAPPING}, 'oblique')`,
      [t, EVENT],
    );
    expect(err).toMatch(/sync_direction|check/i);
  });

  it('rejects empty access_token', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping)
       VALUES ($1, $2, 'guests', 'sheet_abc', 'Guests', ''::bytea, ${MAPPING})`,
      [t, EVENT],
    );
    expect(err).toMatch(/token_non_empty|check/i);
  });

  it('rejects non-object column_mapping', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping)
       VALUES ($1, $2, 'guests', 'sheet_abc', 'Guests', '\\x00aa'::bytea, '5'::jsonb)`,
      [t, EVENT],
    );
    expect(err).toMatch(/mapping_object|check/i);
  });

  it('rejects non-Google-Sheets URL', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping, sheet_url)
       VALUES ($1, $2, 'guests', 'sheet_abc', 'Guests', '\\x00aa'::bytea, ${MAPPING}, 'https://example.com/x')`,
      [t, EVENT],
    );
    expect(err).toMatch(/sheet_url|check/i);
  });

  it("rejects status 'error' without last_error", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping, status)
       VALUES ($1, $2, 'guests', 'sheet_abc', 'Guests', '\\x00aa'::bytea, ${MAPPING}, 'error')`,
      [t, EVENT],
    );
    expect(err).toMatch(/last_error|check/i);
  });

  it("rejects status 'expired' without token_expires_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping, status)
       VALUES ($1, $2, 'guests', 'sheet_abc', 'Guests', '\\x00aa'::bytea, ${MAPPING}, 'expired')`,
      [t, EVENT],
    );
    expect(err).toMatch(/expired|check/i);
  });

  it('partial UNIQUE: blocks two active/error syncs of same (event, resource)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping)
       VALUES ($1, $2, 'guests', 'sheet_a', 'Guests', '\\x00aa'::bytea, ${MAPPING})`,
      [t, EVENT],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping)
       VALUES ($1, $2, 'guests', 'sheet_b', 'Guests2', '\\x00bb'::bytea, ${MAPPING})`,
      [t, EVENT],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('different events allow same resource', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping)
       VALUES ($1, $2, 'guests', 'sheet_a', 'Guests', '\\x00aa'::bytea, ${MAPPING}),
              ($1, $3, 'guests', 'sheet_b', 'Guests', '\\x00bb'::bytea, ${MAPPING})`,
      [t, EVENT, EVENT2],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_sheets_syncs`))
      .rows[0]!.c;
    expect(c).toBe(2);
  });

  it('disconnected sync does not block a new active one on same (event, resource)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping, status)
       VALUES ($1, $2, 'guests', 'sheet_a', 'Guests', '\\x00aa'::bytea, ${MAPPING}, 'disconnected')`,
      [t, EVENT],
    );
    await db.query(
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping)
       VALUES ($1, $2, 'guests', 'sheet_b', 'Guests', '\\x00bb'::bytea, ${MAPPING})`,
      [t, EVENT],
    );
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM tenant_sheets_syncs WHERE event_id = $1`,
        [EVENT],
      )
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting tenant removes its syncs', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping)
       VALUES ($1, $2, 'guests', 'sheet_a', 'Guests', '\\x00aa'::bytea, ${MAPPING})`,
      [t, EVENT],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_sheets_syncs`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_sheets_syncs (tenant_id, event_id, resource, sheet_id, sheet_tab_name, access_token_encrypted, column_mapping)
       VALUES ($1, $2, 'guests', 'sheet_a', 'Guests', '\\x00aa'::bytea, ${MAPPING})`,
      [t, EVENT],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_sheets_syncs`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_sheets_syncs`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
