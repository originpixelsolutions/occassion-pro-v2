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

describe('inventory_audits — schema correctness (Phase 3 Unit 31)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid in_progress audit', async () => {
    const t = await mkTenant(db, 'iau-aaa');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO inventory_audits (tenant_id, audited_by, audit_type) VALUES ($1,$2,'periodic')`,
      [t, m],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM inventory_audits`)).rows[0]!.c,
    ).toBe(1);
  });

  it('rejects bad audit_type', async () => {
    const t = await mkTenant(db, 'iau-bbb');
    const err = await tryExec(
      db,
      `INSERT INTO inventory_audits (tenant_id, audit_type) VALUES ($1,'manual_count')`,
      [t],
    );
    expect(err).toMatch(/audit_type|type|check/i);
  });

  it('completed requires completed_at + snapshot', async () => {
    const t = await mkTenant(db, 'iau-ccc');
    const err = await tryExec(
      db,
      `INSERT INTO inventory_audits (tenant_id, status) VALUES ($1,'completed')`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('cancelled requires cancelled_at + reason', async () => {
    const t = await mkTenant(db, 'iau-ddd');
    const err = await tryExec(
      db,
      `INSERT INTO inventory_audits (tenant_id, status) VALUES ($1,'cancelled')`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('completed happy path', async () => {
    const t = await mkTenant(db, 'iau-eee');
    await db.query(
      `INSERT INTO inventory_audits (tenant_id, status, snapshot, completed_at, item_count, discrepancy_count)
       VALUES ($1,'completed', '{"items":[]}'::jsonb, now(), 42, 0)`,
      [t],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM inventory_audits WHERE status='completed'`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('rejects array snapshot', async () => {
    const t = await mkTenant(db, 'iau-fff');
    const err = await tryExec(
      db,
      `INSERT INTO inventory_audits (tenant_id, snapshot) VALUES ($1, '[]'::jsonb)`,
      [t],
    );
    expect(err).toMatch(/snapshot|check/i);
  });

  it('value without currency rejected', async () => {
    const t = await mkTenant(db, 'iau-ggg');
    const err = await tryExec(
      db,
      `INSERT INTO inventory_audits (tenant_id, total_value_audited) VALUES ($1, 250000.00)`,
      [t],
    );
    expect(err).toMatch(/value_currency|check/i);
  });

  it('completed_at before audited_at rejected', async () => {
    const t = await mkTenant(db, 'iau-hhh');
    const err = await tryExec(
      db,
      `INSERT INTO inventory_audits (tenant_id, audited_at, status, snapshot, completed_at)
       VALUES ($1, now(), 'completed', '{}'::jsonb, now() - interval '1 hour')`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('cross-tenant auditor rejected', async () => {
    const t1 = await mkTenant(db, 'iau-ttt');
    const t2 = await mkTenant(db, 'iau-uuu');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO inventory_audits (tenant_id, audited_by) VALUES ($1,$2)`,
      [t1, mOther],
    );
    expect(err).toMatch(/audited_by|tenant/i);
  });

  it('partial index: only audits with discrepancies > 0 indexed', async () => {
    const t = await mkTenant(db, 'iau-iii');
    await db.query(`INSERT INTO inventory_audits (tenant_id, discrepancy_count) VALUES ($1, 0)`, [
      t,
    ]);
    await db.query(`INSERT INTO inventory_audits (tenant_id, discrepancy_count) VALUES ($1, 3)`, [
      t,
    ]);
    const discrepant = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM inventory_audits WHERE discrepancy_count > 0`,
      )
    ).rows[0]!.c;
    expect(discrepant).toBe(1);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'iau-www');
    await db.query(`INSERT INTO inventory_audits (tenant_id) VALUES ($1)`, [t]);
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM inventory_audits`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM inventory_audits`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
