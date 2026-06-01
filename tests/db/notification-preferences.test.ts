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

describe('notification_preferences — schema correctness (Phase 8 Unit 54)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid preference', async () => {
    const t = await mkTenant(db, 'np-aaa');
    await db.query(
      `INSERT INTO notification_preferences (user_id, user_type, category, tenant_id, sms_enabled, digest_frequency, quiet_hours_start, quiet_hours_end, quiet_hours_timezone)
       VALUES (gen_random_uuid(),'client','event.updated', $1, TRUE, 'daily', '22:00','07:00','Asia/Kolkata')`, [t]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM notification_preferences`)).rows[0]!.c).toBe(1);
  });

  it('composite PK blocks dupe (user, type, category)', async () => {
    const t = await mkTenant(db, 'np-bbb');
    const uid = (await db.query<{ id: string }>(`SELECT gen_random_uuid() AS id`)).rows[0]!.id;
    await db.query(`INSERT INTO notification_preferences (user_id, user_type, category, tenant_id) VALUES ($1,'client','x',$2)`, [uid, t]);
    const err = await tryExec(db,
      `INSERT INTO notification_preferences (user_id, user_type, category, tenant_id) VALUES ($1,'client','x',$2)`, [uid, t]);
    expect(err).toMatch(/duplicate|primary/i);
  });

  it('different categories for same user allowed', async () => {
    const t = await mkTenant(db, 'np-ccc');
    const uid = (await db.query<{ id: string }>(`SELECT gen_random_uuid() AS id`)).rows[0]!.id;
    await db.query(`INSERT INTO notification_preferences (user_id, user_type, category, tenant_id) VALUES ($1,'client','event.updated',$2)`, [uid, t]);
    await db.query(`INSERT INTO notification_preferences (user_id, user_type, category, tenant_id) VALUES ($1,'client','payment.received',$2)`, [uid, t]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM notification_preferences WHERE user_id=$1`, [uid])).rows[0]!.c).toBe(2);
  });

  it('rejects bad user_type', async () => {
    const t = await mkTenant(db, 'np-ddd');
    const err = await tryExec(db,
      `INSERT INTO notification_preferences (user_id, user_type, category, tenant_id) VALUES (gen_random_uuid(),'admin','x',$1)`, [t]);
    expect(err).toMatch(/user_type|check/i);
  });

  it('rejects bad digest_frequency', async () => {
    const t = await mkTenant(db, 'np-eee');
    const err = await tryExec(db,
      `INSERT INTO notification_preferences (user_id, user_type, category, tenant_id, digest_frequency) VALUES (gen_random_uuid(),'client','x',$1,'biweekly')`, [t]);
    expect(err).toMatch(/digest_frequency|check/i);
  });

  it('quiet_hours_start without end rejected', async () => {
    const t = await mkTenant(db, 'np-fff');
    const err = await tryExec(db,
      `INSERT INTO notification_preferences (user_id, user_type, category, tenant_id, quiet_hours_start) VALUES (gen_random_uuid(),'client','x',$1,'22:00')`, [t]);
    expect(err).toMatch(/quiet_hours_coupling|check/i);
  });

  it('quiet_hours_end without start rejected', async () => {
    const t = await mkTenant(db, 'np-ggg');
    const err = await tryExec(db,
      `INSERT INTO notification_preferences (user_id, user_type, category, tenant_id, quiet_hours_end) VALUES (gen_random_uuid(),'client','x',$1,'07:00')`, [t]);
    expect(err).toMatch(/quiet_hours_coupling|check/i);
  });

  it('tenant_id required for non-super_admin', async () => {
    const err = await tryExec(db,
      `INSERT INTO notification_preferences (user_id, user_type, category) VALUES (gen_random_uuid(),'client','x')`);
    expect(err).toMatch(/tenant_or_super|check/i);
  });

  it('super_admin without tenant_id accepted', async () => {
    await db.query(`INSERT INTO notification_preferences (user_id, user_type, category) VALUES (gen_random_uuid(),'super_admin','platform.alerts')`);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM notification_preferences WHERE user_type='super_admin'`)).rows[0]!.c).toBe(1);
  });

  it('default channel settings: in_app/email/push on, sms/whatsapp/slack/teams off', async () => {
    const t = await mkTenant(db, 'np-hhh');
    await db.query(
      `INSERT INTO notification_preferences (user_id, user_type, category, tenant_id) VALUES (gen_random_uuid(),'client','x',$1)`, [t]);
    const r = await db.query<{ in_app_enabled: boolean; email_enabled: boolean; push_enabled: boolean; sms_enabled: boolean; whatsapp_enabled: boolean; slack_enabled: boolean; teams_enabled: boolean }>(
      `SELECT in_app_enabled, email_enabled, push_enabled, sms_enabled, whatsapp_enabled, slack_enabled, teams_enabled FROM notification_preferences`);
    expect(r.rows[0]!.in_app_enabled).toBe(true);
    expect(r.rows[0]!.email_enabled).toBe(true);
    expect(r.rows[0]!.push_enabled).toBe(true);
    expect(r.rows[0]!.sms_enabled).toBe(false);
    expect(r.rows[0]!.whatsapp_enabled).toBe(false);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'np-www');
    await db.query(
      `INSERT INTO notification_preferences (user_id, user_type, category, tenant_id) VALUES (gen_random_uuid(),'client','x',$1)`, [t]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ user_id: string }>(`SELECT user_id FROM notification_preferences`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ user_id: string }>(`SELECT user_id FROM notification_preferences`)).rows.length);
    expect(svc).toBe(1);
  });
});
