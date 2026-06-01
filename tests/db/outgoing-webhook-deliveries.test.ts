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
async function mkSub(db: TestDb, tenant: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO outgoing_webhook_subscriptions (tenant_id, url, events, signing_secret_encrypted, signing_secret_kms_key_id)
     VALUES ($1,'https://x.dev/h', ARRAY['guest.created'], decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'), 'arn:kms') RETURNING id`, [tenant])).rows[0]!.id;
}

describe('outgoing_webhook_deliveries — schema correctness (Phase 9 Unit 57)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid pending delivery', async () => {
    const t = await mkTenant(db, 'owd-aaa');
    const s = await mkSub(db, t);
    await db.query(
      `INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload, next_attempt_at)
       VALUES ($1,$2,'guest.created','{"id":"guest-123"}'::jsonb, now())`, [t, s]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM outgoing_webhook_deliveries`)).rows[0]!.c).toBe(1);
  });

  it('rejects array payload', async () => {
    const t = await mkTenant(db, 'owd-bbb');
    const s = await mkSub(db, t);
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload)
       VALUES ($1,$2,'guest.created','[]'::jsonb)`, [t, s]);
    expect(err).toMatch(/payload|check/i);
  });

  it('attempt_count > 12 rejected', async () => {
    const t = await mkTenant(db, 'owd-ccc');
    const s = await mkSub(db, t);
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload, attempt_count)
       VALUES ($1,$2,'e','{}'::jsonb, 13)`, [t, s]);
    expect(err).toMatch(/attempt_range|check/i);
  });

  it('delivered_at without attempted_at rejected', async () => {
    const t = await mkTenant(db, 'owd-ddd');
    const s = await mkSub(db, t);
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload, delivered_at)
       VALUES ($1,$2,'e','{}'::jsonb, now())`, [t, s]);
    expect(err).toMatch(/check/i);
  });

  it('delivered AND failed_permanently mutually exclusive', async () => {
    const t = await mkTenant(db, 'owd-eee');
    const s = await mkSub(db, t);
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload, attempt_count, attempted_at, delivered_at, failed_permanently, failed_permanently_at, failed_permanently_reason)
       VALUES ($1,$2,'e','{}'::jsonb, 1, now(), now(), TRUE, now(), 'gave up')`, [t, s]);
    expect(err).toMatch(/check/i);
  });

  it('failed_permanently requires reason + timestamp', async () => {
    const t = await mkTenant(db, 'owd-fff');
    const s = await mkSub(db, t);
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload, failed_permanently)
       VALUES ($1,$2,'e','{}'::jsonb, TRUE)`, [t, s]);
    expect(err).toMatch(/fail_coupling|check/i);
  });

  it('attempted_at requires attempt_count > 0', async () => {
    const t = await mkTenant(db, 'owd-ggg');
    const s = await mkSub(db, t);
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload, attempted_at)
       VALUES ($1,$2,'e','{}'::jsonb, now())`, [t, s]);
    expect(err).toMatch(/check/i);
  });

  it('UNIQUE (subscription, idempotency_key) blocks dupe', async () => {
    const t = await mkTenant(db, 'owd-hhh');
    const s = await mkSub(db, t);
    await db.query(`INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload, idempotency_key)
       VALUES ($1,$2,'e','{}'::jsonb,'idem-X1')`, [t, s]);
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload, idempotency_key)
       VALUES ($1,$2,'e','{"v":2}'::jsonb,'idem-X1')`, [t, s]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('NULL idempotency_key allowed multiple times', async () => {
    const t = await mkTenant(db, 'owd-iii');
    const s = await mkSub(db, t);
    await db.query(`INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload) VALUES ($1,$2,'e','{}'::jsonb)`, [t, s]);
    await db.query(`INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload) VALUES ($1,$2,'e','{}'::jsonb)`, [t, s]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM outgoing_webhook_deliveries`)).rows[0]!.c).toBe(2);
  });

  it('duration_ms > 120000 rejected', async () => {
    const t = await mkTenant(db, 'owd-jjj');
    const s = await mkSub(db, t);
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload, duration_ms)
       VALUES ($1,$2,'e','{}'::jsonb, 130000)`, [t, s]);
    expect(err).toMatch(/duration_ms|check/i);
  });

  it('subscription from another tenant rejected', async () => {
    const t1 = await mkTenant(db, 'owd-ttt');
    const t2 = await mkTenant(db, 'owd-uuu');
    const sOther = await mkSub(db, t2);
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload)
       VALUES ($1,$2,'e','{}'::jsonb)`, [t1, sOther]);
    expect(err).toMatch(/subscription|tenant|does not match/i);
  });

  it('delivered happy path with timing', async () => {
    const t = await mkTenant(db, 'owd-kkk');
    const s = await mkSub(db, t);
    await db.query(
      `INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload, attempt_count, attempted_at, delivered_at, last_status_code, duration_ms)
       VALUES ($1,$2,'guest.created','{}'::jsonb, 1, now() - interval '2 seconds', now(), 200, 1850)`, [t, s]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM outgoing_webhook_deliveries WHERE delivered_at IS NOT NULL`)).rows[0]!.c).toBe(1);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'owd-www');
    const s = await mkSub(db, t);
    await db.query(`INSERT INTO outgoing_webhook_deliveries (tenant_id, subscription_id, event_type, payload) VALUES ($1,$2,'e','{}'::jsonb)`, [t, s]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM outgoing_webhook_deliveries`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM outgoing_webhook_deliveries`)).rows.length);
    expect(svc).toBe(1);
  });
});
