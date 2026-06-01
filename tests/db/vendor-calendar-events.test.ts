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
async function mkCalendar(db: TestDb, vendor: string, url='https://x.dev/a.ics'): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO vendor_external_calendars (vendor_account_id, provider, ical_url) VALUES ($1,'ical_url',$2) RETURNING id`, [vendor, url])).rows[0]!.id;
}

describe('vendor_calendar_events — schema correctness (Phase 3 Unit 38)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid event', async () => {
    const v = await mkVendor(db, 'v1@y.dev');
    const c = await mkCalendar(db, v);
    await db.query(
      `INSERT INTO vendor_calendar_events (vendor_calendar_id, vendor_account_id, external_event_id, title, starts_at, ends_at)
       VALUES ($1,$2,'EXT-001','Wedding Setup', now()+interval '1 day', now()+interval '1 day 4 hours')`, [c, v]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_calendar_events`)).rows[0]!.c).toBe(1);
  });

  it('UNIQUE (calendar, external_event_id) blocks dupe', async () => {
    const v = await mkVendor(db, 'v2@y.dev');
    const c = await mkCalendar(db, v);
    await db.query(`INSERT INTO vendor_calendar_events (vendor_calendar_id, vendor_account_id, external_event_id, starts_at, ends_at)
       VALUES ($1,$2,'EXT-001', now(), now()+interval '1 hour')`, [c, v]);
    const err = await tryExec(db, `INSERT INTO vendor_calendar_events (vendor_calendar_id, vendor_account_id, external_event_id, starts_at, ends_at)
       VALUES ($1,$2,'EXT-001', now(), now()+interval '1 hour')`, [c, v]);
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('same external_event_id across TWO calendars allowed', async () => {
    const v = await mkVendor(db, 'v3@y.dev');
    const c1 = await mkCalendar(db, v, 'https://x.dev/a.ics');
    const c2 = await mkCalendar(db, v, 'https://x.dev/b.ics');
    await db.query(`INSERT INTO vendor_calendar_events (vendor_calendar_id, vendor_account_id, external_event_id, starts_at, ends_at)
       VALUES ($1,$2,'EXT-001', now(), now()+interval '1 hour')`, [c1, v]);
    await db.query(`INSERT INTO vendor_calendar_events (vendor_calendar_id, vendor_account_id, external_event_id, starts_at, ends_at)
       VALUES ($1,$2,'EXT-001', now(), now()+interval '1 hour')`, [c2, v]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_calendar_events`)).rows[0]!.c).toBe(2);
  });

  it('rejects ends_at < starts_at', async () => {
    const v = await mkVendor(db, 'v4@y.dev');
    const c = await mkCalendar(db, v);
    const err = await tryExec(db,
      `INSERT INTO vendor_calendar_events (vendor_calendar_id, vendor_account_id, external_event_id, starts_at, ends_at)
       VALUES ($1,$2,'EXT-001', now()+interval '2 hours', now())`, [c, v]);
    expect(err).toMatch(/time_order|check/i);
  });

  it('rejects bad status', async () => {
    const v = await mkVendor(db, 'v5@y.dev');
    const c = await mkCalendar(db, v);
    const err = await tryExec(db,
      `INSERT INTO vendor_calendar_events (vendor_calendar_id, vendor_account_id, external_event_id, starts_at, ends_at, status)
       VALUES ($1,$2,'EXT-001', now(), now()+interval '1 hour','maybe')`, [c, v]);
    expect(err).toMatch(/status|check/i);
  });

  it('all_day requires day-aligned timestamps', async () => {
    const v = await mkVendor(db, 'v6@y.dev');
    const c = await mkCalendar(db, v);
    const err = await tryExec(db,
      `INSERT INTO vendor_calendar_events (vendor_calendar_id, vendor_account_id, external_event_id, starts_at, ends_at, all_day)
       VALUES ($1,$2,'EXT-001', '2026-12-10 09:30:00+00', '2026-12-11 00:00:00+00', TRUE)`, [c, v]);
    expect(err).toMatch(/check/i);
  });

  it('all_day day-aligned accepted', async () => {
    const v = await mkVendor(db, 'v7@y.dev');
    const c = await mkCalendar(db, v);
    await db.query(
      `INSERT INTO vendor_calendar_events (vendor_calendar_id, vendor_account_id, external_event_id, starts_at, ends_at, all_day)
       VALUES ($1,$2,'EXT-001', '2026-12-10 00:00:00+00', '2026-12-11 00:00:00+00', TRUE)`, [c, v]);
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM vendor_calendar_events WHERE all_day=TRUE`)).rows[0]!.c).toBe(1);
  });

  it('rejects non-https external_url', async () => {
    const v = await mkVendor(db, 'v8@y.dev');
    const c = await mkCalendar(db, v);
    const err = await tryExec(db,
      `INSERT INTO vendor_calendar_events (vendor_calendar_id, vendor_account_id, external_event_id, starts_at, ends_at, external_url)
       VALUES ($1,$2,'EXT-001', now(), now()+interval '1 hour', 'http://insecure/x')`, [c, v]);
    expect(err).toMatch(/external_url|check/i);
  });

  it('vendor mismatch: event vendor != calendar vendor rejected', async () => {
    const v1 = await mkVendor(db, 'v9@y.dev');
    const c1 = await mkCalendar(db, v1);
    const v2 = await mkVendor(db, 'va@y.dev');
    const err = await tryExec(db,
      `INSERT INTO vendor_calendar_events (vendor_calendar_id, vendor_account_id, external_event_id, starts_at, ends_at)
       VALUES ($1,$2,'EXT-001', now(), now()+interval '1 hour')`, [c1, v2]);
    expect(err).toMatch(/vendor_account_id|does not match/i);
  });

  it('RLS pair', async () => {
    const v = await mkVendor(db, 'vb@y.dev');
    const c = await mkCalendar(db, v);
    await db.query(`INSERT INTO vendor_calendar_events (vendor_calendar_id, vendor_account_id, external_event_id, starts_at, ends_at)
       VALUES ($1,$2,'EXT-001', now(), now()+interval '1 hour')`, [c, v]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM vendor_calendar_events`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM vendor_calendar_events`)).rows.length);
    expect(svc).toBe(1);
  });
});
