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
async function mkGuest(db: TestDb, tenant: string, event: string, name = 'G'): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO guests (tenant_id, event_id, name) VALUES ($1,$2,$3) RETURNING id`,
      [tenant, event, name],
    )
  ).rows[0]!.id;
}

describe('guest_plus_ones — schema correctness (Phase 3 Unit 19)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid +1', async () => {
    const t = await mkTenant(db, 'po-aaa');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    await db.query(
      `INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id, name, age_category)
       VALUES ($1,$2,$3,'Bob','adult')`,
      [t, e, g],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM guest_plus_ones`)).rows[0]!.c,
    ).toBe(1);
  });

  it('rejects bad age_category', async () => {
    const t = await mkTenant(db, 'po-bbb');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id, age_category) VALUES ($1,$2,$3,'teen')`,
      [t, e, g],
    );
    expect(err).toMatch(/age|check/i);
  });

  it('rejects bad rsvp_status', async () => {
    const t = await mkTenant(db, 'po-ccc');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id, rsvp_status) VALUES ($1,$2,$3,'tentative')`,
      [t, e, g],
    );
    expect(err).toMatch(/rsvp|check/i);
  });

  it('checked_in requires check_in_at', async () => {
    const t = await mkTenant(db, 'po-ddd');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id, check_in_status)
       VALUES ($1,$2,$3,'checked_in')`,
      [t, e, g],
    );
    expect(err).toMatch(/check/i);
  });

  it('checked_out requires both timestamps and ordering', async () => {
    const t = await mkTenant(db, 'po-eee');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id, check_in_status, check_in_at, check_out_at)
       VALUES ($1,$2,$3,'checked_out', now(), now() - interval '1 hour')`,
      [t, e, g],
    );
    expect(err).toMatch(/check/i);
  });

  it('GDPR erased: PII columns must be NULL when erased', async () => {
    const t = await mkTenant(db, 'po-fff');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id, name, erased_at, erased_reason)
       VALUES ($1,$2,$3,'Still Here', now(), 'gdpr_request')`,
      [t, e, g],
    );
    expect(err).toMatch(/check/i);
  });

  it('GDPR erased: NULL PII + reason accepted', async () => {
    const t = await mkTenant(db, 'po-ggg');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    await db.query(
      `INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id, erased_at, erased_reason)
       VALUES ($1,$2,$3, now(), 'gdpr_request')`,
      [t, e, g],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM guest_plus_ones WHERE erased_at IS NOT NULL`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('cross-tenant: primary guest from another tenant rejected', async () => {
    const t1 = await mkTenant(db, 'po-ttt');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'po-uuu');
    const e2 = await mkEvent(db, t2);
    const gOther = await mkGuest(db, t2, e2);
    const err = await tryExec(
      db,
      `INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id) VALUES ($1,$2,$3)`,
      [t1, e1, gOther],
    );
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('primary guest belongs to wrong event rejected', async () => {
    const t = await mkTenant(db, 'po-vvv');
    const e1 = await mkEvent(db, t, 'evt-aaa');
    const e2 = await mkEvent(db, t, 'evt-bbb');
    const gOnE2 = await mkGuest(db, t, e2);
    const err = await tryExec(
      db,
      `INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id) VALUES ($1,$2,$3)`,
      [t, e1, gOnE2],
    );
    expect(err).toMatch(/belongs to event/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'po-www');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    await db.query(
      `INSERT INTO guest_plus_ones (tenant_id, event_id, primary_guest_id) VALUES ($1,$2,$3)`,
      [t, e, g],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM guest_plus_ones`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM guest_plus_ones`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
