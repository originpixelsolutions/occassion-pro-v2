import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenantId: string, uid: string, email: string, role = 'owner'): Promise<void> {
  await db.query(
    `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($1, $2, $3, 'M', $4)`,
    [uid, tenantId, email, role]);
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on outgoing_webhook_subscriptions (Phase 12 Unit 107a)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('owner can create subscription', async () => {
    const t = await mkTenant(db, 'ows-aaa');
    const u = '00000000-0000-0000-0000-000000003900';
    await mkMember(db, t, u, 'o@y.dev', 'owner');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(
      `INSERT INTO outgoing_webhook_subscriptions (tenant_id, name, url, events, signing_secret_encrypted, signing_secret_kms_key_id, created_by)
       VALUES ($1, 'test', 'https://x.example/h', ARRAY['event.created'], 'abcdefghijklmnopqrstuvwxyz012345'::bytea, gen_random_uuid(), $2)`, [t, u]);
    await asSuperuser(db);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM outgoing_webhook_subscriptions`)).rows[0]!.c).toBe(1);
  });

  it('anon sees zero', async () => {
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM outgoing_webhook_subscriptions`)).rows.length);
    expect(n).toBe(0);
  });
});

describe('RLS on incoming_webhook_log (Phase 12 Unit 107c)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('tenant_member sees zero (super_admin only visibility)', async () => {
    const t = await mkTenant(db, 'iwl-aaa');
    const u = '00000000-0000-0000-0000-000000003910';
    await mkMember(db, t, u, 'm@y.dev');
    await db.query(`INSERT INTO incoming_webhook_log (source, event_type, payload, signature_valid, status) VALUES ('razorpay', 'payment.captured', '{}'::jsonb, TRUE, 'received')`);
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM incoming_webhook_log`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(0);
  });

  it('anon CAN insert (public webhook endpoint)', async () => {
    await withRole(db, 'anon', async () => {
      await db.query(`INSERT INTO incoming_webhook_log (source, event_type, payload, signature_valid, status) VALUES ('razorpay', 'payment.captured', '{}'::jsonb, TRUE, 'received')`);
    });
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM incoming_webhook_log`)).rows[0]!.c).toBe(1);
  });
});
