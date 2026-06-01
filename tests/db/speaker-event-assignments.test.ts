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
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`,
      [slug],
    )
  ).rows[0]!.id;
}
async function mkEvent(db: TestDb, tenant: string, code = 'evt-001'): Promise<string> {
  const ty = (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (tenant_id, code, name, is_system)
     VALUES ($1, 'conf-' || gen_random_uuid()::text, 'Conf', FALSE) RETURNING id`,
      [tenant],
    )
  ).rows[0]!.id;
  return (
    await db.query<{ id: string }>(
      `INSERT INTO events (tenant_id, event_type_id, code, name, start_date, end_date, currency_code)
     VALUES ($1,$2,$3,'E','2026-12-10','2026-12-12','INR') RETURNING id`,
      [tenant, ty, code],
    )
  ).rows[0]!.id;
}
async function mkSession(db: TestDb, tenant: string, event: string, title = 'S'): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO sessions (tenant_id, event_id, title, starts_at, ends_at)
     VALUES ($1,$2,$3, now()+interval '1 hour', now()+interval '2 hours') RETURNING id`,
      [tenant, event, title],
    )
  ).rows[0]!.id;
}
async function mkSpeaker(db: TestDb, email: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO speaker_accounts (email) VALUES ($1) RETURNING id`,
      [email],
    )
  ).rows[0]!.id;
}
async function mkMember(db: TestDb, tenant: string, email: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenant_members (tenant_id, email, full_name, role) VALUES ($1,$2,'M','event_manager') RETURNING id`,
      [tenant, email],
    )
  ).rows[0]!.id;
}

describe('speaker_event_assignments — schema correctness (Phase 3 Unit 22)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid invitation', async () => {
    const t = await mkTenant(db, 'sea-aaa');
    const e = await mkEvent(db, t);
    const s = await mkSession(db, t, e);
    const sp = await mkSpeaker(db, 'sp1@y.dev');
    const m = await mkMember(db, t, 'm@y.dev');
    await db.query(
      `INSERT INTO speaker_event_assignments (tenant_id, event_id, speaker_account_id, session_id, role, invited_by, honorarium, currency_code)
       VALUES ($1,$2,$3,$4,'keynote',$5, 50000.00, 'INR')`,
      [t, e, sp, s, m],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM speaker_event_assignments`))
        .rows[0]!.c,
    ).toBe(1);
  });

  it('partial UNIQUE blocks dupe speaker+session', async () => {
    const t = await mkTenant(db, 'sea-bbb');
    const e = await mkEvent(db, t);
    const s = await mkSession(db, t, e);
    const sp = await mkSpeaker(db, 'sp2@y.dev');
    await db.query(
      `INSERT INTO speaker_event_assignments (tenant_id, event_id, speaker_account_id, session_id) VALUES ($1,$2,$3,$4)`,
      [t, e, sp, s],
    );
    const err = await tryExec(
      db,
      `INSERT INTO speaker_event_assignments (tenant_id, event_id, speaker_account_id, session_id) VALUES ($1,$2,$3,$4)`,
      [t, e, sp, s],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('honorarium without currency rejected', async () => {
    const t = await mkTenant(db, 'sea-ccc');
    const e = await mkEvent(db, t);
    const s = await mkSession(db, t, e);
    const sp = await mkSpeaker(db, 'sp3@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO speaker_event_assignments (tenant_id, event_id, speaker_account_id, session_id, honorarium)
       VALUES ($1,$2,$3,$4, 1000)`,
      [t, e, sp, s],
    );
    expect(err).toMatch(/honorarium|check/i);
  });

  it('confirmed requires confirmed_at', async () => {
    const t = await mkTenant(db, 'sea-ddd');
    const e = await mkEvent(db, t);
    const s = await mkSession(db, t, e);
    const sp = await mkSpeaker(db, 'sp4@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO speaker_event_assignments (tenant_id, event_id, speaker_account_id, session_id, status)
       VALUES ($1,$2,$3,$4,'confirmed')`,
      [t, e, sp, s],
    );
    expect(err).toMatch(/check/i);
  });

  it('declined requires declined_at + reason', async () => {
    const t = await mkTenant(db, 'sea-eee');
    const e = await mkEvent(db, t);
    const s = await mkSession(db, t, e);
    const sp = await mkSpeaker(db, 'sp5@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO speaker_event_assignments (tenant_id, event_id, speaker_account_id, session_id, status, declined_at)
       VALUES ($1,$2,$3,$4,'declined', now())`,
      [t, e, sp, s],
    );
    expect(err).toMatch(/check/i);
  });

  it('cancelled requires cancelled_at + reason', async () => {
    const t = await mkTenant(db, 'sea-fff');
    const e = await mkEvent(db, t);
    const s = await mkSession(db, t, e);
    const sp = await mkSpeaker(db, 'sp6@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO speaker_event_assignments (tenant_id, event_id, speaker_account_id, session_id, status, cancelled_at)
       VALUES ($1,$2,$3,$4,'cancelled', now())`,
      [t, e, sp, s],
    );
    expect(err).toMatch(/check/i);
  });

  it('rejects non-https presentation_url', async () => {
    const t = await mkTenant(db, 'sea-ggg');
    const e = await mkEvent(db, t);
    const s = await mkSession(db, t, e);
    const sp = await mkSpeaker(db, 'sp7@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO speaker_event_assignments (tenant_id, event_id, speaker_account_id, session_id, presentation_url)
       VALUES ($1,$2,$3,$4,'http://insecure/slides.pdf')`,
      [t, e, sp, s],
    );
    expect(err).toMatch(/presentation_url|check/i);
  });

  it('same speaker on TWO sessions of same event allowed', async () => {
    const t = await mkTenant(db, 'sea-hhh');
    const e = await mkEvent(db, t);
    const s1 = await mkSession(db, t, e, 'S1');
    const s2 = await mkSession(db, t, e, 'S2');
    const sp = await mkSpeaker(db, 'sp8@y.dev');
    await db.query(
      `INSERT INTO speaker_event_assignments (tenant_id, event_id, speaker_account_id, session_id) VALUES ($1,$2,$3,$4)`,
      [t, e, sp, s1],
    );
    await db.query(
      `INSERT INTO speaker_event_assignments (tenant_id, event_id, speaker_account_id, session_id) VALUES ($1,$2,$3,$4)`,
      [t, e, sp, s2],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM speaker_event_assignments WHERE speaker_account_id=$1`,
          [sp],
        )
      ).rows[0]!.c,
    ).toBe(2);
  });

  it('cross-tenant: session from another tenant rejected', async () => {
    const t1 = await mkTenant(db, 'sea-ttt');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'sea-uuu');
    const e2 = await mkEvent(db, t2);
    const sOther = await mkSession(db, t2, e2);
    const sp = await mkSpeaker(db, 'sp9@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO speaker_event_assignments (tenant_id, event_id, speaker_account_id, session_id) VALUES ($1,$2,$3,$4)`,
      [t1, e1, sp, sOther],
    );
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('session belongs to wrong event rejected', async () => {
    const t = await mkTenant(db, 'sea-vvv');
    const e1 = await mkEvent(db, t, 'evt-aaa');
    const e2 = await mkEvent(db, t, 'evt-bbb');
    const sOnE2 = await mkSession(db, t, e2);
    const sp = await mkSpeaker(db, 'spA@y.dev');
    const err = await tryExec(
      db,
      `INSERT INTO speaker_event_assignments (tenant_id, event_id, speaker_account_id, session_id) VALUES ($1,$2,$3,$4)`,
      [t, e1, sp, sOnE2],
    );
    expect(err).toMatch(/belongs to event/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'sea-www');
    const e = await mkEvent(db, t);
    const s = await mkSession(db, t, e);
    const sp = await mkSpeaker(db, 'spB@y.dev');
    await db.query(
      `INSERT INTO speaker_event_assignments (tenant_id, event_id, speaker_account_id, session_id) VALUES ($1,$2,$3,$4)`,
      [t, e, sp, s],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM speaker_event_assignments`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM speaker_event_assignments`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
