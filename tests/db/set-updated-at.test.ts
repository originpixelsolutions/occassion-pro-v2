import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../setup/pg.js';

async function mkTenant(db: TestDb, slug: string): Promise<{ id: string; updated_at: string }> {
  return (await db.query<{ id: string; updated_at: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id, updated_at`,
    [slug])).rows[0]!;
}

describe('set_updated_at() trigger — auto-bump updated_at on mutation (Phase 11 Unit 63)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('bumps updated_at when a real change happens', async () => {
    const t = await mkTenant(db, 'sua-aaa');
    // tiny wait then update
    await db.query(`SELECT pg_sleep(0.05)`);
    await db.query(`UPDATE tenants SET company_name = 'Acme 2' WHERE id = $1`, [t.id]);
    const after = (await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM tenants WHERE id = $1`, [t.id])).rows[0]!.updated_at;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(t.updated_at).getTime());
  });

  it('updates updated_at to >= old value (monotonic)', async () => {
    const t = await mkTenant(db, 'sua-bbb');
    await db.query(`UPDATE tenants SET company_name = 'Acme' WHERE id = $1`, [t.id]);
    const after = (await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM tenants WHERE id = $1`, [t.id])).rows[0]!.updated_at;
    // monotonic: never goes backwards
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(t.updated_at).getTime());
  });

  it('attached to every table with updated_at (sample check)', async () => {
    const r = await db.query<{ c: number }>(`
      SELECT count(*)::int AS c FROM information_schema.triggers
      WHERE trigger_schema='public'
        AND trigger_name LIKE 'trg_%_set_updated_at'`);
    expect(r.rows[0]!.c).toBeGreaterThan(40);
  });

  it('audit_log does NOT get the trigger (append-only)', async () => {
    const r = await db.query<{ c: number }>(`
      SELECT count(*)::int AS c FROM information_schema.triggers
      WHERE trigger_schema='public'
        AND event_object_table='audit_log'
        AND trigger_name = 'trg_audit_log_set_updated_at'`);
    expect(r.rows[0]!.c).toBe(0);
  });
});
