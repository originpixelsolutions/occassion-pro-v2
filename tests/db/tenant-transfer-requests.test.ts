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
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency)
     VALUES ($1, 'Acme', 'INR') RETURNING id`,
    [slug],
  );
  return r.rows[0]!.id;
}

async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenant_members (tenant_id, email, full_name, role)
     VALUES ($1, $2, 'M', 'owner') RETURNING id`,
    [tenant, email],
  );
  return r.rows[0]!.id;
}

async function mkAdmin(db: TestDb, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO super_admins (email, full_name, role) VALUES ($1, 'A', 'owner') RETURNING id`,
    [email],
  );
  return r.rows[0]!.id;
}

describe('tenant_transfer_requests — schema correctness (Phase 2 Unit 15)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid request (default status requested)', async () => {
    const s = await mkTenant(db, 'src-co');
    const tg = await mkTenant(db, 'tgt-co');
    const m = await mkMember(db, s, 'o@y.dev');
    await db.query(
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope)
       VALUES ($1, $2, $3, '{"events": true}'::jsonb)`,
      [s, tg, m],
    );
    const r = await db.query<{ status: string }>(`SELECT status FROM tenant_transfer_requests`);
    expect(r.rows[0]!.status).toBe('requested');
  });

  it('rejects source = target', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'o@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope)
       VALUES ($1, $1, $2, '{}'::jsonb)`,
      [t, m],
    );
    expect(err).toMatch(/source_target_differ|check/i);
  });

  it('rejects non-object scope (jsonb array)', async () => {
    const s = await mkTenant(db, 'src-co');
    const tg = await mkTenant(db, 'tgt-co');
    const m = await mkMember(db, s, 'o@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope)
       VALUES ($1, $2, $3, '[1,2,3]'::jsonb)`,
      [s, tg, m],
    );
    expect(err).toMatch(/jsonb|check/i);
  });

  it('rejects http (non-https) legal_documents_url', async () => {
    const s = await mkTenant(db, 'src-co');
    const tg = await mkTenant(db, 'tgt-co');
    const m = await mkMember(db, s, 'o@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope, legal_documents_url)
       VALUES ($1, $2, $3, '{}'::jsonb, 'http://insecure/contract.pdf')`,
      [s, tg, m],
    );
    expect(err).toMatch(/https|check/i);
  });

  it("rejects 'target_confirmed' without target_confirmed_by", async () => {
    const s = await mkTenant(db, 'src-co');
    const tg = await mkTenant(db, 'tgt-co');
    const m = await mkMember(db, s, 'o@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope, status)
       VALUES ($1, $2, $3, '{}'::jsonb, 'target_confirmed')`,
      [s, tg, m],
    );
    expect(err).toMatch(/check/i);
  });

  it("rejects 'admin_approved' without all three prereqs", async () => {
    const s = await mkTenant(db, 'src-co');
    const tg = await mkTenant(db, 'tgt-co');
    const m = await mkMember(db, s, 'o@y.dev');
    const ma = await mkMember(db, tg, 'tgt@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope, status, target_confirmed_by)
       VALUES ($1, $2, $3, '{}'::jsonb, 'admin_approved', $4)`,
      [s, tg, m, ma],
    );
    expect(err).toMatch(/check/i);
  });

  it("rejects 'failed' without started_at + completed_at + error_message", async () => {
    const s = await mkTenant(db, 'src-co');
    const tg = await mkTenant(db, 'tgt-co');
    const m = await mkMember(db, s, 'o@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope, status)
       VALUES ($1, $2, $3, '{}'::jsonb, 'failed')`,
      [s, tg, m],
    );
    expect(err).toMatch(/check/i);
  });

  it('happy path through to completed', async () => {
    const s = await mkTenant(db, 'src-co');
    const tg = await mkTenant(db, 'tgt-co');
    const m = await mkMember(db, s, 'o@y.dev');
    const tm = await mkMember(db, tg, 'tgt@y.dev');
    const ad = await mkAdmin(db, 'admin@y.dev');
    await db.query(
      `INSERT INTO tenant_transfer_requests (
         source_tenant_id, target_tenant_id, initiated_by, scope,
         target_confirmed_by, approved_by_admin, legal_documents_url,
         status, started_at, completed_at
       ) VALUES (
         $1, $2, $3, '{}'::jsonb,
         $4, $5, 'https://r2.example/ma-contract.pdf',
         'completed', now() - interval '1 hour', now()
       )`,
      [s, tg, m, tm, ad],
    );
    const r = await db.query<{ status: string }>(`SELECT status FROM tenant_transfer_requests`);
    expect(r.rows[0]!.status).toBe('completed');
  });

  it('partial UNIQUE blocks a second active transfer for same source', async () => {
    const s = await mkTenant(db, 'src-co');
    const tg1 = await mkTenant(db, 'tgt1-co');
    const tg2 = await mkTenant(db, 'tgt2-co');
    const m = await mkMember(db, s, 'o@y.dev');
    await db.query(
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope)
       VALUES ($1, $2, $3, '{}'::jsonb)`,
      [s, tg1, m],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope)
       VALUES ($1, $2, $3, '{}'::jsonb)`,
      [s, tg2, m],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('a cancelled transfer does not block a new active one from same source', async () => {
    const s = await mkTenant(db, 'src-co');
    const tg1 = await mkTenant(db, 'tgt1-co');
    const tg2 = await mkTenant(db, 'tgt2-co');
    const m = await mkMember(db, s, 'o@y.dev');
    await db.query(
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope, status)
       VALUES ($1, $2, $3, '{}'::jsonb, 'cancelled')`,
      [s, tg1, m],
    );
    await db.query(
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope)
       VALUES ($1, $2, $3, '{}'::jsonb)`,
      [s, tg2, m],
    );
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_transfer_requests`)
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('RESTRICT on initiated_by: cannot drop the initiator while a request exists', async () => {
    const s = await mkTenant(db, 'src-co');
    const tg = await mkTenant(db, 'tgt-co');
    const m = await mkMember(db, s, 'o@y.dev');
    await db.query(
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope)
       VALUES ($1, $2, $3, '{}'::jsonb)`,
      [s, tg, m],
    );
    const err = await tryExec(db, `DELETE FROM tenant_members WHERE id = $1`, [m]);
    expect(err).toMatch(/foreign key|restrict/i);
  });

  it('CASCADE: deleting source tenant removes its requests', async () => {
    const s = await mkTenant(db, 'src-co');
    const tg = await mkTenant(db, 'tgt-co');
    const m = await mkMember(db, s, 'o@y.dev');
    await db.query(
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope)
       VALUES ($1, $2, $3, '{}'::jsonb)`,
      [s, tg, m],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [s]);
    const c = (
      await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tenant_transfer_requests`)
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const s = await mkTenant(db, 'src-co');
    const tg = await mkTenant(db, 'tgt-co');
    const m = await mkMember(db, s, 'o@y.dev');
    await db.query(
      `INSERT INTO tenant_transfer_requests (source_tenant_id, target_tenant_id, initiated_by, scope)
       VALUES ($1, $2, $3, '{}'::jsonb)`,
      [s, tg, m],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_transfer_requests`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_transfer_requests`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
