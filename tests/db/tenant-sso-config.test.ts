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

describe('tenant_sso_config — schema correctness (Phase 2 Unit 16)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid config', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_sso_config (tenant_id, provider, config_encrypted, domain_restriction)
       VALUES ($1, 'okta', '\\x00aa'::bytea, ARRAY['acme.co','acme.com'])`,
      [t],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_sso_config`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('PK tenant_id enforces singleton per tenant', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_sso_config (tenant_id, provider, config_encrypted)
       VALUES ($1, 'okta', '\\x00aa'::bytea)`,
      [t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sso_config (tenant_id, provider, config_encrypted)
       VALUES ($1, 'azure_ad', '\\x00bb'::bytea)`,
      [t],
    );
    expect(err).toMatch(/duplicate|primary key|unique/i);
  });

  it('rejects bogus provider', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sso_config (tenant_id, provider, config_encrypted)
       VALUES ($1, 'duo', '\\x00aa'::bytea)`,
      [t],
    );
    expect(err).toMatch(/provider|check/i);
  });

  it('rejects empty config_encrypted', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sso_config (tenant_id, provider, config_encrypted)
       VALUES ($1, 'okta', ''::bytea)`,
      [t],
    );
    expect(err).toMatch(/config_non_empty|check/i);
  });

  it('rejects empty domain_restriction array', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sso_config (tenant_id, provider, config_encrypted, domain_restriction)
       VALUES ($1, 'okta', '\\x00aa'::bytea, ARRAY[]::text[])`,
      [t],
    );
    expect(err).toMatch(/domain|check/i);
  });

  it('trigger: rejects uppercase domain', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sso_config (tenant_id, provider, config_encrypted, domain_restriction)
       VALUES ($1, 'okta', '\\x00aa'::bytea, ARRAY['Acme.co'])`,
      [t],
    );
    expect(err).toMatch(/invalid_domain|check/i);
  });

  it('trigger: rejects malformed domain (no TLD)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sso_config (tenant_id, provider, config_encrypted, domain_restriction)
       VALUES ($1, 'okta', '\\x00aa'::bytea, ARRAY['localhost'])`,
      [t],
    );
    expect(err).toMatch(/invalid_domain|check/i);
  });

  it('rejects bogus default_role', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_sso_config (tenant_id, provider, config_encrypted, default_role)
       VALUES ($1, 'okta', '\\x00aa'::bytea, 'admin')`,
      [t],
    );
    expect(err).toMatch(/default_role|check/i);
  });

  it('CASCADE: deleting tenant removes its SSO config', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_sso_config (tenant_id, provider, config_encrypted)
       VALUES ($1, 'okta', '\\x00aa'::bytea)`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_sso_config`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_sso_config (tenant_id, provider, config_encrypted)
       VALUES ($1, 'okta', '\\x00aa'::bytea)`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM tenant_sso_config`)).rows
          .length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM tenant_sso_config`)).rows
          .length,
    );
    expect(svc).toBe(1);
  });
});
