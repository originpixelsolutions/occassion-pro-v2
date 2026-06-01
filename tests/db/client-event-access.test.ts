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
async function mkClient(db: TestDb, email: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO client_accounts (email, password_hash) VALUES ($1,$2) RETURNING id`,
      [email, PW],
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

describe('client_event_access — schema correctness (Phase 4 Unit 41)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid access row', async () => {
    const t = await mkTenant(db, 'cea-aaa');
    const e = await mkEvent(db, t);
    const c = await mkClient(db, 'c1@y.dev');
    const m = await mkMember(db, t, 'm@y.dev');
    await db.query(
      `INSERT INTO client_event_access (client_account_id, tenant_id, event_id, role, invited_by)
       VALUES ($1,$2,$3,'primary',$4)`,
      [c, t, e, m],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM client_event_access`)).rows[0]!
        .c,
    ).toBe(1);
  });

  it('UNIQUE (client, event) blocks dupe', async () => {
    const t = await mkTenant(db, 'cea-bbb');
    const e = await mkEvent(db, t);
    const c = await mkClient(db, 'c2@y.dev');
    await db.query(
      `INSERT INTO client_event_access (client_account_id, tenant_id, event_id) VALUES ($1,$2,$3)`,
      [c, t, e],
    );
    const err = await tryExec(
      db,
      `INSERT INTO client_event_access (client_account_id, tenant_id, event_id) VALUES ($1,$2,$3)`,
      [c, t, e],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('same client across TWO events allowed', async () => {
    const t = await mkTenant(db, 'cea-ccc');
    const e1 = await mkEvent(db, t, 'evt-aaa');
    const e2 = await mkEvent(db, t, 'evt-bbb');
    const c = await mkClient(db, 'c3@y.dev');
    await db.query(
      `INSERT INTO client_event_access (client_account_id, tenant_id, event_id) VALUES ($1,$2,$3)`,
      [c, t, e1],
    );
    await db.query(
      `INSERT INTO client_event_access (client_account_id, tenant_id, event_id) VALUES ($1,$2,$3)`,
      [c, t, e2],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM client_event_access WHERE client_account_id=$1`,
          [c],
        )
      ).rows[0]!.c,
    ).toBe(2);
  });

  it('rejects bad role', async () => {
    const t = await mkTenant(db, 'cea-ddd');
    const e = await mkEvent(db, t);
    const c = await mkClient(db, 'c4@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO client_event_access (client_account_id, tenant_id, event_id, role) VALUES ($1,$2,$3,'admin')`,
      [c, t, e],
    );
    expect(err).toMatch(/role|check/i);
  });

  it('rejects array permissions', async () => {
    const t = await mkTenant(db, 'cea-eee');
    const e = await mkEvent(db, t);
    const c = await mkClient(db, 'c5@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO client_event_access (client_account_id, tenant_id, event_id, permissions) VALUES ($1,$2,$3,'[]'::jsonb)`,
      [c, t, e],
    );
    expect(err).toMatch(/permissions|check/i);
  });

  it('revoke requires revoked_by + reason', async () => {
    const t = await mkTenant(db, 'cea-fff');
    const e = await mkEvent(db, t);
    const c = await mkClient(db, 'c6@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO client_event_access (client_account_id, tenant_id, event_id, revoked_at) VALUES ($1,$2,$3, now())`,
      [c, t, e],
    );
    expect(err).toMatch(/revoke_coupling|check/i);
  });

  it('revoke happy path', async () => {
    const t = await mkTenant(db, 'cea-ggg');
    const e = await mkEvent(db, t);
    const c = await mkClient(db, 'c7@y.dev');
    const m = await mkMember(db, t, 'r@y.dev');
    await db.query(
      `INSERT INTO client_event_access (client_account_id, tenant_id, event_id, revoked_at, revoked_by, revoked_reason)
       VALUES ($1,$2,$3, now(), $4, 'client left engagement')`,
      [c, t, e, m],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM client_event_access WHERE revoked_at IS NOT NULL`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('accepted before invited rejected', async () => {
    const t = await mkTenant(db, 'cea-hhh');
    const e = await mkEvent(db, t);
    const c = await mkClient(db, 'c8@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO client_event_access (client_account_id, tenant_id, event_id, invited_at, accepted_at)
       VALUES ($1,$2,$3, now(), now() - interval '1 hour')`,
      [c, t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('cross-tenant inviter rejected', async () => {
    const t1 = await mkTenant(db, 'cea-ttt');
    const e1 = await mkEvent(db, t1);
    const c = await mkClient(db, 'c9@y.dev');
    const t2 = await mkTenant(db, 'cea-uuu');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO client_event_access (client_account_id, tenant_id, event_id, invited_by) VALUES ($1,$2,$3,$4)`,
      [c, t1, e1, mOther],
    );
    expect(err).toMatch(/invited_by|tenant/i);
  });

  it('cross-tenant event rejected', async () => {
    const t1 = await mkTenant(db, 'cea-vvv');
    const t2 = await mkTenant(db, 'cea-www');
    const e2 = await mkEvent(db, t2);
    const c = await mkClient(db, 'ca@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO client_event_access (client_account_id, tenant_id, event_id) VALUES ($1,$2,$3)`,
      [c, t1, e2],
    );
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'cea-xxx');
    const e = await mkEvent(db, t);
    const c = await mkClient(db, 'cw@y.dev');
    await db.query(
      `INSERT INTO client_event_access (client_account_id, tenant_id, event_id) VALUES ($1,$2,$3)`,
      [c, t, e],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM client_event_access`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM client_event_access`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
