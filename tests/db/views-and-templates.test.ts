import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../setup/pg.js';

describe('Phase 12 Unit 110 — views + event_templates', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('my_assigned_tasks view exists and is queryable', async () => {
    const r = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM my_assigned_tasks`);
    expect(typeof r.rows[0]!.c).toBe('number');
  });

  it('tenant_active_event_counts view exists and returns one row per tenant', async () => {
    const t1 = (
      await db.query<{ id: string }>(
        `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ('vt-a','A','INR') RETURNING id`,
      )
    ).rows[0]!.id;
    await db.query(
      `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ('vt-b','B','INR')`,
    );
    const r = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM tenant_active_event_counts WHERE tenant_id IN ('${t1}'::uuid)`,
    );
    expect(r.rows[0]!.c).toBe(1);
  });

  it('seeds 10 system event_templates', async () => {
    const r = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM event_templates WHERE is_system = TRUE`,
    );
    expect(r.rows[0]!.c).toBe(10);
  });

  it('each event_template links to a valid system event_type', async () => {
    const r = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM event_templates et JOIN event_types ety ON ety.id = et.event_type_id WHERE et.is_system = TRUE AND ety.is_system = TRUE`,
    );
    expect(r.rows[0]!.c).toBe(10);
  });
});
