import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}

describe('ensure_audit_log_partitions() (Phase 11 Unit 64)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('migration pre-created the rolling 12-month window', async () => {
    const r = await db.query<{ c: number }>(`
      SELECT count(*)::int AS c FROM pg_class
      WHERE relkind='r' AND relname LIKE 'audit_log_%'`);
    expect(r.rows[0]!.c).toBeGreaterThanOrEqual(13);
  });

  it('is idempotent: second call returns 0 new partitions', async () => {
    const r = await db.query<{ ensure_audit_log_partitions: number }>(
      `SELECT ensure_audit_log_partitions(12)`);
    expect(r.rows[0]!.ensure_audit_log_partitions).toBe(0);
  });

  it('extends the window: requesting 24 months creates the next 12', async () => {
    const r = await db.query<{ ensure_audit_log_partitions: number }>(
      `SELECT ensure_audit_log_partitions(24)`);
    expect(r.rows[0]!.ensure_audit_log_partitions).toBeGreaterThanOrEqual(11);
  });

  it('rejects out-of-bounds p_months_ahead', async () => {
    const err = await tryExec(db, `SELECT ensure_audit_log_partitions(0)`);
    expect(err).toMatch(/months_ahead|between/i);
    const err2 = await tryExec(db, `SELECT ensure_audit_log_partitions(61)`);
    expect(err2).toMatch(/months_ahead|between/i);
  });

  it('audit_log writes route to the rolling window correctly', async () => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 11);
    nextMonth.setDate(15);
    await db.query(
      `INSERT INTO audit_log (occurred_at, actor_type, action, resource_type)
       VALUES ($1, 'system', 'event.created', 'events')`, [nextMonth.toISOString()]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM audit_log`)).rows[0]!.c).toBe(1);
  });
});
