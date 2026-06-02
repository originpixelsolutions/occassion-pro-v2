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
async function mkEvent(db: TestDb, tenantId: string, code: string): Promise<string> {
  const etId = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'w-' || $2, 'W', FALSE) RETURNING id`,
    [tenantId, code])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, $3, 'E', '2026-12-01', '2026-12-03', 'INR') RETURNING id`, [tenantId, etId, code])).rows[0]!.id;
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on sessions (Phase 12 Unit 91)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('anon CAN read published sessions', async () => {
    const t = await mkTenant(db, 'ses-aaa');
    const e = await mkEvent(db, t, 'e-a');
    await db.query(
      `INSERT INTO sessions (tenant_id, event_id, session_type, title, starts_at, ends_at, is_cpd_eligible, is_published, published_at) VALUES ($1, $2, 'keynote', 'S', '2026-12-01 10:00', '2026-12-01 11:00', FALSE, TRUE, now())`,
      [t, e]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM sessions`)).rows.length);
    expect(n).toBe(1);
  });

  it('anon CANNOT read draft sessions', async () => {
    const t = await mkTenant(db, 'ses-bbb');
    const e = await mkEvent(db, t, 'e-b');
    await db.query(
      `INSERT INTO sessions (tenant_id, event_id, session_type, title, starts_at, ends_at, is_cpd_eligible, is_published) VALUES ($1, $2, 'keynote', 'S', '2026-12-01 10:00', '2026-12-01 11:00', FALSE, FALSE)`,
      [t, e]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM sessions`)).rows.length);
    expect(n).toBe(0);
  });

  it('cross-tenant draft isolation', async () => {
    const t1 = await mkTenant(db, 'ses-ccc');
    const t2 = await mkTenant(db, 'ses-ddd');
    const e1 = await mkEvent(db, t1, 'e-c');
    const e2 = await mkEvent(db, t2, 'e-d');
    await db.query(`INSERT INTO sessions (tenant_id, event_id, session_type, title, starts_at, ends_at, is_cpd_eligible, is_published) VALUES ($1, $2, 'keynote', 'S1', '2026-12-01 10:00', '2026-12-01 11:00', FALSE, FALSE)`, [t1, e1]);
    await db.query(`INSERT INTO sessions (tenant_id, event_id, session_type, title, starts_at, ends_at, is_cpd_eligible, is_published) VALUES ($1, $2, 'keynote', 'S2', '2026-12-01 10:00', '2026-12-01 11:00', FALSE, FALSE)`, [t2, e2]);
    const u = '00000000-0000-0000-0000-000000002400';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const titles = (await db.query<{ title: string }>(`SELECT title FROM sessions`)).rows.map(r => r.title);
    await asSuperuser(db);
    expect(titles).toEqual(['S1']);
  });

  it('team_member cannot INSERT (manager-gated)', async () => {
    const t = await mkTenant(db, 'ses-eee');
    const e = await mkEvent(db, t, 'e-e');
    const u = '00000000-0000-0000-0000-000000002410';
    await mkMember(db, t, u, 'tm@y.dev', 'team_member');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(`INSERT INTO sessions (tenant_id, event_id, session_type, title, starts_at, ends_at, is_cpd_eligible, is_published) VALUES ($1, $2, 'keynote', 'X', '2026-12-01 10:00', '2026-12-01 11:00', FALSE, FALSE)`, [t, e]); }
    catch (e2) { err = e2 instanceof Error ? e2.message : String(e2); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });
});
