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

describe('tenant_member_external_calendars — schema correctness (Phase 2 Unit 22)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid calendar', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO tenant_member_external_calendars (member_id, provider, access_token_encrypted)
       VALUES ($1, 'google_calendar', '\\x00aa'::bytea)`,
      [m],
    );
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM tenant_member_external_calendars`,
      )
    ).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bogus provider', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_member_external_calendars (member_id, provider, access_token_encrypted)
       VALUES ($1, 'fastmail', '\\x00aa'::bytea)`,
      [m],
    );
    expect(err).toMatch(/provider|check/i);
  });

  it('rejects bogus sync_direction', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_member_external_calendars (member_id, provider, access_token_encrypted, sync_direction)
       VALUES ($1, 'google_calendar', '\\x00aa'::bytea, 'one_way')`,
      [m],
    );
    expect(err).toMatch(/sync_direction|check/i);
  });

  it('rejects empty access_token', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_member_external_calendars (member_id, provider, access_token_encrypted)
       VALUES ($1, 'google_calendar', ''::bytea)`,
      [m],
    );
    expect(err).toMatch(/token_non_empty|check/i);
  });

  it("rejects 'expired' without token_expires_at", async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO tenant_member_external_calendars (member_id, provider, access_token_encrypted, status)
       VALUES ($1, 'google_calendar', '\\x00aa'::bytea, 'expired')`,
      [m],
    );
    expect(err).toMatch(/expired|check/i);
  });

  it('partial UNIQUE: one active calendar per (member, provider)', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO tenant_member_external_calendars (member_id, provider, access_token_encrypted)
       VALUES ($1, 'google_calendar', '\\x00aa'::bytea)`,
      [m],
    );
    const err = await tryExec(
      db,
      `INSERT INTO tenant_member_external_calendars (member_id, provider, access_token_encrypted)
       VALUES ($1, 'google_calendar', '\\x00bb'::bytea)`,
      [m],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('disconnected calendar does not block a new active one', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO tenant_member_external_calendars (member_id, provider, access_token_encrypted, status)
       VALUES ($1, 'google_calendar', '\\x00aa'::bytea, 'disconnected')`,
      [m],
    );
    await db.query(
      `INSERT INTO tenant_member_external_calendars (member_id, provider, access_token_encrypted)
       VALUES ($1, 'google_calendar', '\\x00bb'::bytea)`,
      [m],
    );
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM tenant_member_external_calendars WHERE member_id = $1`,
        [m],
      )
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('same member can connect different providers', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO tenant_member_external_calendars (member_id, provider, access_token_encrypted)
       VALUES ($1, 'google_calendar', '\\x00aa'::bytea),
              ($1, 'outlook', '\\x00bb'::bytea)`,
      [m],
    );
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM tenant_member_external_calendars`,
      )
    ).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting member removes its calendars', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO tenant_member_external_calendars (member_id, provider, access_token_encrypted)
       VALUES ($1, 'google_calendar', '\\x00aa'::bytea)`,
      [m],
    );
    await db.query(`DELETE FROM tenant_members WHERE id = $1`, [m]);
    const c = (
      await db.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM tenant_member_external_calendars`,
      )
    ).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    const m = await mkMember(db, t, 'a@y.dev');
    await db.query(
      `INSERT INTO tenant_member_external_calendars (member_id, provider, access_token_encrypted)
       VALUES ($1, 'google_calendar', '\\x00aa'::bytea)`,
      [m],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_member_external_calendars`)).rows
          .length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM tenant_member_external_calendars`)).rows
          .length,
    );
    expect(svc).toBe(1);
  });
});
