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

describe('app_ddos_signals — schema correctness (Phase 2 Unit 41)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid signal', async () => {
    await db.query(
      `INSERT INTO app_ddos_signals (signal_type, ip_address, endpoint, count, window_seconds)
       VALUES ('rate_burst', '1.2.3.4'::inet, '/api/v1/login', 250, 60)`,
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM app_ddos_signals`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bogus signal_type', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO app_ddos_signals (signal_type, count) VALUES ('xss', 1)`,
    );
    expect(err).toMatch(/signal_type|check/i);
  });

  it('rejects bogus http_method', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO app_ddos_signals (signal_type, http_method, count) VALUES ('rate_burst', 'YOINK', 1)`,
    );
    expect(err).toMatch(/http_method|check/i);
  });

  it('rejects count < 1', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO app_ddos_signals (signal_type, count) VALUES ('rate_burst', 0)`,
    );
    expect(err).toMatch(/count_pos|check/i);
  });

  it('rejects window_seconds outside 1..86400', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO app_ddos_signals (signal_type, count, window_seconds) VALUES ('rate_burst', 5, 0)`,
    );
    expect(err).toMatch(/window|check/i);
  });

  it('rejects ip_country lowercase', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO app_ddos_signals (signal_type, count, ip_country) VALUES ('rate_burst', 1, 'in')`,
    );
    expect(err).toMatch(/country|check/i);
  });

  it('coupling: blocked=true requires block_duration_seconds', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO app_ddos_signals (signal_type, count, blocked) VALUES ('rate_burst', 1, TRUE)`,
    );
    expect(err).toMatch(/blocked_pair|check/i);
  });

  it('coupling: blocked=false rejects block_duration_seconds', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO app_ddos_signals (signal_type, count, blocked, block_duration_seconds) VALUES ('rate_burst', 1, FALSE, 60)`,
    );
    expect(err).toMatch(/blocked_pair|check/i);
  });

  it('valid block: blocked=true with positive duration', async () => {
    await db.query(
      `INSERT INTO app_ddos_signals (signal_type, count, blocked, block_duration_seconds)
       VALUES ('credential_stuffing', 50, TRUE, 3600)`,
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM app_ddos_signals`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('SET NULL: deleting tenant nulls tenant_id but keeps row (audit trail)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO app_ddos_signals (signal_type, count, tenant_id) VALUES ('api_abuse', 200, $1)`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const r = await db.query<{ tenant_id: string | null }>(
      `SELECT tenant_id FROM app_ddos_signals`,
    );
    expect(r.rows[0]!.tenant_id).toBeNull();
  });

  it('bigserial PK auto-increments', async () => {
    await db.query(
      `INSERT INTO app_ddos_signals (signal_type, count) VALUES ('rate_burst', 1), ('rate_burst', 2)`,
    );
    const r = await db.query<{ ids: number }>(`SELECT count(*)::int AS ids FROM app_ddos_signals`);
    expect(r.rows[0]!.ids).toBe(2);
  });

  it('RLS pair', async () => {
    await db.query(`INSERT INTO app_ddos_signals (signal_type, count) VALUES ('rate_burst', 1)`);
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM app_ddos_signals`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM app_ddos_signals`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
