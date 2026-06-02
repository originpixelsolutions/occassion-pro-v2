import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenantId: string, uid: string, email: string, role = 'owner'): Promise<void> {
  await db.query(
    `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($1, $2, $3, 'M', $4)`,
    [uid, tenantId, email, role]);
}
async function mkVendor(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO vendor_accounts (email, company_name, contact_name, phone, password_hash, mfa_enabled, default_currency, failed_login_count)
     VALUES ($1, 'V Co', 'V', '+919999999999', '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX', FALSE, 'INR', 0) RETURNING id`,
    [email])).rows[0]!.id;
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on vendor_portfolios (Phase 12 Unit 101b)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('anon CAN read portfolios (public discovery)', async () => {
    const v = await mkVendor(db, 'v1@y.dev');
    await db.query(`INSERT INTO vendor_portfolios (vendor_account_id, slug, about_text, service_categories, service_regions) VALUES ($1, 'v-1', 'Wedding photographer', ARRAY['photography'], ARRAY['mumbai'])`, [v]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ vendor_account_id: string }>(`SELECT vendor_account_id FROM vendor_portfolios`)).rows.length);
    expect(n).toBe(1);
  });

  it('vendor can manage own portfolio', async () => {
    const v = await mkVendor(db, 'mine@y.dev');
    await setCtx(db, v, 'vendor', null);
    await asRole(db, 'authenticated');
    await db.query(`INSERT INTO vendor_portfolios (vendor_account_id, slug, about_text, service_categories, service_regions) VALUES ($1, 'v-mine', 'Self-managed', ARRAY['photography'], ARRAY['mumbai'])`, [v]);
    await asSuperuser(db);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_portfolios`)).rows[0]!.c).toBe(1);
  });

  it('vendor cannot create portfolio for another vendor', async () => {
    const me = await mkVendor(db, 'me@y.dev');
    const other = await mkVendor(db, 'other@y.dev');
    await setCtx(db, me, 'vendor', null);
    await asRole(db, 'authenticated');
    let err = '';
    try { await db.query(`INSERT INTO vendor_portfolios (vendor_account_id, slug, about_text, service_categories, service_regions) VALUES ($1, 'spoof', 'X', ARRAY['photography'], ARRAY['mumbai'])`, [other]); }
    catch (e) { err = e instanceof Error ? e.message : String(e); }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });
});

describe('RLS on vendor_invoice_templates (Phase 12 Unit 101c)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('tenant_member cannot see vendor invoice templates', async () => {
    const t = await mkTenant(db, 'vit-aaa');
    const v = await mkVendor(db, 'v@y.dev');
    await db.query(`INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type, template_html, is_active, is_default) VALUES ($1, 'Standard', 'html', '<html/>', TRUE, TRUE)`, [v]);
    const u = '00000000-0000-0000-0000-000000003400';
    await mkMember(db, t, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM vendor_invoice_templates`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(0);
  });

  it('vendor sees own templates', async () => {
    const v = await mkVendor(db, 'v@y.dev');
    await db.query(`INSERT INTO vendor_invoice_templates (vendor_account_id, name, template_type, template_html, is_active, is_default) VALUES ($1, 'Standard', 'html', '<html/>', TRUE, TRUE)`, [v]);
    await setCtx(db, v, 'vendor', null);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM vendor_invoice_templates`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });
});
