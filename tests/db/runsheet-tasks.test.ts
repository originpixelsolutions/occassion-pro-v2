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
async function mkSubteam(db: TestDb, tenant: string, event: string, name = 'S'): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO event_subteams (tenant_id, event_id, name) VALUES ($1,$2,$3) RETURNING id`,
      [tenant, event, name],
    )
  ).rows[0]!.id;
}
async function mkTask(
  db: TestDb,
  t: string,
  e: string,
  title = 'T',
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const cols = ['tenant_id', 'event_id', 'title', ...Object.keys(overrides)];
  const vals = [t, e, title, ...Object.values(overrides)];
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
  return (
    await db.query<{ id: string }>(
      `INSERT INTO runsheet_tasks (${cols.join(',')}) VALUES (${placeholders}) RETURNING id`,
      vals,
    )
  ).rows[0]!.id;
}

describe('runsheet_tasks — schema correctness (Phase 3 Unit 26)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid pending task', async () => {
    const t = await mkTenant(db, 'rt-aaa');
    const e = await mkEvent(db, t);
    await mkTask(db, t, e, 'Setup PA system');
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM runsheet_tasks`)).rows[0]!.c,
    ).toBe(1);
  });

  it('rejects bad status', async () => {
    const t = await mkTenant(db, 'rt-bbb');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, status) VALUES ($1,$2,'T','spinning')`,
      [t, e],
    );
    expect(err).toMatch(/status|check/i);
  });

  it('rejects bad priority', async () => {
    const t = await mkTenant(db, 'rt-ccc');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, priority) VALUES ($1,$2,'T','ULTRA')`,
      [t, e],
    );
    expect(err).toMatch(/priority|check/i);
  });

  it('in_progress requires actual_start', async () => {
    const t = await mkTenant(db, 'rt-ddd');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, status) VALUES ($1,$2,'T','in_progress')`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('completed requires both actual_* timestamps', async () => {
    const t = await mkTenant(db, 'rt-eee');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, status, actual_start) VALUES ($1,$2,'T','completed', now())`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('blocked requires blocked_reason', async () => {
    const t = await mkTenant(db, 'rt-fff');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, status) VALUES ($1,$2,'T','blocked')`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('schedule order: end > start enforced', async () => {
    const t = await mkTenant(db, 'rt-ggg');
    const e = await mkEvent(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, scheduled_start, scheduled_end)
       VALUES ($1,$2,'T', now()+interval '2 hours', now()+interval '1 hour')`,
      [t, e],
    );
    expect(err).toMatch(/check/i);
  });

  it('no_self_dependency blocks task pointing at itself', async () => {
    const t = await mkTenant(db, 'rt-hhh');
    const e = await mkEvent(db, t);
    const task = await mkTask(db, t, e);
    const err = await tryExec(db, `UPDATE runsheet_tasks SET depends_on_id = id WHERE id = $1`, [
      task,
    ]);
    expect(err).toMatch(/self_dependency|cycle|check/i);
  });

  it('cycle: A->B, B->A rejected', async () => {
    const t = await mkTenant(db, 'rt-iii');
    const e = await mkEvent(db, t);
    const a = await mkTask(db, t, e, 'A');
    const b = await mkTask(db, t, e, 'B', { depends_on_id: a });
    const err = await tryExec(db, `UPDATE runsheet_tasks SET depends_on_id = $1 WHERE id = $2`, [
      b,
      a,
    ]);
    expect(err).toMatch(/cycle/i);
  });

  it('cross-tenant assignee rejected', async () => {
    const t1 = await mkTenant(db, 'rt-ttt');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'rt-uuu');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, assigned_to) VALUES ($1,$2,'T',$3)`,
      [t1, e1, mOther],
    );
    expect(err).toMatch(/assigned_to|tenant/i);
  });

  it('dependency from another event rejected', async () => {
    const t = await mkTenant(db, 'rt-vvv');
    const e1 = await mkEvent(db, t, 'evt-aaa');
    const e2 = await mkEvent(db, t, 'evt-bbb');
    const taskOnE2 = await mkTask(db, t, e2, 'T2');
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, depends_on_id) VALUES ($1,$2,'T',$3)`,
      [t, e1, taskOnE2],
    );
    expect(err).toMatch(/tenant\/event|does not match/i);
  });

  it('subteam from wrong event rejected', async () => {
    const t = await mkTenant(db, 'rt-www');
    const e1 = await mkEvent(db, t, 'evt-aaa');
    const e2 = await mkEvent(db, t, 'evt-bbb');
    const stOnE2 = await mkSubteam(db, t, e2, 'StageCrew');
    const err = await tryExec(
      db,
      `INSERT INTO runsheet_tasks (tenant_id, event_id, title, subteam_id) VALUES ($1,$2,'T',$3)`,
      [t, e1, stOnE2],
    );
    expect(err).toMatch(/subteam_id|tenant/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'rt-zzz');
    const e = await mkEvent(db, t);
    await mkTask(db, t, e);
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM runsheet_tasks`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM runsheet_tasks`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
