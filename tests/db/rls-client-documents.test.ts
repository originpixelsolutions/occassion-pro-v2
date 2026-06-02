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
async function mkEvent(db: TestDb, tenantId: string, code: string): Promise<string> {
  const etId = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, 'w-' || $2, 'W', FALSE) RETURNING id`,
    [tenantId, code])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1, $2, $3, 'E', '2026-12-01', '2026-12-03', 'INR') RETURNING id`, [tenantId, etId, code])).rows[0]!.id;
}
async function mkClient(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO client_accounts (email, password_hash, mfa_enabled, failed_login_count) VALUES ($1, '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX', FALSE, 0) RETURNING id`,
    [email])).rows[0]!.id;
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on client_documents (Phase 12 Unit 103)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('tenant_member sees own tenant docs only', async () => {
    const t1 = await mkTenant(db, 'cd-aaa');
    const t2 = await mkTenant(db, 'cd-bbb');
    const e1 = await mkEvent(db, t1, 'e-a');
    const e2 = await mkEvent(db, t2, 'e-b');
    await db.query(`INSERT INTO client_documents (tenant_id, event_id, document_type, document_name, r2_key, signature_status, reminder_count) VALUES ($1, $2, 'contract', 'A', 'k/a', 'draft', 0)`, [t1, e1]);
    await db.query(`INSERT INTO client_documents (tenant_id, event_id, document_type, document_name, r2_key, signature_status, reminder_count) VALUES ($1, $2, 'contract', 'B', 'k/b', 'draft', 0)`, [t2, e2]);
    const u = '00000000-0000-0000-0000-000000003500';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const names = (await db.query<{ document_name: string }>(`SELECT document_name FROM client_documents`)).rows.map(r => r.document_name);
    await asSuperuser(db);
    expect(names).toEqual(['A']);
  });

  it('anon sees zero', async () => {
    const t = await mkTenant(db, 'cd-ccc');
    const e = await mkEvent(db, t, 'e-c');
    await db.query(`INSERT INTO client_documents (tenant_id, event_id, document_type, document_name, r2_key, signature_status, reminder_count) VALUES ($1, $2, 'contract', 'X', 'k/x', 'draft', 0)`, [t, e]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM client_documents`)).rows.length);
    expect(n).toBe(0);
  });

  it('client sees only own documents', async () => {
    const t = await mkTenant(db, 'cd-ddd');
    const e = await mkEvent(db, t, 'e-d');
    const c1 = await mkClient(db, 'c1@y.dev');
    const c2 = await mkClient(db, 'c2@y.dev');
    await db.query(`INSERT INTO client_documents (tenant_id, event_id, client_account_id, document_type, document_name, r2_key, signature_status, reminder_count) VALUES ($1, $2, $3, 'contract', 'mine', 'k/m', 'draft', 0)`, [t, e, c1]);
    await db.query(`INSERT INTO client_documents (tenant_id, event_id, client_account_id, document_type, document_name, r2_key, signature_status, reminder_count) VALUES ($1, $2, $3, 'contract', 'other', 'k/o', 'draft', 0)`, [t, e, c2]);
    await setCtx(db, c1, 'client', null);
    await asRole(db, 'authenticated');
    const names = (await db.query<{ document_name: string }>(`SELECT document_name FROM client_documents`)).rows.map(r => r.document_name);
    await asSuperuser(db);
    expect(names).toEqual(['mine']);
  });
});
