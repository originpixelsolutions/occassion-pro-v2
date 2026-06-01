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

async function mkEvent(db: TestDb, tenant: string): Promise<string> {
  const ty = (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (tenant_id, code, name) VALUES ($1, 'wedding-' || gen_random_uuid()::text, 'Wedding') RETURNING id`,
      [tenant],
    )
  ).rows[0]!.id;
  const r = await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, 'evt-' || gen_random_uuid()::text, 'X', '2026-12-10', '2026-12-12', 'INR') RETURNING id`,
    [tenant, ty],
  );
  return r.rows[0]!.id;
}

async function mkSubteam(
  db: TestDb,
  tenant: string,
  event: string,
  name = 'Catering',
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [tenant, event, name],
  );
  return r.rows[0]!.id;
}

async function mkMember(
  db: TestDb,
  tenant: string,
  email: string,
  role = 'event_manager',
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1, $2, 'M', $3) RETURNING id`,
    [tenant, email, role],
  );
  return r.rows[0]!.id;
}

describe('event_subteam_members — schema correctness (Phase 3 Unit 3)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid assignment', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const s = await mkSubteam(db, t, e);
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO event_subteam_members (subteam_id, member_id, role_label)
       VALUES ($1, $2, 'cook')`,
      [s, m],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_subteam_members`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('composite PK blocks duplicate (subteam, member)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const s = await mkSubteam(db, t, e);
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(`INSERT INTO event_subteam_members (subteam_id, member_id) VALUES ($1, $2)`, [
      s,
      m,
    ]);
    const err = await tryExec(
      db,
      `INSERT INTO event_subteam_members (subteam_id, member_id, role_label) VALUES ($1, $2, 'cook')`,
      [s, m],
    );
    expect(err).toMatch(/duplicate|primary key|unique/i);
  });

  it('rejects empty/whitespace role_label', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const s = await mkSubteam(db, t, e);
    const m = await mkMember(db, t, 'a@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO event_subteam_members (subteam_id, member_id, role_label) VALUES ($1, $2, '   ')`,
      [s, m],
    );
    expect(err).toMatch(/role_label_len|check/i);
  });

  it('member CAN belong to multiple subteams in same event', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const s1 = await mkSubteam(db, t, e, 'A');
    const s2 = await mkSubteam(db, t, e, 'B');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO event_subteam_members (subteam_id, member_id) VALUES ($1, $3), ($2, $3)`,
      [s1, s2, m],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_subteam_members`)
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('trigger: rejects cross-tenant member assignment', async () => {
    const t1 = await mkTenant(db, 'acme-co');
    const t2 = await mkTenant(db, 'beta-co');
    const e1 = await mkEvent(db, t1);
    const s = await mkSubteam(db, t1, e1);
    const m_other_tenant = await mkMember(db, t2, 'spy@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO event_subteam_members (subteam_id, member_id) VALUES ($1, $2)`,
      [s, m_other_tenant],
    );
    expect(err).toMatch(/tenant_mismatch|check/i);
  });

  it('CASCADE: deleting subteam removes its members', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const s = await mkSubteam(db, t, e);
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(`INSERT INTO event_subteam_members (subteam_id, member_id) VALUES ($1, $2)`, [
      s,
      m,
    ]);
    await db.query(`DELETE FROM event_subteams WHERE id = $1`, [s]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_subteam_members`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('CASCADE: deleting member removes assignments', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const s = await mkSubteam(db, t, e);
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(`INSERT INTO event_subteam_members (subteam_id, member_id) VALUES ($1, $2)`, [
      s,
      m,
    ]);
    await db.query(`DELETE FROM tenant_members WHERE id = $1`, [m]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_subteam_members`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('SET NULL: deleting added_by nulls it but keeps the assignment', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const s = await mkSubteam(db, t, e);
    const m = await mkMember(db, t, 'a@y.dev');
    const adder = await mkMember(db, t, 'adder@y.dev');
    await db.query(
      `INSERT INTO event_subteam_members (subteam_id, member_id, added_by) VALUES ($1, $2, $3)`,
      [s, m, adder],
    );
    await db.query(`DELETE FROM tenant_members WHERE id = $1`, [adder]);
    const r = await db.query<{ added_by: string | null }>(
      `SELECT added_by FROM event_subteam_members`,
    );
    expect(r.rows[0]!.added_by).toBeNull();
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e = await mkEvent(db, t);
    const s = await mkSubteam(db, t, e);
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(`INSERT INTO event_subteam_members (subteam_id, member_id) VALUES ($1, $2)`, [
      s,
      m,
    ]);
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ subteam_id: string }>(`SELECT subteam_id FROM event_subteam_members`))
          .rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ subteam_id: string }>(`SELECT subteam_id FROM event_subteam_members`))
          .rows.length,
    );
    expect(svc).toBe(1);
  });
});
