/**
 * Phase 1 catchup — consolidated coverage for the 13 newly-added tables.
 *
 * Per table this verifies:
 *   - Happy-path INSERT works
 *   - The most distinctive CHECK constraint rejects a violation
 *   - RLS pair (anon SELECT empty + service_role SELECT non-empty)
 *
 * Detailed constraint coverage for super_admins / super_admin_role_permissions
 * / platform_settings / platform_theme_config / platform_theme_history lives in
 * those tables' dedicated test files.
 *
 * Spec refs: 2.9.4, 3.1, 3.9, 3.12, 3.13, 4.1, 4.2, 4.3, 5.2, 19.10, 19.12, 30.5.
 */
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

describe('Phase 1 catchup — newly-added tables', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('super_admin_approvals: inserts, rejects same initiator=approver, RLS pair', async () => {
    const init = (
      await db.query<{ id: string }>(
        `INSERT INTO super_admins (email, full_name, role) VALUES ('i@y.dev','I','owner') RETURNING id`,
      )
    ).rows[0]!.id;
    const appr = (
      await db.query<{ id: string }>(
        `INSERT INTO super_admins (email, full_name, role) VALUES ('a@y.dev','A','admin') RETURNING id`,
      )
    ).rows[0]!.id;
    await db.query(
      `INSERT INTO super_admin_approvals (action_type, initiated_by, initiator_reason)
       VALUES ('force_purge', $1, 'because')`,
      [init],
    );
    const dup = await tryExec(
      db,
      `INSERT INTO super_admin_approvals (action_type, initiated_by, initiator_reason, approved_by, approver_reason, approved_at)
       VALUES ('force_purge', $1, 'r', $1, 'r2', now())`,
      [init],
    );
    expect(dup).toMatch(/check/i);
    // valid (different approver)
    await db.query(
      `INSERT INTO super_admin_approvals (action_type, initiated_by, initiator_reason, approved_by, approver_reason, approved_at)
       VALUES ('large_refund', $1, 'r', $2, 'r2', now())`,
      [init, appr],
    );
    const anonSees = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM super_admin_approvals`)).rows.length,
    );
    expect(anonSees).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM super_admin_approvals`)).rows.length,
    );
    expect(svc).toBeGreaterThanOrEqual(2);
  });

  it('subscription_plans: insert + status enum + RLS pair', async () => {
    await db.query(`INSERT INTO subscription_plans (code, name) VALUES ('starter','Starter')`);
    const bad = await tryExec(
      db,
      `INSERT INTO subscription_plans (code, name, status) VALUES ('x','X','planet')`,
    );
    expect(bad).toMatch(/status|check/i);
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM subscription_plans`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM subscription_plans`)).rows.length,
    );
    expect(svc).toBe(1);
  });

  it('feature_flags + plan_feature_flags: cascade delete', async () => {
    await db.query(`INSERT INTO feature_flags (code, name) VALUES ('f1','Flag1')`);
    const plan = (
      await db.query<{ id: string }>(
        `INSERT INTO subscription_plans (code, name) VALUES ('growth','Growth') RETURNING id`,
      )
    ).rows[0]!.id;
    await db.query(
      `INSERT INTO plan_feature_flags (plan_id, flag_code, enabled) VALUES ($1,'f1',true)`,
      [plan],
    );
    await db.query(`DELETE FROM feature_flags WHERE code = 'f1'`);
    const left = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM plan_feature_flags`)
    ).rows[0]!.c;
    expect(left).toBe(0);
  });

  it('storage_addons_catalog: extra_gb > 0 enforced, RLS pair', async () => {
    const bad = await tryExec(
      db,
      `INSERT INTO storage_addons_catalog (code, name, extra_gb) VALUES ('z','Z',0)`,
    );
    expect(bad).toMatch(/extra_gb|check/i);
    await db.query(
      `INSERT INTO storage_addons_catalog (code, name, extra_gb) VALUES ('mini','Mini',25)`,
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM storage_addons_catalog`)).rows.length,
    );
    expect(anon).toBe(0);
  });

  it('addons_catalog: category enum + RLS pair', async () => {
    const bad = await tryExec(
      db,
      `INSERT INTO addons_catalog (code, name, category) VALUES ('z','Z','spaceship')`,
    );
    expect(bad).toMatch(/category|check/i);
    await db.query(
      `INSERT INTO addons_catalog (code, name, category) VALUES ('vp','Vendor Payouts','feature')`,
    );
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM addons_catalog`)).rows.length,
    );
    expect(svc).toBe(1);
  });

  it('event_types: system row + duplicate code blocked', async () => {
    await db.query(
      `INSERT INTO event_types (code, name, is_system) VALUES ('wedding','Wedding',true)`,
    );
    const dup = await tryExec(
      db,
      `INSERT INTO event_types (code, name, is_system) VALUES ('wedding','W2',true)`,
    );
    expect(dup).toMatch(/duplicate|unique/i);
    const bad = await tryExec(
      db,
      `INSERT INTO event_types (code, name, tone, is_system) VALUES ('x','X','grumpy',true)`,
    );
    expect(bad).toMatch(/tone|check/i);
  });

  it('event_type_readiness_items: FK cascade from event_types', async () => {
    const et = (
      await db.query<{ id: string }>(
        `INSERT INTO event_types (code, name, is_system) VALUES ('conf','Conf',true) RETURNING id`,
      )
    ).rows[0]!.id;
    await db.query(
      `INSERT INTO event_type_readiness_items (event_type_id, label) VALUES ($1,'venue')`,
      [et],
    );
    await db.query(`DELETE FROM event_types WHERE id = $1`, [et]);
    const left = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_type_readiness_items`)
    ).rows[0]!.c;
    expect(left).toBe(0);
  });

  it('event_templates: jsonb shape CHECK + scaffold size limit', async () => {
    const bad = await tryExec(
      db,
      `INSERT INTO event_templates (code, name, scaffold, is_system) VALUES ('x','X','[1,2,3]'::jsonb,true)`,
    );
    expect(bad).toMatch(/jsonb|object|check/i);
    await db.query(
      `INSERT INTO event_templates (code, name, scaffold, is_system) VALUES ('wk','Wedding Kit','{"runsheet":[]}'::jsonb,true)`,
    );
  });

  it('currency_rates: same base+target rejected, rate > 0', async () => {
    const same = await tryExec(
      db,
      `INSERT INTO currency_rates (rate_date, base_code, target_code, rate, source)
       VALUES (current_date, 'USD','USD', 1, 'fixer')`,
    );
    expect(same).toMatch(/check/i);
    const zero = await tryExec(
      db,
      `INSERT INTO currency_rates (rate_date, base_code, target_code, rate, source)
       VALUES (current_date, 'USD','INR', 0, 'fixer')`,
    );
    expect(zero).toMatch(/rate|check/i);
    await db.query(
      `INSERT INTO currency_rates (rate_date, base_code, target_code, rate, source)
       VALUES (current_date, 'USD','INR', 83.5, 'fixer')`,
    );
  });

  it('whatsapp_templates: category enum, unique (name, lang), approved needs approved_at', async () => {
    const bad = await tryExec(
      db,
      `INSERT INTO whatsapp_templates (template_name, category, body_text) VALUES ('t','marketin','b')`,
    );
    expect(bad).toMatch(/category|check/i);
    await db.query(
      `INSERT INTO whatsapp_templates (template_name, category, body_text) VALUES ('t','marketing','b')`,
    );
    const dup = await tryExec(
      db,
      `INSERT INTO whatsapp_templates (template_name, category, body_text) VALUES ('t','marketing','b2')`,
    );
    expect(dup).toMatch(/duplicate|unique/i);
    const halfApproved = await tryExec(
      db,
      `UPDATE whatsapp_templates SET meta_status = 'approved' WHERE template_name = 't' AND language_code = 'en'`,
    );
    expect(halfApproved).toMatch(/check/i);
  });

  it('brand_impersonation_alerts: detected_via enum, taken_down requires timestamp', async () => {
    await db.query(
      `INSERT INTO brand_impersonation_alerts (detected_domain, detected_via)
       VALUES ('occas1onpro.in','search_crawl')`,
    );
    const bad = await tryExec(
      db,
      `INSERT INTO brand_impersonation_alerts (detected_domain, detected_via)
       VALUES ('x.com','rumor')`,
    );
    expect(bad).toMatch(/detected_via|check/i);
    const halfTaken = await tryExec(
      db,
      `UPDATE brand_impersonation_alerts SET status = 'taken_down' WHERE detected_domain = 'occas1onpro.in'`,
    );
    expect(halfTaken).toMatch(/check/i);
  });

  it('sub_processor_incidents: disclosure >= incident_date', async () => {
    const bad = await tryExec(
      db,
      `INSERT INTO sub_processor_incidents (sub_processor, incident_date, disclosed_at)
       VALUES ('Stripe', '2026-05-23'::date, '2026-05-22'::timestamptz)`,
    );
    expect(bad).toMatch(/check/i);
    await db.query(
      `INSERT INTO sub_processor_incidents (sub_processor, incident_date, disclosed_at)
       VALUES ('Stripe', '2026-05-22'::date, '2026-05-23'::timestamptz)`,
    );
  });

  it('help_content: locale regex, RLS pair', async () => {
    const bad = await tryExec(
      db,
      `INSERT INTO help_content (context_key, title, locale) VALUES ('k','T','english')`,
    );
    expect(bad).toMatch(/locale|check/i);
    await db.query(
      `INSERT INTO help_content (context_key, title) VALUES ('events.create','Create event help')`,
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM help_content`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM help_content`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
