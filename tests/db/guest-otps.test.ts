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
     VALUES ($1, 'wed-' || gen_random_uuid()::text, 'Wedding', FALSE) RETURNING id`,
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

async function mkGuest(
  db: TestDb,
  tenant: string,
  event: string,
  name = 'G',
  extra = '',
): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO guests (tenant_id, event_id, name, phone) VALUES ($1,$2,$3,$4) RETURNING id`,
      [tenant, event, name, '+9198765432' + (extra || '10')],
    )
  ).rows[0]!.id;
}

const HASH = 'a'.repeat(64); // sha-256 hex length

describe('guest_otps — schema correctness (Phase 3 Unit 17)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid SMS OTP', async () => {
    const t = await mkTenant(db, 'go-aaa');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    await db.query(
      `INSERT INTO guest_otps (tenant_id, event_id, guest_id, channel, recipient, otp_hash, expires_at)
       VALUES ($1,$2,$3,'sms','+919876543210',$4, now() + interval '10 minutes')`,
      [t, e, g, HASH],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM guest_otps`)).rows[0]!.c,
    ).toBe(1);
  });

  it('rejects invalid channel', async () => {
    const t = await mkTenant(db, 'go-bbb');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO guest_otps (tenant_id, event_id, guest_id, channel, recipient, otp_hash, expires_at)
       VALUES ($1,$2,$3,'telegram','x',$4, now() + interval '5 minutes')`,
      [t, e, g, HASH],
    );
    expect(err).toMatch(/channel|check/i);
  });

  it('rejects 6th attempt (attempts > 5)', async () => {
    const t = await mkTenant(db, 'go-ccc');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO guest_otps (tenant_id, event_id, guest_id, channel, recipient, otp_hash, expires_at, attempts)
       VALUES ($1,$2,$3,'email','a@y.dev',$4, now() + interval '5 minutes', 6)`,
      [t, e, g, HASH],
    );
    expect(err).toMatch(/attempts|check/i);
  });

  it('rejects expiry > 15 min in the future', async () => {
    const t = await mkTenant(db, 'go-ddd');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO guest_otps (tenant_id, event_id, guest_id, channel, recipient, otp_hash, expires_at)
       VALUES ($1,$2,$3,'sms','x',$4, now() + interval '30 minutes')`,
      [t, e, g, HASH],
    );
    expect(err).toMatch(/expiry|check/i);
  });

  it('rejects past expiry', async () => {
    const t = await mkTenant(db, 'go-eee');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO guest_otps (tenant_id, event_id, guest_id, channel, recipient, otp_hash, expires_at)
       VALUES ($1,$2,$3,'sms','x',$4, now() - interval '1 minute')`,
      [t, e, g, HASH],
    );
    expect(err).toMatch(/expiry|check/i);
  });

  it('rejects too-short otp_hash', async () => {
    const t = await mkTenant(db, 'go-fff');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO guest_otps (tenant_id, event_id, guest_id, channel, recipient, otp_hash, expires_at)
       VALUES ($1,$2,$3,'sms','x','tooshort', now() + interval '5 minutes')`,
      [t, e, g],
    );
    expect(err).toMatch(/otp_hash|check/i);
  });

  it('inv_coupling: invalidated_at without reason rejected', async () => {
    const t = await mkTenant(db, 'go-ggg');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO guest_otps (tenant_id, event_id, guest_id, channel, recipient, otp_hash, expires_at, invalidated_at)
       VALUES ($1,$2,$3,'sms','x',$4, now() + interval '5 minutes', now())`,
      [t, e, g, HASH],
    );
    expect(err).toMatch(/inv|coupling|check/i);
  });

  it('terminal_xor: consumed_at + invalidated_at rejected', async () => {
    const t = await mkTenant(db, 'go-hhh');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    const err = await tryExec(
      db,
      `INSERT INTO guest_otps (tenant_id, event_id, guest_id, channel, recipient, otp_hash, expires_at, consumed_at, invalidated_at, invalidated_reason)
       VALUES ($1,$2,$3,'sms','x',$4, now() + interval '5 minutes', now(), now(), 'max_attempts')`,
      [t, e, g, HASH],
    );
    expect(err).toMatch(/terminal|xor|check/i);
  });

  it('cross-tenant attack: guest from another tenant rejected', async () => {
    const t1 = await mkTenant(db, 'go-ttt');
    const e1 = await mkEvent(db, t1);
    const t2 = await mkTenant(db, 'go-uuu');
    const e2 = await mkEvent(db, t2);
    const gOther = await mkGuest(db, t2, e2);
    const err = await tryExec(
      db,
      `INSERT INTO guest_otps (tenant_id, event_id, guest_id, channel, recipient, otp_hash, expires_at)
       VALUES ($1,$2,$3,'sms','x',$4, now() + interval '5 minutes')`,
      [t1, e1, gOther, HASH],
    );
    expect(err).toMatch(/tenant_id|does not match/i);
  });

  it('guest belongs to wrong event rejected', async () => {
    const t = await mkTenant(db, 'go-vvv');
    const e1 = await mkEvent(db, t, 'evt-aaa');
    const e2 = await mkEvent(db, t, 'evt-bbb');
    const gOnE2 = await mkGuest(db, t, e2);
    const err = await tryExec(
      db,
      `INSERT INTO guest_otps (tenant_id, event_id, guest_id, channel, recipient, otp_hash, expires_at)
       VALUES ($1,$2,$3,'sms','x',$4, now() + interval '5 minutes')`,
      [t, e1, gOnE2, HASH],
    );
    expect(err).toMatch(/belongs to event/i);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'go-www');
    const e = await mkEvent(db, t);
    const g = await mkGuest(db, t, e);
    await db.query(
      `INSERT INTO guest_otps (tenant_id, event_id, guest_id, channel, recipient, otp_hash, expires_at)
       VALUES ($1,$2,$3,'sms','x',$4, now() + interval '5 minutes')`,
      [t, e, g, HASH],
    );
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM guest_otps`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM guest_otps`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
