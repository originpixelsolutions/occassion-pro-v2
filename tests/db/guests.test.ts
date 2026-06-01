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

async function mkEvent(db: TestDb, tenant: string, code = 'evt'): Promise<string> {
  const ty = (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'wedding-' || gen_random_uuid()::text, 'Wedding', FALSE) RETURNING id`,
      [tenant],
    )
  ).rows[0]!.id;
  return (
    await db.query<{ id: string }>(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, $3, 'Evt', '2026-12-10', '2026-12-12', 'INR') RETURNING id`,
      [tenant, ty, code],
    )
  ).rows[0]!.id;
}

describe('guests — schema correctness (Phase 3 Unit 16)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid guest', async () => {
    const t = await mkTenant(db, 'g-one');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO guests (tenant_id, event_id, name, email, phone, category)
       VALUES ($1,$2,'Alice','alice@y.dev','+919876543210','VIP')`,
      [t, e],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM guests`)).rows[0]!.c,
    ).toBe(1);
  });

  it('partial UNIQUE: same email twice in same event rejected (citext fold)', async () => {
    const t = await mkTenant(db, 'g-two');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO guests (tenant_id, event_id, name, email) VALUES ($1,$2,'A','a@y.dev')`,
      [t, e],
    );
    const err = await tryExec(
      db,
      `INSERT INTO guests (tenant_id, event_id, name, email) VALUES ($1,$2,'A2','A@Y.DEV')`,
      [t, e],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('partial UNIQUE: same email in TWO events allowed', async () => {
    const t = await mkTenant(db, 'g-three');
    const e1 = await mkEvent(db, t, 'evt1');
    const e2 = await mkEvent(db, t, 'evt2');
    await db.query(
      `INSERT INTO guests (tenant_id, event_id, name, email) VALUES ($1,$2,'A','x@y.dev')`,
      [t, e1],
    );
    await db.query(
      `INSERT INTO guests (tenant_id, event_id, name, email) VALUES ($1,$2,'A','x@y.dev')`,
      [t, e2],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM guests WHERE email='x@y.dev'`))
        .rows[0]!.c,
    ).toBe(2);
  });

  it('rejects rsvp_responded_at while pending', async () => {
    const t = await mkTenant(db, 'g-four');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO guests (tenant_id, event_id, name, rsvp_status, rsvp_responded_at) VALUES ($1,$2,'A','pending', now())`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('approved requires approver + approved_at', async () => {
    const t = await mkTenant(db, 'g-five');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO guests (tenant_id, event_id, name, registration_status) VALUES ($1,$2,'A','approved')`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('rejected requires rejection_reason', async () => {
    const t = await mkTenant(db, 'g-six');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO guests (tenant_id, event_id, name, registration_status) VALUES ($1,$2,'A','rejected')`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('checked_in requires check_in_at', async () => {
    const t = await mkTenant(db, 'g-seven');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO guests (tenant_id, event_id, name, check_in_status) VALUES ($1,$2,'A','checked_in')`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('GDPR erased: PII columns must be NULL when erased_at set', async () => {
    const t = await mkTenant(db, 'g-eight');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO guests (tenant_id, event_id, name, email, erased_at, erased_reason)
       VALUES ($1,$2,'[Erased]','still@here.com', now(), 'gdpr_request')`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('GDPR erased: NULL PII + erased_reason accepted', async () => {
    const t = await mkTenant(db, 'g-nine');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO guests (tenant_id, event_id, name, erased_at, erased_reason)
       VALUES ($1,$2,'[Erased]', now(), 'gdpr_request')`,
      [t, e],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM guests WHERE erased_at IS NOT NULL`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('cross-tenant attack: guests.tenant_id != events.tenant_id rejected', async () => {
    const t1 = await mkTenant(db, 'g-aaa');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'g-bbb');
    const err = await tryExec(
      db,
      `INSERT INTO guests (tenant_id, event_id, name) VALUES ($1,$2,'Mallory')`,
      [t2, e1],
    );
    expect(err).toMatch(/tenant_id|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'g-ccc');
    const e = await mkEvent(db, t);
    await db.query(`INSERT INTO guests (tenant_id, event_id, name) VALUES ($1,$2,'A')`, [t, e]);
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM guests`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM guests`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
