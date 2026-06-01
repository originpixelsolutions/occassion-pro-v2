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
const PW = '$argon2id$v=19$m=65536,t=3,p=4$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);
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
async function mkVendor(db: TestDb, email: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO vendor_accounts (email, password_hash) VALUES ($1,$2) RETURNING id`,
      [email, PW],
    )
  ).rows[0]!.id;
}
async function mkAssignment(
  db: TestDb,
  t: string,
  e: string,
  v: string,
  cat = 'catering',
): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO vendor_event_assignments (vendor_account_id, tenant_id, event_id, service_category)
     VALUES ($1,$2,$3,$4) RETURNING id`,
      [v, t, e, cat],
    )
  ).rows[0]!.id;
}

describe('vendor_reviews — schema correctness (Phase 4 Unit 44)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid review', async () => {
    const t = await mkTenant(db, 'vr-aaa');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v1@y.dev');
    const a = await mkAssignment(db, t, e, v);
    await db.query(
      `INSERT INTO vendor_reviews (vendor_account_id, reviewer_tenant_id, event_id, vendor_assignment_id, rating, review_text, professionalism_score, quality_score, value_score)
       VALUES ($1,$2,$3,$4, 4.5, 'Great work', 4.5, 5.0, 4.0)`,
      [v, t, e, a],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_reviews`)).rows[0]!.c,
    ).toBe(1);
  });

  it('rejects rating < 1.0', async () => {
    const v = await mkVendor(db, 'v2@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_reviews (vendor_account_id, rating) VALUES ($1, 0.5)`,
      [v],
    );
    expect(err).toMatch(/rating|check/i);
  });

  it('rejects rating > 5.0', async () => {
    const v = await mkVendor(db, 'v3@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_reviews (vendor_account_id, rating) VALUES ($1, 6.0)`,
      [v],
    );
    expect(err).toMatch(/rating|check/i);
  });

  it('partial UNIQUE: one review per assignment', async () => {
    const t = await mkTenant(db, 'vr-ccc');
    const e = await mkEvent(db, t);
    const v = await mkVendor(db, 'v4@y.dev');
    const a = await mkAssignment(db, t, e, v);
    await db.query(
      `INSERT INTO vendor_reviews (vendor_account_id, reviewer_tenant_id, event_id, vendor_assignment_id, rating) VALUES ($1,$2,$3,$4, 4.0)`,
      [v, t, e, a],
    );
    const err = await tryExec(
      db,
      `INSERT INTO vendor_reviews (vendor_account_id, reviewer_tenant_id, event_id, vendor_assignment_id, rating) VALUES ($1,$2,$3,$4, 5.0)`,
      [v, t, e, a],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('NULL assignment_id: multiple reviews allowed', async () => {
    const v = await mkVendor(db, 'v5@y.dev');
    await db.query(`INSERT INTO vendor_reviews (vendor_account_id, rating) VALUES ($1, 4.0)`, [v]);
    await db.query(`INSERT INTO vendor_reviews (vendor_account_id, rating) VALUES ($1, 5.0)`, [v]);
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_reviews`)).rows[0]!.c,
    ).toBe(2);
  });

  it('is_published=TRUE with unpublished_at rejected', async () => {
    const v = await mkVendor(db, 'v6@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_reviews (vendor_account_id, rating, is_published, unpublished_at, unpublished_reason)
       VALUES ($1, 4.0, TRUE, now(), 'wrong')`,
      [v],
    );
    expect(err).toMatch(/publish_coupling|check/i);
  });

  it('unpublished_at without reason rejected', async () => {
    const v = await mkVendor(db, 'v7@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_reviews (vendor_account_id, rating, is_published, unpublished_at)
       VALUES ($1, 4.0, FALSE, now())`,
      [v],
    );
    expect(err).toMatch(/unpublish_reason|check/i);
  });

  it('vendor_response two-way coupling: text without timestamp rejected', async () => {
    const v = await mkVendor(db, 'v8@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_reviews (vendor_account_id, rating, vendor_response)
       VALUES ($1, 4.0, 'Thanks for the feedback')`,
      [v],
    );
    expect(err).toMatch(/response_coupling|check/i);
  });

  it('flag two-way coupling: reason without timestamp rejected', async () => {
    const v = await mkVendor(db, 'v9@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_reviews (vendor_account_id, rating, flagged_reason)
       VALUES ($1, 4.0, 'spam')`,
      [v],
    );
    expect(err).toMatch(/flag_coupling|check/i);
  });

  it('assignment vendor mismatch rejected', async () => {
    const t = await mkTenant(db, 'vr-ttt');
    const e = await mkEvent(db, t);
    const v1 = await mkVendor(db, 'va@y.dev');
    const v2 = await mkVendor(db, 'vb@y.dev');
    const a1 = await mkAssignment(db, t, e, v1);
    const err = await tryExec(
      db,
      `INSERT INTO vendor_reviews (vendor_account_id, reviewer_tenant_id, event_id, vendor_assignment_id, rating)
       VALUES ($1,$2,$3,$4, 4.0)`,
      [v2, t, e, a1],
    );
    expect(err).toMatch(/vendor_assignment|does not match/i);
  });

  it('event from wrong tenant rejected', async () => {
    const t1 = await mkTenant(db, 'vr-uuu');
    const t2 = await mkTenant(db, 'vr-vvv');
    const e2 = await mkEvent(db, t2);
    const v = await mkVendor(db, 'vc@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_reviews (vendor_account_id, reviewer_tenant_id, event_id, rating)
       VALUES ($1,$2,$3, 4.0)`,
      [v, t1, e2],
    );
    expect(err).toMatch(/event_id|does not match/i);
  });

  it('RLS pair', async () => {
    const v = await mkVendor(db, 'vw@y.dev');
    await db.query(`INSERT INTO vendor_reviews (vendor_account_id, rating) VALUES ($1, 4.0)`, [v]);
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM vendor_reviews`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM vendor_reviews`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
