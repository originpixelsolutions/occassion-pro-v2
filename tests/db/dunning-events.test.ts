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

const INV = '11111111-1111-1111-1111-111111111111';
const INV2 = '22222222-2222-2222-2222-222222222222';

describe('dunning_events — schema correctness (Phase 2 Unit 36)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid event (default outcome = sent)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO dunning_events (tenant_id, invoice_id, attempt_number, channel, recipient_email)
       VALUES ($1, $2, 1, 'email', 'finance@acme.co')`,
      [t, INV],
    );
    const r = await db.query<{ outcome: string }>(`SELECT outcome FROM dunning_events`);
    expect(r.rows[0]!.outcome).toBe('sent');
  });

  it('rejects attempt_number outside 1..5', async () => {
    const t = await mkTenant(db, 'acme-co');
    const e1 = await tryExec(
      db,
      `INSERT INTO dunning_events (tenant_id, attempt_number, channel) VALUES ($1, 0, 'email')`,
      [t],
    );
    expect(e1).toMatch(/attempt_bounds|check/i);
    const e2 = await tryExec(
      db,
      `INSERT INTO dunning_events (tenant_id, attempt_number, channel) VALUES ($1, 6, 'email')`,
      [t],
    );
    expect(e2).toMatch(/attempt_bounds|check/i);
  });

  it('rejects bogus channel', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO dunning_events (tenant_id, attempt_number, channel) VALUES ($1, 1, 'fax')`,
      [t],
    );
    expect(err).toMatch(/channel|check/i);
  });

  it('rejects bogus outcome', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO dunning_events (tenant_id, attempt_number, channel, outcome)
       VALUES ($1, 1, 'email', 'shrugged')`,
      [t],
    );
    expect(err).toMatch(/outcome|check/i);
  });

  it('rejects malformed recipient_email', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(
      db,
      `INSERT INTO dunning_events (tenant_id, attempt_number, channel, recipient_email)
       VALUES ($1, 1, 'email', 'not-an-email')`,
      [t],
    );
    expect(err).toMatch(/email|check/i);
  });

  it('partial UNIQUE: blocks duplicate (invoice, attempt, channel)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO dunning_events (tenant_id, invoice_id, attempt_number, channel)
       VALUES ($1, $2, 1, 'email')`,
      [t, INV],
    );
    const err = await tryExec(
      db,
      `INSERT INTO dunning_events (tenant_id, invoice_id, attempt_number, channel)
       VALUES ($1, $2, 1, 'email')`,
      [t, INV],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('same (attempt, channel) allowed for different invoices', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO dunning_events (tenant_id, invoice_id, attempt_number, channel) VALUES
         ($1, $2, 1, 'email'),
         ($1, $3, 1, 'email')`,
      [t, INV, INV2],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM dunning_events`))
      .rows[0]!.c;
    expect(c).toBe(2);
  });

  it('same invoice + attempt allowed across DIFFERENT channels (email + sms day 9)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO dunning_events (tenant_id, invoice_id, attempt_number, channel) VALUES
         ($1, $2, 4, 'email'),
         ($1, $2, 4, 'sms')`,
      [t, INV],
    );
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM dunning_events`))
      .rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting tenant removes its events', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO dunning_events (tenant_id, attempt_number, channel) VALUES ($1, 1, 'email')`,
      [t],
    );
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM dunning_events`))
      .rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO dunning_events (tenant_id, attempt_number, channel) VALUES ($1, 1, 'email')`,
      [t],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM dunning_events`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM dunning_events`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
