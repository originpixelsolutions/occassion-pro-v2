import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}

describe('insert_audit_log() — canonical audit writer (Phase 11 Unit 62)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts via the function with minimum positional args', async () => {
    const r = await db.query<{ id: string }>(
      `SELECT insert_audit_log('system','event.created','events') AS id`);
    expect(r.rows[0]!.id).toBeTruthy();
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM audit_log WHERE action='event.created'`)).rows[0]!.c).toBe(1);
  });

  it('writes tenant + actor + severity correctly', async () => {
    const t = await mkTenant(db, 'iaf-aaa');
    const uid = '00000000-0000-0000-0000-000000000001';
    await db.query(
      `SELECT insert_audit_log(
         p_actor_type=>'tenant_member', p_action=>'event.updated', p_resource_type=>'events',
         p_actor_id=>$1::uuid, p_tenant_id=>$2::uuid, p_resource_id=>'e-1',
         p_severity=>'warning', p_metadata=>'{"k":"v"}'::jsonb)`, [uid, t]);
    const r = await db.query<{ severity: string; tenant_id: string; actor_id: string }>(
      `SELECT severity, tenant_id, actor_id FROM audit_log WHERE action='event.updated'`);
    expect(r.rows[0]!.severity).toBe('warning');
    expect(r.rows[0]!.tenant_id).toBe(t);
    expect(r.rows[0]!.actor_id).toBe(uid);
  });

  it('rejects NULL required action', async () => {
    const err = await tryExec(db, `SELECT insert_audit_log('system', NULL, 'events')`);
    expect(err).toMatch(/required|null/i);
  });

  it('failure status without failure_reason still rejected by table CHECK', async () => {
    const err = await tryExec(db, `SELECT insert_audit_log(
      p_actor_type=>'system', p_action=>'event.failed', p_resource_type=>'events',
      p_status=>'failure')`);
    expect(err).toMatch(/check/i);
  });

  it('impersonation biconditional still enforced via table CHECK', async () => {
    const err = await tryExec(db, `SELECT insert_audit_log(
      p_actor_type=>'super_admin', p_actor_id=>gen_random_uuid(),
      p_action=>'tenant.viewed', p_resource_type=>'tenants', p_source=>'impersonation')`);
    expect(err).toMatch(/check/i);
  });

  it('returns the inserted id as bigint', async () => {
    const r = await db.query<{ id: string }>(
      `SELECT insert_audit_log('system','tenant.touched','tenants') AS id`);
    expect(BigInt(r.rows[0]!.id)).toBeGreaterThan(0n);
  });
});
