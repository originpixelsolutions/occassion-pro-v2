import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
const PW = '$argon2id$v=19$m=65536,t=3,p=4$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);
async function mkVendor(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO vendor_accounts (email, password_hash) VALUES ($1,$2) RETURNING id`, [email, PW])).rows[0]!.id;
}

describe('vendor_invoice_templates — schema correctness (Phase 4 Unit 42)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid HTML template', async () => {
    const v = await mkVendor(db, 'v1@y.dev');
    await db.query(
      `INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type, template_html, default_currency_code, is_default)
       VALUES ($1,'Standard Invoice','html','<html><body><h1>Invoice</h1></body></html>','INR', TRUE)`, [v]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_invoice_templates`)).rows[0]!.c).toBe(1);
  });

  it('inserts a valid PDF overlay', async () => {
    const v = await mkVendor(db, 'v2@y.dev');
    await db.query(
      `INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type, template_file_r2_key, template_file_size_bytes)
       VALUES ($1,'Letterhead PDF','pdf_overlay','vendors/abc/template.pdf', 524288)`, [v]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_invoice_templates`)).rows[0]!.c).toBe(1);
  });

  it('html type without template_html rejected', async () => {
    const v = await mkVendor(db, 'v3@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type) VALUES ($1,'X','html')`, [v]);
    expect(err).toMatch(/html|check/i);
  });

  it('pdf_overlay without r2_key rejected', async () => {
    const v = await mkVendor(db, 'v4@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type) VALUES ($1,'X','pdf_overlay')`, [v]);
    expect(err).toMatch(/file_requires_key|check/i);
  });

  it('docx without r2_key rejected', async () => {
    const v = await mkVendor(db, 'v5@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type) VALUES ($1,'X','docx')`, [v]);
    expect(err).toMatch(/file_requires_key|check/i);
  });

  it('rejects bad template_type', async () => {
    const v = await mkVendor(db, 'v6@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type, template_html) VALUES ($1,'X','markdown','# X')`, [v]);
    expect(err).toMatch(/type|check/i);
  });

  it('rejects bad sha256 hash', async () => {
    const v = await mkVendor(db, 'v7@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type, template_file_r2_key, template_file_hash_sha256)
       VALUES ($1,'X','pdf_overlay','vendors/x.pdf','NOT-A-HASH')`, [v]);
    expect(err).toMatch(/sha256|check/i);
  });

  it('rejects non-https default_logo_url', async () => {
    const v = await mkVendor(db, 'v8@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type, template_html, default_logo_url)
       VALUES ($1,'X','html','<html></html>','http://insecure/logo.png')`, [v]);
    expect(err).toMatch(/logo_url|check/i);
  });

  it('partial UNIQUE: only one default per vendor', async () => {
    const v = await mkVendor(db, 'v9@y.dev');
    await db.query(
      `INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type, template_html, is_default) VALUES ($1,'A','html','<html></html>', TRUE)`, [v]);
    const err = await tryExec(db,
      `INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type, template_html, is_default) VALUES ($1,'B','html','<html></html>', TRUE)`, [v]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('partial UNIQUE: case-fold name within vendor', async () => {
    const v = await mkVendor(db, 'va@y.dev');
    await db.query(
      `INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type, template_html) VALUES ($1,'Standard Invoice','html','<html></html>')`, [v]);
    const err = await tryExec(db,
      `INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type, template_html) VALUES ($1,'standard invoice','html','<html></html>')`, [v]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('retired with is_active=TRUE rejected', async () => {
    const v = await mkVendor(db, 'vb@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type, template_html, is_active, retired_at, retired_reason)
       VALUES ($1,'X','html','<html></html>', TRUE, now(), 'replaced')`, [v]);
    expect(err).toMatch(/active_retired|check/i);
  });

  it('RLS pair', async () => {
    const v = await mkVendor(db, 'vw@y.dev');
    await db.query(`INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type, template_html) VALUES ($1,'X','html','<html></html>')`, [v]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM vendor_invoice_templates`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM vendor_invoice_templates`)).rows.length);
    expect(svc).toBe(1);
  });
});
