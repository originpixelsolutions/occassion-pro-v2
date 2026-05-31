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

async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role)
     VALUES ($1, $2, 'M', 'owner') RETURNING id`,
    [tenant, email],
  );
  return r.rows[0]!.id;
}

const HASH64 = 'a'.repeat(64);

describe('tenant_api_keys — schema correctness (Phase 2 Unit 7)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid API key', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes)
       VALUES ($1, 'CI key', 'op_live_abc12345', $2, ARRAY['events:read'])`,
      [t, HASH64],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_api_keys`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('default expires_at is ~365 days out', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes)
       VALUES ($1, 'k', 'op_live_abc12345', $2, ARRAY['x'])`,
      [t, HASH64],
    );
    const r = await db.query<{ days: number }>(
      `SELECT EXTRACT(EPOCH FROM (expires_at - created_at)) / 86400 AS days FROM tenant_api_keys`,
    );
    expect(Math.round(r.rows[0]!.days)).toBe(365);
  });

  it('rejects malformed key_prefix', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes)
       VALUES ($1, 'k', 'bad_prefix', $2, ARRAY['x'])`,
      [t, HASH64],
    );
    expect(err).toMatch(/prefix|check/i);
  });

  it('rejects key_hash of wrong length', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes)
       VALUES ($1, 'k', 'op_live_abc12345', 'short', ARRAY['x'])`,
      [t],
    );
    expect(err).toMatch(/hash|check/i);
  });

  it('rejects empty scopes', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes)
       VALUES ($1, 'k', 'op_live_abc12345', $2, ARRAY[]::text[])`,
      [t, HASH64],
    );
    expect(err).toMatch(/scopes|check/i);
  });

  it('rejects expires_at in the past', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes, expires_at)
       VALUES ($1, 'k', 'op_live_abc12345', $2, ARRAY['x'], now() - interval '1 day')`,
      [t, HASH64],
    );
    expect(err).toMatch(/check/i);
  });

  it('UNIQUE on key_hash blocks duplicates across tenants', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    await db.query(
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes)
       VALUES ($1, 'k1', 'op_live_abc12345', $2, ARRAY['x'])`,
      [t1, HASH64],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes)
       VALUES ($1, 'k2', 'op_live_xyz98765', $2, ARRAY['x'])`,
      [t2, HASH64],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('CASCADE: deleting tenant removes its keys', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes)
       VALUES ($1, 'k', 'op_live_abc12345', $2, ARRAY['x'])`,
      [t, HASH64],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_api_keys`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('SET NULL: deleting created_by member nulls the FK', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes, created_by)
       VALUES ($1, 'k', 'op_live_abc12345', $2, ARRAY['x'], $3)`,
      [t, HASH64, m],
    );
    await db.query(`DELETE FROM tenant_members WHERE id = $1`, [m]);
    const r = await db.query<{ created_by: string | null }>(
      `SELECT created_by FROM tenant_api_keys WHERE tenant_id = $1`,
      [t],
    );
    expect(r.rows[0]!.created_by).toBeNull();
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes)
       VALUES ($1, 'k', 'op_live_abc12345', $2, ARRAY['x'])`,
      [t, HASH64],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM tenant_api_keys`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM tenant_api_keys`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
