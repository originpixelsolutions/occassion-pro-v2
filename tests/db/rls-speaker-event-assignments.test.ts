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
async function mkSpeaker(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO speaker_accounts (email, full_name, failed_login_count, mfa_enabled) VALUES ($1, 'S', 0, FALSE) RETURNING id`,
    [email])).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenantId: string, code: string): Promise<string> {
  const etId = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'w-' || $2, 'W', FALSE) RETURNING id`,
    [tenantId, code])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, $3, 'E', '2026-12-01', '2026-12-03', 'INR') RETURNING id`, [tenantId, etId, code])).rows[0]!.id;
}
async function mkSession(db: TestDb, tenantId: string, eventId: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO sessions (tenant_id, event_id, session_type, title, starts_at, ends_at, is_cpd_eligible, is_published)
     VALUES ($1, $2, 'keynote', 'S', '2026-12-01 10:00', '2026-12-01 11:00', FALSE, FALSE) RETURNING id`,
    [tenantId, eventId])).rows[0]!.id;
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on speaker_event_assignments (Phase 12 Unit 89)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('tenant_member sees own tenant assignments only', async () => {
    const t1 = await mkTenant(db, 'sea-aaa');
    const t2 = await mkTenant(db, 'sea-bbb');
    const e1 = await mkEvent(db, t1, 'e-a');
    const e2 = await mkEvent(db, t2, 'e-b');
    const s1 = await mkSession(db, t1, e1);
    const s2 = await mkSession(db, t2, e2);
    const sp1 = await mkSpeaker(db, 'sp1@y.dev');
    const sp2 = await mkSpeaker(db, 'sp2@y.dev');
    const u1 = '00000000-0000-0000-0000-000000002300';
    const u2 = '00000000-0000-0000-0000-000000002301';
    await mkMember(db, t1, u1, 'm1@y.dev');
    await mkMember(db, t2, u2, 'm2@y.dev');
    await db.query(`INSERT INTO speaker_event_assignments (tenant_id, event_id, session_id, speaker_account_id, role, status, invited_by, invited_at) VALUES ($1, $2, $3, $4, 'speaker', 'invited', $5, now())`, [t1, e1, s1, sp1, u1]);
    await db.query(`INSERT INTO speaker_event_assignments (tenant_id, event_id, session_id, speaker_account_id, role, status, invited_by, invited_at) VALUES ($1, $2, $3, $4, 'speaker', 'invited', $5, now())`, [t2, e2, s2, sp2, u2]);
    await setCtx(db, u1, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM speaker_event_assignments`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });

  it('speaker sees own assignments only', async () => {
    const t = await mkTenant(db, 'sea-ccc');
    const e = await mkEvent(db, t, 'e-c');
    const sid = await mkSession(db, t, e);
    const me = await mkSpeaker(db, 'me@y.dev');
    const other = await mkSpeaker(db, 'other@y.dev');
    const u = '00000000-0000-0000-0000-000000002310';
    await mkMember(db, t, u, 'm@y.dev');
    await db.query(`INSERT INTO speaker_event_assignments (tenant_id, event_id, session_id, speaker_account_id, role, status, invited_by, invited_at) VALUES ($1, $2, $3, $4, 'speaker', 'invited', $5, now())`, [t, e, sid, me, u]);
    await db.query(`INSERT INTO speaker_event_assignments (tenant_id, event_id, session_id, speaker_account_id, role, status, invited_by, invited_at) VALUES ($1, $2, $3, $4, 'speaker', 'invited', $5, now())`, [t, e, sid, other, u]);
    await setCtx(db, me, 'speaker', null);
    await asRole(db, 'authenticated');
    const rows = await db.query<{ speaker_account_id: string }>(`SELECT speaker_account_id FROM speaker_event_assignments`);
    await asSuperuser(db);
    expect(rows.rows.map(r => r.speaker_account_id)).toEqual([me]);
  });

  it('anon sees zero', async () => {
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM speaker_event_assignments`)).rows.length);
    expect(n).toBe(0);
  });
});
