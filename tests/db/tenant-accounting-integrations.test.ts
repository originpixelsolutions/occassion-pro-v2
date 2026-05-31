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

const MAPPING = `'{"invoice_number":"DocNumber","customer":"CustomerRef"}'::jsonb`;

describe('tenant_accounting_integrations — schema correctness (Phase 2 Unit 18)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid integration', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_accounting_integrations (tenant_id, provider, access_token_encrypted, field_mapping, realm_id)
       VALUES ($1, 'quickbooks', '\\x00aa'::bytea, ${MAPPING}, 'realm_123')`,
      [t],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_accounting_integrations`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bogus provider', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_accounting_integrations (tenant_id, provider, access_token_encrypted, field_mapping)
       VALUES ($1, 'sageone', '\\x00aa'::bytea, ${MAPPING})`,
      [t],
    );
    expect(err).toMatch(/provider|check/i);
  });

  it('rejects bogus sync_direction', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_accounting_integrations (tenant_id, provider, access_token_encrypted, field_mapping, sync_direction)
       VALUES ($1, 'quickbooks', '\\x00aa'::bytea, ${MAPPING}, 'sideways')`,
      [t],
    );
    expect(err).toMatch(/sync_direction|check/i);
  });

  it('rejects empty access_token', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_accounting_integrations (tenant_id, provider, access_token_encrypted, field_mapping)
       VALUES ($1, 'quickbooks', ''::bytea, ${MAPPING})`,
      [t],
    );
    expect(err).toMatch(/token_non_empty|check/i);
  });

  it('rejects non-object field_mapping', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_accounting_integrations (tenant_id, provider, access_token_encrypted, field_mapping)
       VALUES ($1, 'quickbooks', '\\x00aa'::bytea, '"plain-string"'::jsonb)`,
      [t],
    );
    expect(err).toMatch(/mapping_object|check/i);
  });

  it('rejects whitespace-only realm_id', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_accounting_integrations (tenant_id, provider, access_token_encrypted, field_mapping, realm_id)
       VALUES ($1, 'quickbooks', '\\x00aa'::bytea, ${MAPPING}, '   ')`,
      [t],
    );
    expect(err).toMatch(/realm|check/i);
  });

  it("rejects 'expired' without token_expires_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_accounting_integrations (tenant_id, provider, access_token_encrypted, field_mapping, status)
       VALUES ($1, 'quickbooks', '\\x00aa'::bytea, ${MAPPING}, 'expired')`,
      [t],
    );
    expect(err).toMatch(/expired|check/i);
  });

  it('partial UNIQUE: one active integration per (tenant, provider)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_accounting_integrations (tenant_id, provider, access_token_encrypted, field_mapping)
       VALUES ($1, 'quickbooks', '\\x00aa'::bytea, ${MAPPING})`,
      [t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_accounting_integrations (tenant_id, provider, access_token_encrypted, field_mapping)
       VALUES ($1, 'quickbooks', '\\x00bb'::bytea, ${MAPPING})`,
      [t],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('disconnected integration does not block a new active one', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_accounting_integrations (tenant_id, provider, access_token_encrypted, field_mapping, status)
       VALUES ($1, 'quickbooks', '\\x00aa'::bytea, ${MAPPING}, 'disconnected')`,
      [t],
    );
    await db.query(
      `INSERT INTO tenant_accounting_integrations (tenant_id, provider, access_token_encrypted, field_mapping)
       VALUES ($1, 'quickbooks', '\\x00bb'::bytea, ${MAPPING})`,
      [t],
    );
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM tenant_accounting_integrations WHERE tenant_id = $1`,
        [t],
      )
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting tenant removes its integrations', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_accounting_integrations (tenant_id, provider, access_token_encrypted, field_mapping)
       VALUES ($1, 'quickbooks', '\\x00aa'::bytea, ${MAPPING})`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_accounting_integrations`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_accounting_integrations (tenant_id, provider, access_token_encrypted, field_mapping)
       VALUES ($1, 'quickbooks', '\\x00aa'::bytea, ${MAPPING})`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_accounting_integrations`)).rows
          .length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_accounting_integrations`)).rows
          .length,
    );
    expect(svc).toBe(1);
  });
});
