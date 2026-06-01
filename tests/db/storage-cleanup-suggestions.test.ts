import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1,$2,'M','event_manager') RETURNING id`, [tenant, email])).rows[0]!.id;
}
async function mkSug(db: TestDb, tenant: string, desc='Sweep old exports', stype='delete_old_exports'): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO storage_cleanup_suggestions (tenant_id, suggestion_type, description) VALUES ($1,$2,$3) RETURNING id`,
    [tenant, stype, desc])).rows[0]!.id;
}

describe('storage_cleanup_suggestions — schema correctness (Phase 7 Unit 50)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid suggestion', async () => {
    const t = await mkTenant(db, 'scs-aaa');
    await db.query(
      `INSERT INTO storage_cleanup_suggestions (tenant_id, suggestion_type, description, bytes_to_free, target_object_count, priority)
       VALUES ($1,'archive_old_events','Archive events older than 1 year', 5368709120, 1200, 'high')`, [t]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM storage_cleanup_suggestions`)).rows[0]!.c).toBe(1);
  });

  it('rejects bad suggestion_type', async () => {
    const t = await mkTenant(db, 'scs-bbb');
    const err = await tryExec(db,
      `INSERT INTO storage_cleanup_suggestions (tenant_id, suggestion_type, description) VALUES ($1,'sell_data','Sell tenant data')`, [t]);
    expect(err).toMatch(/type|check/i);
  });

  it('rejects bad priority', async () => {
    const t = await mkTenant(db, 'scs-ccc');
    const err = await tryExec(db,
      `INSERT INTO storage_cleanup_suggestions (tenant_id, suggestion_type, description, priority) VALUES ($1,'delete_duplicates','X','ultra')`, [t]);
    expect(err).toMatch(/priority|check/i);
  });

  it('dismissed requires reason', async () => {
    const t = await mkTenant(db, 'scs-ddd');
    const m = await mkMember(db, t, 'd@y.dev');
    const err = await tryExec(db,
      `INSERT INTO storage_cleanup_suggestions (tenant_id, suggestion_type, description, status, dismissed_at, dismissed_by)
       VALUES ($1,'delete_old_exports','X','dismissed', now(), $2)`, [t, m]);
    expect(err).toMatch(/check/i);
  });

  it('applied requires applied_at', async () => {
    const t = await mkTenant(db, 'scs-eee');
    const err = await tryExec(db,
      `INSERT INTO storage_cleanup_suggestions (tenant_id, suggestion_type, description, status)
       VALUES ($1,'delete_old_exports','X','applied')`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('superseded requires superseded_by', async () => {
    const t = await mkTenant(db, 'scs-fff');
    const err = await tryExec(db,
      `INSERT INTO storage_cleanup_suggestions (tenant_id, suggestion_type, description, status)
       VALUES ($1,'delete_old_exports','X','superseded')`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('supersede cycle A->B, B->A rejected', async () => {
    const t = await mkTenant(db, 'scs-ggg');
    const a = await mkSug(db, t, 'A');
    const b = (await db.query<{ id: string }>(
      `INSERT INTO storage_cleanup_suggestions (tenant_id, suggestion_type, description, superseded_by) VALUES ($1,'delete_old_exports','B',$2) RETURNING id`, [t, a])).rows[0]!.id;
    const err = await tryExec(db, `UPDATE storage_cleanup_suggestions SET superseded_by = $1 WHERE id = $2`, [b, a]);
    expect(err).toMatch(/cycle|check/i);
  });

  it('no_self_supersede blocks self-reference', async () => {
    const t = await mkTenant(db, 'scs-hhh');
    const a = await mkSug(db, t);
    const err = await tryExec(db, `UPDATE storage_cleanup_suggestions SET superseded_by = id WHERE id = $1`, [a]);
    expect(err).toMatch(/self_supersede|cycle|check/i);
  });

  it('expires_at must be after generated_at', async () => {
    const t = await mkTenant(db, 'scs-iii');
    const err = await tryExec(db,
      `INSERT INTO storage_cleanup_suggestions (tenant_id, suggestion_type, description, generated_at, expires_at)
       VALUES ($1,'delete_old_exports','X', now(), now() - interval '1 hour')`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('cross-tenant applier rejected', async () => {
    const t1 = await mkTenant(db, 'scs-ttt');
    const t2 = await mkTenant(db, 'scs-uuu');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(db,
      `INSERT INTO storage_cleanup_suggestions (tenant_id, suggestion_type, description, status, applied_at, applied_by)
       VALUES ($1,'delete_old_exports','X','applied', now(), $2)`, [t1, mOther]);
    expect(err).toMatch(/applied_by|tenant/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'scs-www');
    await mkSug(db, t);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM storage_cleanup_suggestions`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM storage_cleanup_suggestions`)).rows.length);
    expect(svc).toBe(1);
  });
});
