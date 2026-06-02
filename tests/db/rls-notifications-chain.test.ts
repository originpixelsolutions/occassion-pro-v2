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

describe('RLS on notification_preferences (Phase 12 Unit 106c)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('user sees own preferences only', async () => {
    const t = await mkTenant(db, 'np-aaa');
    const me = '00000000-0000-0000-0000-000000003800';
    const other = '00000000-0000-0000-0000-000000003801';
    await db.query(`INSERT INTO notification_preferences (tenant_id, user_id, user_type, category) VALUES ($1, $2, 'tenant_member', 'event_updates')`, [t, me]);
    await db.query(`INSERT INTO notification_preferences (tenant_id, user_id, user_type, category) VALUES ($1, $2, 'tenant_member', 'event_updates')`, [t, other]);
    await setCtx(db, me, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ user_id: string }>(`SELECT user_id FROM notification_preferences`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });

  it('user can update own preferences', async () => {
    const t = await mkTenant(db, 'np-bbb');
    const me = '00000000-0000-0000-0000-000000003810';
    await db.query(`INSERT INTO notification_preferences (tenant_id, user_id, user_type, category) VALUES ($1, $2, 'tenant_member', 'event_updates')`, [t, me]);
    await setCtx(db, me, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE notification_preferences SET email_enabled=FALSE WHERE user_id=$1 RETURNING user_id) SELECT count(*)::int AS c FROM u`, [me]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });
});

describe('RLS on whatsapp_templates (Phase 12 Unit 106e)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('anon sees zero whatsapp templates', async () => {
    await db.query(`INSERT INTO whatsapp_templates (template_name, category, language_code, body_text) VALUES ('welcome_v1', 'utility', 'en', 'Hello {{1}}, welcome to {{2}}.')`);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM whatsapp_templates`)).rows.length);
    expect(n).toBe(0);
  });

  it('authenticated tenant_member sees catalogue', async () => {
    await db.query(`INSERT INTO whatsapp_templates (template_name, category, language_code, body_text) VALUES ('welcome_v1', 'utility', 'en', 'Hello {{1}}, welcome to {{2}}.')`);
    const t = await mkTenant(db, 'wat-aaa');
    const u = '00000000-0000-0000-0000-000000003820';
    await mkMember(db, t, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM whatsapp_templates`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });
});
