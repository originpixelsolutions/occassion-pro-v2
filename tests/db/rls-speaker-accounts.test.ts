import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, type TestDb } from '../setup/pg.js';

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

describe('RLS on speaker_accounts (Phase 12 Unit 90)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('speaker sees own row only', async () => {
    const s1 = await mkSpeaker(db, 's1@y.dev');
    await mkSpeaker(db, 's2@y.dev');
    await setCtx(db, s1, 'speaker', null);
    await asRole(db, 'authenticated');
    const ids = (await db.query<{ id: string }>(`SELECT id FROM speaker_accounts`)).rows.map(r => r.id);
    await asSuperuser(db);
    expect(ids).toEqual([s1]);
  });

  it('tenant_member sees speakers linked into own tenant', async () => {
    const t = await mkTenant(db, 'sa-aaa');
    const e = await mkEvent(db, t, 'e-a');
    const u = '00000000-0000-0000-0000-000000002200';
    await mkMember(db, t, u, 'm@y.dev');
    const linked = await mkSpeaker(db, 'l@y.dev');
    const unlinked = await mkSpeaker(db, 'u@y.dev');
    const sid = await mkSession(db, t, e);
    await db.query(`INSERT INTO speaker_event_assignments (tenant_id, event_id, session_id, speaker_account_id, role, status, invited_by, invited_at) VALUES ($1, $2, $5, $3, 'speaker', 'invited', $4, now())`, [t, e, linked, u, sid]);
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const ids = (await db.query<{ id: string }>(`SELECT id FROM speaker_accounts`)).rows.map(r => r.id);
    await asSuperuser(db);
    expect(ids).toContain(linked);
    expect(ids).not.toContain(unlinked);
  });

  it('speaker can UPDATE own row', async () => {
    const s = await mkSpeaker(db, 'edit@y.dev');
    await setCtx(db, s, 'speaker', null);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE speaker_accounts SET failed_login_count=1 WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`, [s]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(1);
  });

  it('speaker cannot UPDATE someone-else row', async () => {
    const me = await mkSpeaker(db, 'me@y.dev');
    const other = await mkSpeaker(db, 'other@y.dev');
    await setCtx(db, me, 'speaker', null);
    await asRole(db, 'authenticated');
    const r = await db.query<{ c: number }>(
      `WITH u AS (UPDATE speaker_accounts SET failed_login_count=1 WHERE id=$1 RETURNING id) SELECT count(*)::int AS c FROM u`, [other]);
    await asSuperuser(db);
    expect(r.rows[0]!.c).toBe(0);
  });
});
