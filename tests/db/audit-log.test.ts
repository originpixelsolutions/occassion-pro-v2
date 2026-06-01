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
const NOW = `'2026-06-15 12:00:00+00'::timestamptz`;

describe('audit_log — partitioned immutable audit trail (Phase 10 Unit 61)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid info event', async () => {
    const t = await mkTenant(db, 'al-aaa');
    await db.query(
      `INSERT INTO audit_log (occurred_at, tenant_id, actor_type, actor_id, action, resource_type, resource_id, severity)
       VALUES (${NOW}, $1, 'tenant_member', gen_random_uuid(), 'event.created', 'events', 'e-1', 'info')`,
      [t],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM audit_log`)).rows[0]!.c,
    ).toBe(1);
  });

  it('rejects bad action regex', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO audit_log (occurred_at, actor_type, action, resource_type) VALUES (${NOW}, 'system', 'BadAction', 'events')`,
    );
    expect(err).toMatch(/action|check/i);
  });

  it('rejects bad resource_type regex', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO audit_log (occurred_at, actor_type, action, resource_type) VALUES (${NOW}, 'system', 'event.created', 'BadType')`,
    );
    expect(err).toMatch(/resource_type|check/i);
  });

  it('system actor must have NULL actor_id', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO audit_log (occurred_at, actor_type, actor_id, action, resource_type) VALUES (${NOW}, 'system', gen_random_uuid(), 'event.created', 'events')`,
    );
    expect(err).toMatch(/check/i);
  });

  it('human actor must have actor_id', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO audit_log (occurred_at, actor_type, action, resource_type) VALUES (${NOW}, 'tenant_member', 'event.created', 'events')`,
    );
    expect(err).toMatch(/check/i);
  });

  it('failure status requires failure_reason', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO audit_log (occurred_at, actor_type, action, resource_type, status) VALUES (${NOW}, 'system', 'event.created', 'events', 'failure')`,
    );
    expect(err).toMatch(/check/i);
  });

  it('impersonation biconditional: source=impersonation requires impersonator_id', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO audit_log (occurred_at, actor_type, actor_id, action, resource_type, source) VALUES (${NOW}, 'super_admin', gen_random_uuid(), 'tenant.viewed', 'tenants', 'impersonation')`,
    );
    expect(err).toMatch(/check/i);
  });

  it('impersonator_id without source=impersonation rejected', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO audit_log (occurred_at, actor_type, actor_id, action, resource_type, source, impersonator_id) VALUES (${NOW}, 'super_admin', gen_random_uuid(), 'tenant.viewed', 'tenants', 'app', gen_random_uuid())`,
    );
    expect(err).toMatch(/check/i);
  });

  it('partition routing: row lands in 2026_06 partition', async () => {
    await db.query(
      `INSERT INTO audit_log (occurred_at, actor_type, action, resource_type) VALUES (${NOW}, 'system', 'event.created', 'events')`,
    );
    const r = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM audit_log_2026_06`);
    expect(r.rows[0]!.c).toBe(1);
  });

  it('append-only trigger: UPDATE rejected', async () => {
    await db.query(
      `INSERT INTO audit_log (occurred_at, actor_type, action, resource_type) VALUES (${NOW}, 'system', 'event.created', 'events')`,
    );
    const err = await tryExec(
      db,
      `UPDATE audit_log SET severity='warning' WHERE action='event.created'`,
    );
    expect(err).toMatch(/append-only|UPDATE not permitted/);
  });

  it('append-only trigger: DELETE rejected', async () => {
    await db.query(
      `INSERT INTO audit_log (occurred_at, actor_type, action, resource_type) VALUES (${NOW}, 'system', 'event.created', 'events')`,
    );
    const err = await tryExec(db, `DELETE FROM audit_log WHERE action='event.created'`);
    expect(err).toMatch(/append-only|DELETE not permitted/);
  });

  it('rejects out-of-range occurred_at (no partition)', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO audit_log (occurred_at, actor_type, action, resource_type) VALUES ('2099-01-01 00:00:00+00'::timestamptz, 'system', 'event.created', 'events')`,
    );
    expect(err).toMatch(/partition|no partition of relation/i);
  });

  it('RLS pair', async () => {
    await db.query(
      `INSERT INTO audit_log (occurred_at, actor_type, action, resource_type) VALUES (${NOW}, 'system', 'event.created', 'events')`,
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM audit_log`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM audit_log`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
