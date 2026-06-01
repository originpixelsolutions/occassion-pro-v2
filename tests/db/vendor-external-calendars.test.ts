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
const PW = '$argon2id$v=19$m=65536,t=3,p=4$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);
async function mkVendor(db: TestDb, email: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO vendor_accounts (email, password_hash) VALUES ($1,$2) RETURNING id`,
      [email, PW],
    )
  ).rows[0]!.id;
}

describe('vendor_external_calendars — schema correctness (Phase 3 Unit 37)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid Google Calendar OAuth row', async () => {
    const v = await mkVendor(db, 'v1@y.dev');
    await db.query(
      `INSERT INTO vendor_external_calendars (vendor_account_id, provider, access_token_encrypted, refresh_token_encrypted, token_kms_key_id, calendar_id, display_name, is_primary)
       VALUES ($1, 'google_calendar', '\\xabcd'::bytea, '\\xef01'::bytea, 'arn:kms:key/abc', 'primary', 'Work Calendar', TRUE)`,
      [v],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_external_calendars`))
        .rows[0]!.c,
    ).toBe(1);
  });

  it('inserts a valid iCal subscription', async () => {
    const v = await mkVendor(db, 'v2@y.dev');
    await db.query(
      `INSERT INTO vendor_external_calendars (vendor_account_id, provider, ical_url, display_name)
       VALUES ($1, 'ical_url', 'webcal://example.com/cal.ics', 'Shared iCal')`,
      [v],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_external_calendars`))
        .rows[0]!.c,
    ).toBe(1);
  });

  it('ical_url provider WITHOUT url rejected', async () => {
    const v = await mkVendor(db, 'v3@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_external_calendars (vendor_account_id, provider) VALUES ($1, 'ical_url')`,
      [v],
    );
    expect(err).toMatch(/ical_requires_url|check/i);
  });

  it('apple_calendar with OAuth token rejected', async () => {
    const v = await mkVendor(db, 'v4@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_external_calendars (vendor_account_id, provider, access_token_encrypted, token_kms_key_id)
       VALUES ($1, 'apple_calendar', '\\xabcd'::bytea, 'arn:kms:key/abc')`,
      [v],
    );
    expect(err).toMatch(/check/i);
  });

  it('token without kms key rejected', async () => {
    const v = await mkVendor(db, 'v5@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_external_calendars (vendor_account_id, provider, access_token_encrypted)
       VALUES ($1, 'google_calendar', '\\xabcd'::bytea)`,
      [v],
    );
    expect(err).toMatch(/tokens_require_key|check/i);
  });

  it('error status without last_sync_error rejected', async () => {
    const v = await mkVendor(db, 'v6@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_external_calendars (vendor_account_id, provider, ical_url, status)
       VALUES ($1, 'ical_url', 'https://x.dev/cal.ics', 'error')`,
      [v],
    );
    expect(err).toMatch(/check/i);
  });

  it('partial UNIQUE: only one primary per vendor', async () => {
    const v = await mkVendor(db, 'v7@y.dev');
    await db.query(
      `INSERT INTO vendor_external_calendars (vendor_account_id, provider, ical_url, is_primary)
       VALUES ($1, 'ical_url', 'https://x.dev/a.ics', TRUE)`,
      [v],
    );
    const err = await tryExec(
      db,
      `INSERT INTO vendor_external_calendars (vendor_account_id, provider, ical_url, is_primary)
       VALUES ($1, 'ical_url', 'https://x.dev/b.ics', TRUE)`,
      [v],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('two non-primary calendars per vendor allowed', async () => {
    const v = await mkVendor(db, 'v8@y.dev');
    await db.query(
      `INSERT INTO vendor_external_calendars (vendor_account_id, provider, ical_url) VALUES ($1, 'ical_url', 'https://x.dev/a.ics')`,
      [v],
    );
    await db.query(
      `INSERT INTO vendor_external_calendars (vendor_account_id, provider, ical_url) VALUES ($1, 'ical_url', 'https://x.dev/b.ics')`,
      [v],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM vendor_external_calendars WHERE vendor_account_id=$1`,
          [v],
        )
      ).rows[0]!.c,
    ).toBe(2);
  });

  it('rejects bad ical_url scheme', async () => {
    const v = await mkVendor(db, 'v9@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO vendor_external_calendars (vendor_account_id, provider, ical_url) VALUES ($1, 'ical_url', 'ftp://x.dev/cal.ics')`,
      [v],
    );
    expect(err).toMatch(/ical_url|check/i);
  });

  it('error status with last_sync_error accepted', async () => {
    const v = await mkVendor(db, 'va@y.dev');
    await db.query(
      `INSERT INTO vendor_external_calendars (vendor_account_id, provider, ical_url, status, last_sync_error)
       VALUES ($1, 'ical_url', 'https://x.dev/cal.ics', 'error', 'HTTP 503 from provider')`,
      [v],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM vendor_external_calendars WHERE status='error'`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('RLS pair', async () => {
    const v = await mkVendor(db, 'vb@y.dev');
    await db.query(
      `INSERT INTO vendor_external_calendars (vendor_account_id, provider, ical_url) VALUES ($1, 'ical_url', 'https://x.dev/c.ics')`,
      [v],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM vendor_external_calendars`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM vendor_external_calendars`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
