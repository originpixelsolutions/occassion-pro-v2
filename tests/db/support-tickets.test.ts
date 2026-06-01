import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkSuperAdmin(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO super_admins (email, role, full_name) VALUES ($1,'owner','SA') RETURNING id`, [email])).rows[0]!.id;
}
async function mkFaq(db: TestDb): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO support_faqs (question_pattern, answer) VALUES ('q','a') RETURNING id`)).rows[0]!.id;
}

describe('support_tickets — schema correctness (Phase 10 Unit 60)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid open ticket', async () => {
    const t = await mkTenant(db, 'st-aaa');
    await db.query(
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject, category, priority)
       VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'Cant export', 'exports', 'high')`, [t]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM support_tickets`)).rows[0]!.c).toBe(1);
  });

  it('rejects bad ticket_number format', async () => {
    const t = await mkTenant(db, 'st-bbb');
    const err = await tryExec(db,
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject)
       VALUES ('xyz-001', $1, gen_random_uuid(), 'tenant_member', 'S')`, [t]);
    expect(err).toMatch(/ticket_number|check/i);
  });

  it('UNIQUE ticket_number blocks dupe', async () => {
    const t = await mkTenant(db, 'st-ccc');
    await db.query(`INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject) VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'S')`, [t]);
    const err = await tryExec(db,
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject) VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'S')`, [t]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('bot_handled requires both bot fields', async () => {
    const t = await mkTenant(db, 'st-ddd');
    const err = await tryExec(db,
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject, status)
       VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'S', 'bot_handled')`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('escalated requires reason', async () => {
    const t = await mkTenant(db, 'st-eee');
    const err = await tryExec(db,
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject, status, escalated_at)
       VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'S', 'escalated', now())`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('resolved requires resolved_at + resolved_by + summary', async () => {
    const t = await mkTenant(db, 'st-fff');
    const err = await tryExec(db,
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject, status, resolved_at)
       VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'S', 'resolved', now())`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('reopened requires reopened_at + reason', async () => {
    const t = await mkTenant(db, 'st-ggg');
    const err = await tryExec(db,
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject, status)
       VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'S', 'reopened')`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('assigned_at without assigned_to rejected', async () => {
    const t = await mkTenant(db, 'st-hhh');
    const err = await tryExec(db,
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject, assigned_at)
       VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'S', now())`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('rating > 5 rejected', async () => {
    const t = await mkTenant(db, 'st-iii');
    const err = await tryExec(db,
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject, satisfaction_rating)
       VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'S', 6)`, [t]);
    expect(err).toMatch(/rating|check/i);
  });

  it('satisfaction without resolved_at rejected', async () => {
    const t = await mkTenant(db, 'st-jjj');
    const err = await tryExec(db,
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject, satisfaction_rating, satisfaction_submitted_at)
       VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'S', 5, now())`, [t]);
    expect(err).toMatch(/check/i);
  });

  it('rejects object messages (must be array)', async () => {
    const t = await mkTenant(db, 'st-kkk');
    const err = await tryExec(db,
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject, messages)
       VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'S', '{}'::jsonb)`, [t]);
    expect(err).toMatch(/messages|check/i);
  });

  it('resolved happy path', async () => {
    const t = await mkTenant(db, 'st-lll');
    const sa = await mkSuperAdmin(db, 'sa@y.dev');
    await db.query(
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject, status, resolved_at, resolved_by, resolution_summary)
       VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'Export issue', 'resolved', now(), $2, 'Cleared cache, export works.')`, [t, sa]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM support_tickets WHERE status='resolved'`)).rows[0]!.c).toBe(1);
  });

  it('bot_handled happy path with FAQ', async () => {
    const t = await mkTenant(db, 'st-mmm');
    const f = await mkFaq(db);
    await db.query(
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject, status, bot_handled_at, bot_handled_faq_id)
       VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'Refund Qs', 'bot_handled', now(), $2)`, [t, f]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM support_tickets WHERE status='bot_handled'`)).rows[0]!.c).toBe(1);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'st-www');
    await db.query(
      `INSERT INTO support_tickets (ticket_number, tenant_id, user_id, user_type, subject) VALUES ('OCP-1001', $1, gen_random_uuid(), 'tenant_member', 'S')`, [t]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM support_tickets`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM support_tickets`)).rows.length);
    expect(svc).toBe(1);
  });
});
