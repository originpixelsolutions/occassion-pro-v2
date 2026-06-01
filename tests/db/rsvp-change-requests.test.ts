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
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`,
      [slug],
    )
  ).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenant: string, code = 'evt-001'): Promise<string> {
  const ty = (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'W', FALSE) RETURNING id`,
      [tenant],
    )
  ).rows[0]!.id;
  return (
    await db.query<{ id: string }>(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`,
      [tenant, ty, code],
    )
  ).rows[0]!.id;
}
async function mkGuest(db: TestDb, tenant: string, event: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO guests (tenant_id, event_id, name) VALUES ($1,$2,'G') RETURNING id`,
      [tenant, event],
    )
  ).rows[0]!.id;
}
async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1,$2,'M','event_manager') RETURNING id`,
      [tenant, email],
    )
  ).rows[0]!.id;
}

describe('rsvp_change_requests — schema correctness (Phase 3 Unit 20)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid pending request', async () => {
    const t = await mkTenant(db, 'rc-aaa');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    await db.query(
      `INSERT INTO rsvp_change_requests (tenant_id, event_id, guest_id, old_rsvp_status, new_rsvp_status, reason)
       VALUES ($1,$2,$3,'attending','not_attending','Conflict')`,
      [t, e, g],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM rsvp_change_requests`))
        .rows[0]!.c,
    ).toBe(1);
  });

  it('rejects no-op change (old=new)', async () => {
    const t = await mkTenant(db, 'rc-bbb');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO rsvp_change_requests (tenant_id, event_id, guest_id, old_rsvp_status, new_rsvp_status)
       VALUES ($1,$2,$3,'attending','attending')`,
      [t, e, g],
    );
    expect(err).toMatch(/different|check/i);
  });

  it('pending must not have reviewer/reviewed_at/rejection', async () => {
    const t = await mkTenant(db, 'rc-ccc');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const m = await mkMember(db, t, 'r@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO rsvp_change_requests (tenant_id, event_id, guest_id, old_rsvp_status, new_rsvp_status, status, reviewed_by, reviewed_at)
       VALUES ($1,$2,$3,'attending','not_attending','pending',$4, now())`,
      [t, e, g, m],
    );
    expect(err).toMatch(/check/i);
  });

  it('approved requires reviewer + reviewed_at', async () => {
    const t = await mkTenant(db, 'rc-ddd');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO rsvp_change_requests (tenant_id, event_id, guest_id, old_rsvp_status, new_rsvp_status, status)
       VALUES ($1,$2,$3,'attending','tentative','approved')`,
      [t, e, g],
    );
    expect(err).toMatch(/check/i);
  });

  it('approved with rejection_reason rejected', async () => {
    const t = await mkTenant(db, 'rc-eee');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const m = await mkMember(db, t, 'r@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO rsvp_change_requests (tenant_id, event_id, guest_id, old_rsvp_status, new_rsvp_status, status, reviewed_by, reviewed_at, rejection_reason)
       VALUES ($1,$2,$3,'attending','tentative','approved',$4, now(),'why')`,
      [t, e, g, m],
    );
    expect(err).toMatch(/check/i);
  });

  it('rejected requires rejection_reason', async () => {
    const t = await mkTenant(db, 'rc-fff');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const m = await mkMember(db, t, 'r@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO rsvp_change_requests (tenant_id, event_id, guest_id, old_rsvp_status, new_rsvp_status, status, reviewed_by, reviewed_at)
       VALUES ($1,$2,$3,'attending','tentative','rejected',$4, now())`,
      [t, e, g, m],
    );
    expect(err).toMatch(/check/i);
  });

  it('approved happy path', async () => {
    const t = await mkTenant(db, 'rc-ggg');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const m = await mkMember(db, t, 'r@y.dev');
    await db.query(
      `INSERT INTO rsvp_change_requests (tenant_id, event_id, guest_id, old_rsvp_status, new_rsvp_status, status, reviewed_by, reviewed_at)
       VALUES ($1,$2,$3,'attending','not_attending','approved',$4, now())`,
      [t, e, g, m],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM rsvp_change_requests WHERE status='approved'`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('cross-tenant reviewer rejected', async () => {
    const t1 = await mkTenant(db, 'rc-ttt');
    const e1 = await mkEvent(db, t1);
    const g1 = await mkGuest(db, t1, e1);
    const t2 = await mkTenant(db, 'rc-uuu');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO rsvp_change_requests (tenant_id, event_id, guest_id, old_rsvp_status, new_rsvp_status, status, reviewed_by, reviewed_at)
       VALUES ($1,$2,$3,'attending','not_attending','approved',$4, now())`,
      [t1, e1, g1, mOther],
    );
    expect(err).toMatch(/reviewed_by|tenant/i);
  });

  it('cross-tenant guest rejected', async () => {
    const t1 = await mkTenant(db, 'rc-vvv');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'rc-www');
    const e2 = await mkEvent(db, t2);
    const gOther = await mkGuest(db, t2, e2);
    const err = await tryExec(
      db,
      `INSERT INTO rsvp_change_requests (tenant_id, event_id, guest_id, old_rsvp_status, new_rsvp_status)
       VALUES ($1,$2,$3,'attending','not_attending')`,
      [t1, e1, gOther],
    );
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'rc-xxx');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    await db.query(
      `INSERT INTO rsvp_change_requests (tenant_id, event_id, guest_id, old_rsvp_status, new_rsvp_status)
       VALUES ($1,$2,$3,'attending','tentative')`,
      [t, e, g],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM rsvp_change_requests`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM rsvp_change_requests`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
