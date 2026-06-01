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

describe('whatsapp_templates — hardened correctness (Phase 8 Unit 51a)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid pending template', async () => {
    await db.query(
      `INSERT INTO whatsapp_templates (template_name, category, language_code, body_text, variables)
       VALUES ('rsvp_reminder_v2','transactional','en','Hi {{1}}, please RSVP for {{2}}', ARRAY['name','event'])`,
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM whatsapp_templates`)).rows[0]!
        .c,
    ).toBe(1);
  });

  it('rejects bad template_name (uppercase)', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO whatsapp_templates (template_name, category, body_text) VALUES ('RSVP_Reminder','transactional','body')`,
    );
    expect(err).toMatch(/name_fmt|check/i);
  });

  it('rejects bad language_code', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO whatsapp_templates (template_name, category, language_code, body_text) VALUES ('t1','transactional','english','body')`,
    );
    expect(err).toMatch(/language_fmt|check/i);
  });

  it('accepts en_US / en_GB language codes', async () => {
    await db.query(
      `INSERT INTO whatsapp_templates (template_name, category, language_code, body_text) VALUES ('greet_us','transactional','en_US','Hi')`,
    );
    await db.query(
      `INSERT INTO whatsapp_templates (template_name, category, language_code, body_text) VALUES ('greet_uk','transactional','en_GB','Hi')`,
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM whatsapp_templates`)).rows[0]!
        .c,
    ).toBe(2);
  });

  it('rejects bad meta_status', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO whatsapp_templates (template_name, category, body_text, meta_status) VALUES ('t1','transactional','b','frozen')`,
    );
    expect(err).toMatch(/meta_status|check/i);
  });

  it('approved requires approved_at + meta_template_id', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO whatsapp_templates (template_name, category, body_text, meta_status) VALUES ('t1','transactional','b','approved')`,
    );
    expect(err).toMatch(/approved_coupling|check/i);
  });

  it('rejected requires rejection_reason', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO whatsapp_templates (template_name, category, body_text, meta_status, rejected_at) VALUES ('t1','transactional','b','rejected', now())`,
    );
    expect(err).toMatch(/rejected_coupling|check/i);
  });

  it('disabled requires disabled_at + reason', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO whatsapp_templates (template_name, category, body_text, meta_status) VALUES ('t1','transactional','b','disabled')`,
    );
    expect(err).toMatch(/disabled_coupling|check/i);
  });

  it('rejects bad DLT template id (letters)', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO whatsapp_templates (template_name, category, body_text, dlt_template_id) VALUES ('t1','transactional','b','ABC123XYZ')`,
    );
    expect(err).toMatch(/dlt_template_fmt|check/i);
  });

  it('accepts valid 16-digit DLT template id', async () => {
    await db.query(
      `INSERT INTO whatsapp_templates (template_name, category, body_text, dlt_template_id, dlt_content_type) VALUES ('t1','transactional','b','1010101010101010','transactional')`,
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM whatsapp_templates`)).rows[0]!
        .c,
    ).toBe(1);
  });

  it('rejects array buttons > 10', async () => {
    const buttons = JSON.stringify(
      Array.from({ length: 11 }, (_, i) => ({ type: 'quick_reply', text: 'B' + i })),
    );
    const err = await tryExec(
      db,
      `INSERT INTO whatsapp_templates (template_name, category, body_text, buttons) VALUES ('t1','transactional','b', $1::jsonb)`,
      [buttons],
    );
    expect(err).toMatch(/buttons_shape|check/i);
  });

  it('rejects object buttons (must be array)', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO whatsapp_templates (template_name, category, body_text, buttons) VALUES ('t1','transactional','b','{"x":1}'::jsonb)`,
    );
    expect(err).toMatch(/buttons_shape|check/i);
  });

  it('approved happy path', async () => {
    await db.query(
      `INSERT INTO whatsapp_templates (template_name, category, body_text, meta_status, meta_template_id, submitted_at, approved_at)
       VALUES ('t1','transactional','b','approved','meta_abc123', now() - interval '1 hour', now())`,
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM whatsapp_templates WHERE meta_status='approved'`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('RLS pair', async () => {
    await db.query(
      `INSERT INTO whatsapp_templates (template_name, category, body_text) VALUES ('t1','transactional','b')`,
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM whatsapp_templates`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM whatsapp_templates`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
