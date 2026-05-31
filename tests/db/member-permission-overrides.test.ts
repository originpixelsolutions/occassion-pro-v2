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

async function mkMember(
  db: TestDb,
  tenant: string,
  email: string,
  role = 'owner',
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role)
     VALUES ($1, $2, 'M', $3) RETURNING id`,
    [tenant, email, role],
  );
  return r.rows[0]!.id;
}

describe('member_permission_overrides — schema correctness (Phase 2 Unit 24)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts an explicit-grant override', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO member_permission_overrides (tenant_id, member_id, module, can_write)
       VALUES ($1, $2, 'events', TRUE)`,
      [t, m],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM member_permission_overrides`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('inserts an explicit-deny override', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO member_permission_overrides (tenant_id, member_id, module, can_delete)
       VALUES ($1, $2, 'budget', FALSE)`,
      [t, m],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM member_permission_overrides`)
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects a row where all four columns are NULL', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO member_permission_overrides (tenant_id, member_id, module)
       VALUES ($1, $2, 'events')`,
      [t, m],
    );
    expect(err).toMatch(/at_least_one|check/i);
  });

  it('rejects can_write=TRUE with can_read=FALSE (coherence)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO member_permission_overrides (tenant_id, member_id, module, can_read, can_write)
       VALUES ($1, $2, 'events', FALSE, TRUE)`,
      [t, m],
    );
    expect(err).toMatch(/write_coherent|check/i);
  });

  it('allows can_write=TRUE with can_read=NULL (inherit read from role)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO member_permission_overrides (tenant_id, member_id, module, can_write)
       VALUES ($1, $2, 'events', TRUE)`,
      [t, m],
    );
    const r = await db.query<{ can_read: boolean | null; can_write: boolean }>(
      `SELECT can_read, can_write FROM member_permission_overrides`,
    );
    expect(r.rows[0]!.can_read).toBeNull();
    expect(r.rows[0]!.can_write).toBe(true);
  });

  it('rejects bogus module', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO member_permission_overrides (tenant_id, member_id, module, can_read)
       VALUES ($1, $2, 'unicorns', TRUE)`,
      [t, m],
    );
    expect(err).toMatch(/module|check/i);
  });

  it('composite PK blocks duplicate (tenant, member, module)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO member_permission_overrides (tenant_id, member_id, module, can_read)
       VALUES ($1, $2, 'events', TRUE)`,
      [t, m],
    );
    const err = await tryExec(
      db,
      `INSERT INTO member_permission_overrides (tenant_id, member_id, module, can_read)
       VALUES ($1, $2, 'events', FALSE)`,
      [t, m],
    );
    expect(err).toMatch(/duplicate|primary key|unique/i);
  });

  it('different members can have different overrides on same module', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m1 = await mkMember(db, t, 'a@y.dev');
    const m2 = await mkMember(db, t, 'b@y.dev', 'team_lead');
    await db.query(
      `INSERT INTO member_permission_overrides (tenant_id, member_id, module, can_read) VALUES
         ($1, $2, 'events', TRUE),
         ($1, $3, 'events', FALSE)`,
      [t, m1, m2],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM member_permission_overrides`)
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting member removes its overrides', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO member_permission_overrides (tenant_id, member_id, module, can_read)
       VALUES ($1, $2, 'events', TRUE)`,
      [t, m],
    );
    await db.query(`DELETE FROM tenant_members WHERE id = $1`, [m]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM member_permission_overrides`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO member_permission_overrides (tenant_id, member_id, module, can_read)
       VALUES ($1, $2, 'events', TRUE)`,
      [t, m],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM member_permission_overrides`))
          .rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM member_permission_overrides`))
          .rows.length,
    );
    expect(svc).toBe(1);
  });
});
