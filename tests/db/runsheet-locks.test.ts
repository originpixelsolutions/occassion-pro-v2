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
async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1,$2,'M','event_manager') RETURNING id`,
      [tenant, email],
    )
  ).rows[0]!.id;
}

describe('runsheet_locks — schema correctness (Phase 3 Unit 27)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid lock', async () => {
    const t = await mkTenant(db, 'rl-aaa');
    const e = await mkEvent(db, t);
    const m = await mkMember(db, t, 'm@y.dev');
    await db.query(
      `INSERT INTO runsheet_locks (event_id, tenant_id, locked_by, reason)
       VALUES ($1,$2,$3,'Publishing final runsheet')`,
      [e, t, m],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM runsheet_locks`)).rows[0]!.c,
    ).toBe(1);
  });

  it('PK = event_id: only one lock per event', async () => {
    const t = await mkTenant(db, 'rl-bbb');
    const e = await mkEvent(db, t);
    await db.query(`INSERT INTO runsheet_locks (event_id, tenant_id) VALUES ($1,$2)`, [e, t]);
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_locks (event_id, tenant_id) VALUES ($1,$2)`,
      [e, t],
    );
    expect(err).toMatch(/duplicate|primary/i);
  });

  it('rejects expires_at > 24h ahead', async () => {
    const t = await mkTenant(db, 'rl-ccc');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_locks (event_id, tenant_id, expires_at)
       VALUES ($1,$2, now() + interval '48 hours')`,
      [e, t],
    );
    expect(err).toMatch(/expiry_window|check/i);
  });

  it('rejects expires_at <= locked_at', async () => {
    const t = await mkTenant(db, 'rl-ddd');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_locks (event_id, tenant_id, expires_at)
       VALUES ($1,$2, now() - interval '1 minute')`,
      [e, t],
    );
    expect(err).toMatch(/expiry_window|check/i);
  });

  it('cross-tenant locker rejected', async () => {
    const t1 = await mkTenant(db, 'rl-ttt');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'rl-uuu');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_locks (event_id, tenant_id, locked_by) VALUES ($1,$2,$3)`,
      [e1, t1, mOther],
    );
    expect(err).toMatch(/locked_by|tenant/i);
  });

  it('cross-tenant event rejected', async () => {
    const t1 = await mkTenant(db, 'rl-vvv');
    const t2 = await mkTenant(db, 'rl-www');
    const e2 = await mkEvent(db, t2);
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_locks (event_id, tenant_id) VALUES ($1,$2)`,
      [e2, t1],
    );
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('lock release by DELETE allowed', async () => {
    const t = await mkTenant(db, 'rl-eee');
    const e = await mkEvent(db, t);
    await db.query(`INSERT INTO runsheet_locks (event_id, tenant_id) VALUES ($1,$2)`, [e, t]);
    await db.query(`DELETE FROM runsheet_locks WHERE event_id = $1`, [e]);
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM runsheet_locks`)).rows[0]!.c,
    ).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'rl-xxx');
    const e = await mkEvent(db, t);
    await db.query(`INSERT INTO runsheet_locks (event_id, tenant_id) VALUES ($1,$2)`, [e, t]);
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ event_id: string }>(`SELECT event_id FROM runsheet_locks`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ event_id: string }>(`SELECT event_id FROM runsheet_locks`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
