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

describe('outgoing_webhook_subscriptions — schema correctness (Phase 9 Unit 56)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid subscription', async () => {
    const t = await mkTenant(db, 'ows-aaa');
    await db.query(
      `INSERT INTO outgoing_webhook_subscriptions (tenant_id, name, url, events, signing_secret_encrypted, signing_secret_kms_key_id)
       VALUES ($1,'Slack notifier','https://hooks.example/x', ARRAY['guest.created','payment.received'], decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'), 'arn:kms:key/abc')`, [t]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM outgoing_webhook_subscriptions`)).rows[0]!.c).toBe(1);
  });

  it('rejects http:// URL', async () => {
    const t = await mkTenant(db, 'ows-bbb');
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_subscriptions (tenant_id, url, events, signing_secret_encrypted, signing_secret_kms_key_id)
       VALUES ($1,'http://insecure/x', ARRAY['guest.created'], decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'), 'arn:kms')`, [t]);
    expect(err).toMatch(/url_fmt|check/i);
  });

  it('rejects empty events array', async () => {
    const t = await mkTenant(db, 'ows-ccc');
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_subscriptions (tenant_id, url, events, signing_secret_encrypted, signing_secret_kms_key_id)
       VALUES ($1,'https://x/y', ARRAY[]::text[], decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'), 'arn:kms')`, [t]);
    expect(err).toMatch(/events|check/i);
  });

  it('rejects short signing secret (< 32 bytes)', async () => {
    const t = await mkTenant(db, 'ows-ddd');
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_subscriptions (tenant_id, url, events, signing_secret_encrypted, signing_secret_kms_key_id)
       VALUES ($1,'https://x/y', ARRAY['guest.created'], decode('abcd','hex'), 'arn:kms')`, [t]);
    expect(err).toMatch(/secret|check/i);
  });

  it('rejects bad signing_algorithm', async () => {
    const t = await mkTenant(db, 'ows-eee');
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_subscriptions (tenant_id, url, events, signing_secret_encrypted, signing_secret_kms_key_id, signing_algorithm)
       VALUES ($1,'https://x/y', ARRAY['e'], decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'), 'arn:kms','md5')`, [t]);
    expect(err).toMatch(/algorithm_enum|check/i);
  });

  it('total_failures > total_deliveries rejected', async () => {
    const t = await mkTenant(db, 'ows-fff');
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_subscriptions (tenant_id, url, events, signing_secret_encrypted, signing_secret_kms_key_id, total_deliveries, total_failures)
       VALUES ($1,'https://x/y', ARRAY['e'], decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'), 'arn:kms', 5, 10)`, [t]);
    expect(err).toMatch(/failures_le_deliveries|check/i);
  });

  it('is_paused without reason rejected', async () => {
    const t = await mkTenant(db, 'ows-ggg');
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_subscriptions (tenant_id, url, events, signing_secret_encrypted, signing_secret_kms_key_id, is_paused, paused_at)
       VALUES ($1,'https://x/y', ARRAY['e'], decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'), 'arn:kms', TRUE, now())`, [t]);
    expect(err).toMatch(/pause_coupling|check/i);
  });

  it('auto_disabled requires is_active=FALSE', async () => {
    const t = await mkTenant(db, 'ows-hhh');
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_subscriptions (tenant_id, url, events, signing_secret_encrypted, signing_secret_kms_key_id, auto_disabled_at, auto_disabled_reason)
       VALUES ($1,'https://x/y', ARRAY['e'], decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'), 'arn:kms', now(),'10 consecutive failures')`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('timeout_seconds > 60 rejected', async () => {
    const t = await mkTenant(db, 'ows-iii');
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_subscriptions (tenant_id, url, events, signing_secret_encrypted, signing_secret_kms_key_id, timeout_seconds)
       VALUES ($1,'https://x/y', ARRAY['e'], decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'), 'arn:kms', 120)`, [t]);
    expect(err).toMatch(/timeout|check/i);
  });

  it('last_status_code out of range rejected', async () => {
    const t = await mkTenant(db, 'ows-jjj');
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_subscriptions (tenant_id, url, events, signing_secret_encrypted, signing_secret_kms_key_id, last_status_code)
       VALUES ($1,'https://x/y', ARRAY['e'], decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'), 'arn:kms', 999)`, [t]);
    expect(err).toMatch(/last_status_code|check/i);
  });

  it('cross-tenant creator rejected', async () => {
    const t1 = await mkTenant(db, 'ows-ttt');
    const t2 = await mkTenant(db, 'ows-uuu');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(db,
      `INSERT INTO outgoing_webhook_subscriptions (tenant_id, url, events, signing_secret_encrypted, signing_secret_kms_key_id, created_by)
       VALUES ($1,'https://x/y', ARRAY['e'], decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'), 'arn:kms', $2)`, [t1, mOther]);
    expect(err).toMatch(/created_by|tenant/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'ows-www');
    await db.query(
      `INSERT INTO outgoing_webhook_subscriptions (tenant_id, url, events, signing_secret_encrypted, signing_secret_kms_key_id)
       VALUES ($1,'https://x/y', ARRAY['e'], decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'), 'arn:kms')`, [t]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM outgoing_webhook_subscriptions`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM outgoing_webhook_subscriptions`)).rows.length);
    expect(svc).toBe(1);
  });
});
