import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}
const PW = '$argon2id$v=19$m=65536,t=3,p=4$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);
async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenant: string, code='evt-001'): Promise<string> {
  const ty = (await db.query<{ id: string }>(
    `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'W', FALSE) RETURNING id`, [tenant])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`, [tenant, ty, code])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1,$2,'M','event_manager') RETURNING id`, [tenant, email])).rows[0]!.id;
}
async function mkClient(db: TestDb, email: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO client_accounts (email, password_hash) VALUES ($1, $2) RETURNING id`, [email, PW])).rows[0]!.id;
}

describe('client_documents — schema correctness (Phase 3 Unit 36)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid draft', async () => {
    const t = await mkTenant(db, 'cd-aaa');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO client_documents (tenant_id, event_id, document_type, document_name, r2_key)
       VALUES ($1,$2,'contract','Service Contract v1','tenants/x/contracts/abc.pdf')`, [t, e]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM client_documents`)).rows[0]!.c).toBe(1);
  });

  it('rejects bad document_type', async () => {
    const t = await mkTenant(db, 'cd-bbb');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO client_documents (tenant_id, event_id, document_type, document_name, r2_key)
       VALUES ($1,$2,'manifesto','X','tenants/x/y.pdf')`, [t, e]);
    expect(err).toMatch(/type|check/i);
  });

  it('sent requires sent_at + client + provider + envelope', async () => {
    const t = await mkTenant(db, 'cd-ccc');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO client_documents (tenant_id, event_id, document_type, document_name, r2_key, signature_status)
       VALUES ($1,$2,'contract','X','tenants/x/y.pdf','sent')`, [t, e]);
    expect(err).toMatch(/check/i);
  });

  it('signed requires sent_at AND signed_at AND signed_r2_key', async () => {
    const t = await mkTenant(db, 'cd-ddd');
    const e = await mkEvent(db, t);
    const c = await mkClient(db, 'cl1@y.dev');
    const err = await tryExec(db,
      `INSERT INTO client_documents (tenant_id, event_id, client_account_id, document_type, document_name, r2_key, signature_provider, signature_envelope_id, signature_status, sent_at, signed_at)
       VALUES ($1,$2,$3,'contract','X','tenants/x/y.pdf','docusign','ENV-1','signed', now() - interval '2 hours', now())`, [t, e, c]);
    expect(err).toMatch(/check/i);
  });

  it('voided requires voided_at + reason + by', async () => {
    const t = await mkTenant(db, 'cd-eee');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO client_documents (tenant_id, event_id, document_type, document_name, r2_key, signature_provider, signature_status)
       VALUES ($1,$2,'contract','X','tenants/x/y.pdf','docusign','voided')`, [t, e]);
    expect(err).toMatch(/check/i);
  });

  it('rejects bad file_hash_sha256', async () => {
    const t = await mkTenant(db, 'cd-fff');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO client_documents (tenant_id, event_id, document_type, document_name, r2_key, file_hash_sha256)
       VALUES ($1,$2,'contract','X','tenants/x/y.pdf','NOT-A-HASH')`, [t, e]);
    expect(err).toMatch(/file_hash|check/i);
  });

  it('rejects array signature_audit_trail', async () => {
    const t = await mkTenant(db, 'cd-ggg');
    const e = await mkEvent(db, t);
    const err = await tryExec(db,
      `INSERT INTO client_documents (tenant_id, event_id, document_type, document_name, r2_key, signature_audit_trail)
       VALUES ($1,$2,'contract','X','tenants/x/y.pdf','[]'::jsonb)`, [t, e]);
    expect(err).toMatch(/audit_trail|check/i);
  });

  it('signed happy path', async () => {
    const t = await mkTenant(db, 'cd-hhh');
    const e = await mkEvent(db, t);
    const c = await mkClient(db, 'cl2@y.dev');
    const m = await mkMember(db, t, 'm@y.dev');
    await db.query(
      `INSERT INTO client_documents (tenant_id, event_id, client_account_id, document_type, document_name, r2_key, signed_r2_key, signature_provider, signature_envelope_id, signature_status, sent_at, signed_at, signature_audit_trail, created_by)
       VALUES ($1,$2,$3,'contract','Service Contract','tenants/x/c.pdf','tenants/x/c.signed.pdf','docusign','DS-ENV-001','signed', now() - interval '2 hours', now() - interval '1 hour', '{"ip":"1.2.3.4"}'::jsonb, $4)`,
      [t, e, c, m]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM client_documents WHERE signature_status='signed'`)).rows[0]!.c).toBe(1);
  });

  it('cross-tenant voider rejected', async () => {
    const t1 = await mkTenant(db, 'cd-ttt');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'cd-uuu');
    const mOther = await mkMember(db, t2, 'o@y.dev');
    const err = await tryExec(db,
      `INSERT INTO client_documents (tenant_id, event_id, document_type, document_name, r2_key, signature_provider, signature_status, voided_at, voided_reason, voided_by)
       VALUES ($1,$2,'contract','X','tenants/x/y.pdf','docusign','voided', now(), 'mistake', $3)`, [t1, e1, mOther]);
    expect(err).toMatch(/voided_by|tenant/i);
  });

  it('cross-tenant event rejected', async () => {
    const t1 = await mkTenant(db, 'cd-vvv');
    const t2 = await mkTenant(db, 'cd-www');
    const e2 = await mkEvent(db, t2);
    const err = await tryExec(db,
      `INSERT INTO client_documents (tenant_id, event_id, document_type, document_name, r2_key)
       VALUES ($1,$2,'contract','X','tenants/x/y.pdf')`, [t1, e2]);
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'cd-xxx');
    const e = await mkEvent(db, t);
    await db.query(
      `INSERT INTO client_documents (tenant_id, event_id, document_type, document_name, r2_key)
       VALUES ($1,$2,'contract','X','tenants/x/y.pdf')`, [t, e]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM client_documents`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM client_documents`)).rows.length);
    expect(svc).toBe(1);
  });
});
