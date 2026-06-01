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

describe('onboarding_state — schema correctness (Phase 8 Unit 55)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid state', async () => {
    const t = await mkTenant(db, 'os-aaa');
    await db.query(
      `INSERT INTO onboarding_state (tenant_id, signup_completed_at, current_tour_step, current_tour_step_index, completion_percent)
       VALUES ($1, now(), 'welcome', 1, 14)`,
      [t],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM onboarding_state`)).rows[0]!.c,
    ).toBe(1);
  });

  it('PK = tenant_id: one row per tenant', async () => {
    const t = await mkTenant(db, 'os-bbb');
    await db.query(`INSERT INTO onboarding_state (tenant_id) VALUES ($1)`, [t]);
    const err = await tryExec(db, `INSERT INTO onboarding_state (tenant_id) VALUES ($1)`, [t]);
    expect(err).toMatch(/duplicate|primary/i);
  });

  it('rejects bad current_tour_step', async () => {
    const t = await mkTenant(db, 'os-ccc');
    const err = await tryExec(
      db,
      `INSERT INTO onboarding_state (tenant_id, current_tour_step) VALUES ($1, 'expert_mode')`,
      [t],
    );
    expect(err).toMatch(/tour_step_enum|check/i);
  });

  it('completed AND skipped both set rejected', async () => {
    const t = await mkTenant(db, 'os-ddd');
    const err = await tryExec(
      db,
      `INSERT INTO onboarding_state (tenant_id, tour_completed_at, tour_skipped_at) VALUES ($1, now(), now())`,
      [t],
    );
    expect(err).toMatch(/tour_terminal_xor|check/i);
  });

  it('template without timestamp rejected', async () => {
    const t = await mkTenant(db, 'os-eee');
    const err = await tryExec(
      db,
      `INSERT INTO onboarding_state (tenant_id, template_used) VALUES ($1, 'indian_wedding')`,
      [t],
    );
    expect(err).toMatch(/template_coupling|check/i);
  });

  it('demo_data_loaded=TRUE without timestamp rejected', async () => {
    const t = await mkTenant(db, 'os-fff');
    const err = await tryExec(
      db,
      `INSERT INTO onboarding_state (tenant_id, demo_data_loaded) VALUES ($1, TRUE)`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('completion_percent > 100 rejected', async () => {
    const t = await mkTenant(db, 'os-ggg');
    const err = await tryExec(
      db,
      `INSERT INTO onboarding_state (tenant_id, completion_percent) VALUES ($1, 110)`,
      [t],
    );
    expect(err).toMatch(/completion_range|check/i);
  });

  it('workspace_setup before signup rejected', async () => {
    const t = await mkTenant(db, 'os-hhh');
    const err = await tryExec(
      db,
      `INSERT INTO onboarding_state (tenant_id, signup_completed_at, workspace_setup_at)
       VALUES ($1, now(), now() - interval '1 hour')`,
      [t],
    );
    expect(err).toMatch(/check/i);
  });

  it('rejects array checklist_progress', async () => {
    const t = await mkTenant(db, 'os-iii');
    const err = await tryExec(
      db,
      `INSERT INTO onboarding_state (tenant_id, checklist_progress) VALUES ($1, '[]'::jsonb)`,
      [t],
    );
    expect(err).toMatch(/checklist_progress|check/i);
  });

  it('completed tour happy path', async () => {
    const t = await mkTenant(db, 'os-jjj');
    await db.query(
      `INSERT INTO onboarding_state (tenant_id, signup_completed_at, workspace_setup_at, first_event_created_at, tour_completed_at, current_tour_step_index, completion_percent, template_used, template_used_at)
       VALUES ($1, now() - interval '7 days', now() - interval '6 days', now() - interval '5 days', now() - interval '4 days', 7, 100, 'indian_wedding', now() - interval '5 days')`,
      [t],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM onboarding_state WHERE tour_completed_at IS NOT NULL`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'os-www');
    await db.query(`INSERT INTO onboarding_state (tenant_id) VALUES ($1)`, [t]);
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM onboarding_state`)).rows
          .length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ tenant_id: string }>(`SELECT tenant_id FROM onboarding_state`)).rows
          .length,
    );
    expect(svc).toBe(1);
  });
});
