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
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency)
     VALUES ($1, 'Acme', 'INR') RETURNING id`,
    [slug],
  );
  return r.rows[0]!.id;
}

async function mkType(db: TestDb): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO event_types (code, name, is_system) VALUES ('wedding-' || gen_random_uuid()::text, 'Wedding', TRUE) RETURNING id`,
  );
  return r.rows[0]!.id;
}

async function mkEvent(db: TestDb, tenant: string, ty: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, 'evt-' || gen_random_uuid()::text, 'X', '2026-12-10', '2026-12-12', 'INR') RETURNING id`,
    [tenant, ty],
  );
  return r.rows[0]!.id;
}

async function mkItem(db: TestDb, ty: string, label: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO event_type_readiness_items (event_type_id, label) VALUES ($1, $2) RETURNING id`,
    [ty, label],
  );
  return r.rows[0]!.id;
}

async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1, $2, 'M', 'event_manager') RETURNING id`,
    [tenant, email],
  );
  return r.rows[0]!.id;
}

describe('event_readiness_state — schema correctness (Phase 3 Unit 5)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a pending row (default state)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkType(db);
    const e = await mkEvent(db, t, ty);
    const i = await mkItem(db, ty, 'Confirm venue');
    await db.query(`INSERT INTO event_readiness_state (event_id, item_id) VALUES ($1, $2)`, [e, i]);
    const r = await db.query<{ is_complete: boolean }>(
      `SELECT is_complete FROM event_readiness_state`,
    );
    expect(r.rows[0]!.is_complete).toBe(false);
  });

  it('completes an item: is_complete=TRUE + completed_at + completed_by', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkType(db);
    const e = await mkEvent(db, t, ty);
    const i = await mkItem(db, ty, 'Confirm venue');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO event_readiness_state (event_id, item_id, is_complete, completed_at, completed_by)
       VALUES ($1, $2, TRUE, now(), $3)`,
      [e, i, m],
    );
    const r = await db.query<{ is_complete: boolean }>(
      `SELECT is_complete FROM event_readiness_state`,
    );
    expect(r.rows[0]!.is_complete).toBe(true);
  });

  it('rejects is_complete=TRUE without completed_at', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkType(db);
    const e = await mkEvent(db, t, ty);
    const i = await mkItem(db, ty, 'X');
    const err = await tryExec(
      db,
      `INSERT INTO event_readiness_state (event_id, item_id, is_complete) VALUES ($1, $2, TRUE)`,
      [e, i],
    );
    expect(err).toMatch(/completion_coupling|check/i);
  });

  it('rejects is_complete=FALSE with completed_at set', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkType(db);
    const e = await mkEvent(db, t, ty);
    const i = await mkItem(db, ty, 'X');
    const err = await tryExec(
      db,
      `INSERT INTO event_readiness_state (event_id, item_id, is_complete, completed_at)
       VALUES ($1, $2, FALSE, now())`,
      [e, i],
    );
    expect(err).toMatch(/completion_coupling|check/i);
  });

  it('composite PK blocks duplicate (event, item)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkType(db);
    const e = await mkEvent(db, t, ty);
    const i = await mkItem(db, ty, 'X');
    await db.query(`INSERT INTO event_readiness_state (event_id, item_id) VALUES ($1, $2)`, [e, i]);
    const err = await tryExec(
      db,
      `INSERT INTO event_readiness_state (event_id, item_id) VALUES ($1, $2)`,
      [e, i],
    );
    expect(err).toMatch(/duplicate|primary key|unique/i);
  });

  it('trigger: rejects item whose event_type does not match event', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty1 = await mkType(db); // wedding
    const ty2 = await mkType(db); // corporate
    const e = await mkEvent(db, t, ty1);
    const i_other_type = await mkItem(db, ty2, 'Corp item');
    const err = await tryExec(
      db,
      `INSERT INTO event_readiness_state (event_id, item_id) VALUES ($1, $2)`,
      [e, i_other_type],
    );
    expect(err).toMatch(/type_mismatch|check/i);
  });

  it('CASCADE: deleting event removes its state rows', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkType(db);
    const e = await mkEvent(db, t, ty);
    const i = await mkItem(db, ty, 'X');
    await db.query(`INSERT INTO event_readiness_state (event_id, item_id) VALUES ($1, $2)`, [e, i]);
    await db.query(`DELETE FROM events WHERE id = $1`, [e]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_readiness_state`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('CASCADE: deleting readiness item removes its state rows', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkType(db);
    const e = await mkEvent(db, t, ty);
    const i = await mkItem(db, ty, 'X');
    await db.query(`INSERT INTO event_readiness_state (event_id, item_id) VALUES ($1, $2)`, [e, i]);
    await db.query(`DELETE FROM event_type_readiness_items WHERE id = $1`, [i]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_readiness_state`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('SET NULL: deleting completed_by member nulls FK but keeps state', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkType(db);
    const e = await mkEvent(db, t, ty);
    const i = await mkItem(db, ty, 'X');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO event_readiness_state (event_id, item_id, is_complete, completed_at, completed_by)
       VALUES ($1, $2, TRUE, now(), $3)`,
      [e, i, m],
    );
    await db.query(`DELETE FROM tenant_members WHERE id = $1`, [m]);
    const r = await db.query<{ completed_by: string | null }>(
      `SELECT completed_by FROM event_readiness_state`,
    );
    expect(r.rows[0]!.completed_by).toBeNull();
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const ty = await mkType(db);
    const e = await mkEvent(db, t, ty);
    const i = await mkItem(db, ty, 'X');
    await db.query(`INSERT INTO event_readiness_state (event_id, item_id) VALUES ($1, $2)`, [e, i]);
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ event_id: string }>(`SELECT event_id FROM event_readiness_state`)).rows
          .length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ event_id: string }>(`SELECT event_id FROM event_readiness_state`)).rows
          .length,
    );
    expect(svc).toBe(1);
  });
});
