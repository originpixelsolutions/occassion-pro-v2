import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
async function mkSuperAdmin(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO super_admins (email, role, full_name) VALUES ($1,'owner','SA') RETURNING id`, [email])).rows[0]!.id;
}

describe('support_faqs — schema correctness (Phase 10 Unit 59)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid FAQ', async () => {
    await db.query(
      `INSERT INTO support_faqs (question_pattern, answer, category, tags, audience)
       VALUES ('How do I refund a payment?','Open the payment, click Refund...', 'payments', ARRAY['refund','razorpay'], 'tenant_member')`);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM support_faqs`)).rows[0]!.c).toBe(1);
  });

  it('rejects bad category', async () => {
    const err = await tryExec(db,
      `INSERT INTO support_faqs (question_pattern, answer, category) VALUES ('q','a','widgets')`);
    expect(err).toMatch(/category_enum|check/i);
  });

  it('rejects bad audience', async () => {
    const err = await tryExec(db,
      `INSERT INTO support_faqs (question_pattern, answer, audience) VALUES ('q','a','intern')`);
    expect(err).toMatch(/audience_enum|check/i);
  });

  it('rejects bad visibility', async () => {
    const err = await tryExec(db,
      `INSERT INTO support_faqs (question_pattern, answer, visibility) VALUES ('q','a','secret')`);
    expect(err).toMatch(/visibility_enum|check/i);
  });

  it('rejects bad language_code', async () => {
    const err = await tryExec(db,
      `INSERT INTO support_faqs (question_pattern, answer, language_code) VALUES ('q','a','english')`);
    expect(err).toMatch(/language_code|check/i);
  });

  it('active_retired_coupling: is_active=TRUE + retired_at rejected', async () => {
    const err = await tryExec(db,
      `INSERT INTO support_faqs (question_pattern, answer, is_active, retired_at, retired_reason)
       VALUES ('q','a', TRUE, now(),'replaced')`);
    expect(err).toMatch(/active_retired_coupling|check/i);
  });

  it('retired_at without reason rejected', async () => {
    const err = await tryExec(db,
      `INSERT INTO support_faqs (question_pattern, answer, is_active, retired_at)
       VALUES ('q','a', FALSE, now())`);
    expect(err).toMatch(/check/i);
  });

  it('review_coupling: last_reviewed_at without by rejected', async () => {
    const err = await tryExec(db,
      `INSERT INTO support_faqs (question_pattern, answer, last_reviewed_at) VALUES ('q','a', now())`);
    expect(err).toMatch(/review_coupling|check/i);
  });

  it('GIN index: tags searchable', async () => {
    await db.query(`INSERT INTO support_faqs (question_pattern, answer, tags) VALUES ('q','a', ARRAY['refund','payment'])`);
    const r = await db.query<{ id: string }>(`SELECT id FROM support_faqs WHERE tags && ARRAY['refund']`);
    expect(r.rows).toHaveLength(1);
  });

  it('rejects non-https source_url', async () => {
    const err = await tryExec(db,
      `INSERT INTO support_faqs (question_pattern, answer, source_url) VALUES ('q','a','http://insecure/x')`);
    expect(err).toMatch(/source_url|check/i);
  });

  it('review happy path with super_admin', async () => {
    const sa = await mkSuperAdmin(db, 'sa@y.dev');
    await db.query(
      `INSERT INTO support_faqs (question_pattern, answer, last_reviewed_at, last_reviewed_by)
       VALUES ('q','a', now(), $1)`, [sa]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM support_faqs WHERE last_reviewed_by IS NOT NULL`)).rows[0]!.c).toBe(1);
  });

  it('RLS pair', async () => {
    await db.query(`INSERT INTO support_faqs (question_pattern, answer) VALUES ('q','a')`);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM support_faqs`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM support_faqs`)).rows.length);
    expect(svc).toBe(1);
  });
});
