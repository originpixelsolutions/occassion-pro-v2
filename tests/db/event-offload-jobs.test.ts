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

async function mkEvent(db: TestDb, tenant: string): Promise<string> {
  const ty = (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (code, name, is_system) VALUES ('wedding-' || gen_random_uuid()::text, 'Wedding', TRUE) RETURNING id`,
    )
  ).rows[0]!.id;
  const r = await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, 'evt-' || gen_random_uuid()::text, 'X', '2026-12-10', '2026-12-12', 'INR') RETURNING id`,
    [tenant, ty],
  );
  return r.rows[0]!.id;
}

async function mkStorage(db: TestDb, tenant: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenant_external_storage (tenant_id, provider, access_token_encrypted)
     VALUES ($1, 'r2', '\\x00aa'::bytea) RETURNING id`,
    [tenant],
  );
  return r.rows[0]!.id;
}

describe('event_offload_jobs — schema correctness (Phase 3 Unit 7)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a queued job (default state)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const s = await mkStorage(db, t);
    await db.query(
      `INSERT INTO event_offload_jobs (tenant_id, event_id, storage_id) VALUES ($1, $2, $3)`,
      [t, e, s],
    );
    const r = await db.query<{ status: string }>(`SELECT status FROM event_offload_jobs`);
    expect(r.rows[0]!.status).toBe('queued');
  });

  it("rejects 'running' without started_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_offload_jobs (tenant_id, event_id, status) VALUES ($1, $2, 'running')`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it("rejects 'completed' missing any of the four prereqs", async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_offload_jobs (tenant_id, event_id, status, started_at, completed_at)
       VALUES ($1, $2, 'completed', now(), now())`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it("rejects 'failed' without error_message", async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_offload_jobs (tenant_id, event_id, status, started_at, completed_at)
       VALUES ($1, $2, 'failed', now(), now())`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it("rejects 'cancelled' without cancelled_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_offload_jobs (tenant_id, event_id, status) VALUES ($1, $2, 'cancelled')`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('rejects negative bytes_offloaded / files_count', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_offload_jobs (tenant_id, event_id, bytes_offloaded) VALUES ($1, $2, -1)`,
      [t, e],
    );
    expect(err).toMatch(/bytes_non_neg|check/i);
  });

  it('rejects attempt_count outside 0..50', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO event_offload_jobs (tenant_id, event_id, attempt_count) VALUES ($1, $2, 51)`,
      [t, e],
    );
    expect(err).toMatch(/attempt_bounds|check/i);
  });

  it('partial UNIQUE: blocks second active job per event', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(`INSERT INTO event_offload_jobs (tenant_id, event_id) VALUES ($1, $2)`, [t, e]);
    const err = await tryExec(
      db,
      `INSERT INTO event_offload_jobs (tenant_id, event_id) VALUES ($1, $2)`,
      [t, e],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('cancelled job does NOT block a new queued job for same event', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO event_offload_jobs (tenant_id, event_id, status, cancelled_at)
       VALUES ($1, $2, 'cancelled', now())`,
      [t, e],
    );
    await db.query(`INSERT INTO event_offload_jobs (tenant_id, event_id) VALUES ($1, $2)`, [t, e]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_offload_jobs`))
      .rows[0]!.c;
    expect(c).toBe(2);
  });

  it('trigger: rejects job whose tenant_id differs from event.tenant_id', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    const e_t1 = await mkEvent(db, t1);
    const err = await tryExec(
      db,
      `INSERT INTO event_offload_jobs (tenant_id, event_id) VALUES ($1, $2)`,
      [t2, e_t1],
    );
    expect(err).toMatch(/tenant_mismatch|check/i);
  });

  it('trigger: rejects job whose storage_id is from a different tenant', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    const e_t1 = await mkEvent(db, t1);
    const s_t2 = await mkStorage(db, t2);
    const err = await tryExec(
      db,
      `INSERT INTO event_offload_jobs (tenant_id, event_id, storage_id) VALUES ($1, $2, $3)`,
      [t1, e_t1, s_t2],
    );
    expect(err).toMatch(/storage_tenant_mismatch|check/i);
  });

  it('happy path to completed', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const s = await mkStorage(db, t);
    await db.query(
      `INSERT INTO event_offload_jobs (tenant_id, event_id, storage_id, status, started_at, completed_at, bytes_offloaded, files_count)
       VALUES ($1, $2, $3, 'completed', now() - interval '1 hour', now(), 1234567, 42)`,
      [t, e, s],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_offload_jobs`))
      .rows[0]!.c;
    expect(c).toBe(1);
  });

  it('CASCADE: deleting event removes its jobs', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(`INSERT INTO event_offload_jobs (tenant_id, event_id) VALUES ($1, $2)`, [t, e]);
    await db.query(`DELETE FROM events WHERE id = $1`, [e]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_offload_jobs`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    await db.query(`INSERT INTO event_offload_jobs (tenant_id, event_id) VALUES ($1, $2)`, [t, e]);
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM event_offload_jobs`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM event_offload_jobs`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
