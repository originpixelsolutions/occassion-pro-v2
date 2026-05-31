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

// Insert helper using bytea — passes the literal '\\x00aaff' bytea form
function insStorage(
  db: TestDb,
  tenant: string,
  opts: Partial<{
    provider: string;
    isDefault: boolean;
    status: string;
    tokenExpiresAt: string | null;
  }> = {},
): Promise<{ rows: { id: string }[] }> {
  const provider = opts.provider ?? 'r2';
  const isDefault = opts.isDefault ?? false;
  const status = opts.status ?? 'active';
  return db.query<{ id: string }>(
    `INSERT INTO tenant_external_storage
       (tenant_id, provider, access_token_encrypted, is_default, status, token_expires_at)
     VALUES ($1, $2, '\\x00aaff'::bytea, $3, $4, $5) RETURNING id`,
    [tenant, provider, isDefault, status, opts.tokenExpiresAt ?? null],
  );
}

describe('tenant_external_storage — schema correctness (Phase 2 Unit 9)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid storage', async () => {
    const t = await mkTenant(db, 'acme-co');
    await insStorage(db, t);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_external_storage`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects empty access_token_encrypted', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_external_storage (tenant_id, provider, access_token_encrypted)
       VALUES ($1, 'r2', ''::bytea)`,
      [t],
    );
    expect(err).toMatch(/non_empty|token|check/i);
  });

  it('rejects bogus provider', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_external_storage (tenant_id, provider, access_token_encrypted)
       VALUES ($1, 'icloud', '\\x00aaff'::bytea)`,
      [t],
    );
    expect(err).toMatch(/provider|check/i);
  });

  it('rejects bogus status', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_external_storage (tenant_id, provider, access_token_encrypted, status)
       VALUES ($1, 'r2', '\\x00aaff'::bytea, 'paused')`,
      [t],
    );
    expect(err).toMatch(/status|check/i);
  });

  it("rejects 'expired' without token_expires_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_external_storage (tenant_id, provider, access_token_encrypted, status)
       VALUES ($1, 'r2', '\\x00aaff'::bytea, 'expired')`,
      [t],
    );
    expect(err).toMatch(/expired|check/i);
  });

  it('partial unique index: only one active default per tenant', async () => {
    const t = await mkTenant(db, 'acme-co');
    await insStorage(db, t, { isDefault: true });
    const err = await tryExec(
      db,
      `INSERT INTO tenant_external_storage (tenant_id, provider, access_token_encrypted, is_default)
       VALUES ($1, 's3', '\\x00aaff'::bytea, TRUE)`,
      [t],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('partial unique index: a disconnected default does not block a new active default', async () => {
    const t = await mkTenant(db, 'acme-co');
    await insStorage(db, t, { isDefault: true, status: 'disconnected' });
    await insStorage(db, t, { isDefault: true });
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM tenant_external_storage WHERE is_default`,
      )
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('different tenants can each have their own active default', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    await insStorage(db, t1, { isDefault: true });
    await insStorage(db, t2, { isDefault: true });
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM tenant_external_storage WHERE is_default`,
      )
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting tenant removes its storages', async () => {
    const t = await mkTenant(db, 'acme-co');
    await insStorage(db, t);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_external_storage`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await insStorage(db, t);
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_external_storage`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_external_storage`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
