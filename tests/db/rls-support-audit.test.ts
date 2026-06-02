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

describe('RLS on support_faqs (Phase 12 Unit 108a)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('anon CAN read public FAQ', async () => {
    await db.query(`INSERT INTO support_faqs (question_pattern, answer, visibility, is_active) VALUES ('How do I X?', 'You do X.', 'public', TRUE)`);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM support_faqs`)).rows.length);
    expect(n).toBe(1);
  });

  it('anon CANNOT read authenticated-only FAQ', async () => {
    await db.query(`INSERT INTO support_faqs (question_pattern, answer, visibility, is_active) VALUES ('Members only', 'X.', 'authenticated', TRUE)`);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM support_faqs`)).rows.length);
    expect(n).toBe(0);
  });

  it('authenticated tenant_member sees public + authenticated', async () => {
    await db.query(`INSERT INTO support_faqs (question_pattern, answer, visibility, is_active) VALUES ('Pub', 'X.', 'public', TRUE)`);
    await db.query(`INSERT INTO support_faqs (question_pattern, answer, visibility, is_active) VALUES ('Auth', 'X.', 'authenticated', TRUE)`);
    const t = await mkTenant(db, 'sf-aaa');
    const u = '00000000-0000-0000-0000-000000004000';
    await mkMember(db, t, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM support_faqs`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(2);
  });
});

describe('RLS on support_tickets (Phase 12 Unit 108b)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('user sees only own tickets', async () => {
    const t = await mkTenant(db, 'st-aaa');
    const me = '00000000-0000-0000-0000-000000004010';
    const other = '00000000-0000-0000-0000-000000004011';
    await mkMember(db, t, me, 'me@y.dev');
    await mkMember(db, t, other, 'ot@y.dev', 'team_member');
    await db.query(`INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject) VALUES ('TIC-001', $1, $2, 'tenant_member', 'Mine')`, [t, me]);
    await db.query(`INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject) VALUES ('TIC-002', $1, $2, 'tenant_member', 'Theirs')`, [t, other]);
    await setCtx(db, me, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const subjects = (await db.query<{ subject: string }>(`SELECT subject FROM support_tickets`)).rows.map(r => r.subject);
    await asSuperuser(db);
    expect(subjects).toEqual(['Mine']);
  });
});

describe('RLS on audit_log (Phase 12 Unit 108c)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('tenant owner sees own tenant audit rows', async () => {
    const t1 = await mkTenant(db, 'al-aaa');
    const t2 = await mkTenant(db, 'al-bbb');
    const u = '00000000-0000-0000-0000-000000004020';
    await mkMember(db, t1, u, 'o@y.dev', 'owner');
    await db.query(`INSERT INTO audit_log (occurred_at, tenant_id, actor_type, action, resource_type) VALUES ('2026-06-15'::timestamptz, $1, 'system', 'event.created', 'events')`, [t1]);
    await db.query(`INSERT INTO audit_log (occurred_at, tenant_id, actor_type, action, resource_type) VALUES ('2026-06-15'::timestamptz, $1, 'system', 'event.created', 'events')`, [t2]);
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM audit_log`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });

  it('non-owner tenant_member sees zero audit rows', async () => {
    const t = await mkTenant(db, 'al-ccc');
    const u = '00000000-0000-0000-0000-000000004030';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await db.query(`INSERT INTO audit_log (occurred_at, tenant_id, actor_type, action, resource_type) VALUES ('2026-06-15'::timestamptz, $1, 'system', 'event.created', 'events')`, [t]);
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM audit_log`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(0);
  });
});
