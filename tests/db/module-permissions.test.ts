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

describe('module_permissions — schema correctness (Phase 2 Unit 23)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid row', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO module_permissions (tenant_id, role, module, can_read)
       VALUES ($1, 'event_manager', 'events', TRUE)`,
      [t],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM module_permissions`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('composite PK blocks duplicate (tenant, role, module)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO module_permissions (tenant_id, role, module, can_read)
       VALUES ($1, 'event_manager', 'events', TRUE)`,
      [t],
    );
    const err = await tryExec(
      db,
      `INSERT INTO module_permissions (tenant_id, role, module, can_read)
       VALUES ($1, 'event_manager', 'events', FALSE)`,
      [t],
    );
    expect(err).toMatch(/duplicate|primary key|unique/i);
  });

  it('rejects bogus role (owner is implicit, not stored)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO module_permissions (tenant_id, role, module) VALUES ($1, 'owner', 'events')`,
      [t],
    );
    expect(err).toMatch(/role|check/i);
  });

  it('rejects bogus module', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO module_permissions (tenant_id, role, module) VALUES ($1, 'team_lead', 'unicorns')`,
      [t],
    );
    expect(err).toMatch(/module|check/i);
  });

  it('rejects can_write without can_read', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO module_permissions (tenant_id, role, module, can_write)
       VALUES ($1, 'event_manager', 'events', TRUE)`,
      [t],
    );
    expect(err).toMatch(/write_implies_read|check/i);
  });

  it('rejects can_delete without can_read', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO module_permissions (tenant_id, role, module, can_delete)
       VALUES ($1, 'event_manager', 'events', TRUE)`,
      [t],
    );
    expect(err).toMatch(/delete_implies_read|check/i);
  });

  it('rejects can_export without can_read', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO module_permissions (tenant_id, role, module, can_export)
       VALUES ($1, 'event_manager', 'events', TRUE)`,
      [t],
    );
    expect(err).toMatch(/export_implies_read|check/i);
  });

  it('accepts full bundle with can_read=true', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO module_permissions (tenant_id, role, module, can_read, can_write, can_delete, can_export)
       VALUES ($1, 'event_manager', 'events', TRUE, TRUE, TRUE, TRUE)`,
      [t],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM module_permissions`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('different (role, module) combos coexist for one tenant', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO module_permissions (tenant_id, role, module, can_read) VALUES
         ($1, 'event_manager', 'events', TRUE),
         ($1, 'event_manager', 'budget', TRUE),
         ($1, 'team_lead', 'events', TRUE)`,
      [t],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM module_permissions`))
      .rows[0]!.c;
    expect(c).toBe(3);
  });

  it('CASCADE: deleting tenant removes its permissions', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO module_permissions (tenant_id, role, module, can_read)
       VALUES ($1, 'team_member', 'events', TRUE)`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM module_permissions`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO module_permissions (tenant_id, role, module, can_read)
       VALUES ($1, 'team_member', 'events', TRUE)`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM module_permissions`)).rows
          .length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM module_permissions`)).rows
          .length,
    );
    expect(svc).toBe(1);
  });
});
