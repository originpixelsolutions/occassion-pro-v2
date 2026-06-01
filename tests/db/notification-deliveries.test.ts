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
async function mkNotif(db: TestDb, tenant: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO notifications (tenant_id, recipient_type, recipient_id, category, title, body)
     VALUES ($1,'client', gen_random_uuid(),'x','t','b') RETURNING id`,
      [tenant],
    )
  ).rows[0]!.id;
}

describe('notification_deliveries — schema correctness (Phase 8 Unit 53)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid queued delivery', async () => {
    const t = await mkTenant(db, 'nd-aaa');
    const n = await mkNotif(db, t);
    await db.query(
      `INSERT INTO notification_deliveries (notification_id, channel, provider, recipient_address)
       VALUES ($1,'email','sendgrid','client@y.dev')`,
      [n],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM notification_deliveries`))
        .rows[0]!.c,
    ).toBe(1);
  });

  it('rejects bad channel', async () => {
    const t = await mkTenant(db, 'nd-bbb');
    const n = await mkNotif(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO notification_deliveries (notification_id, channel) VALUES ($1,'carrier_pigeon')`,
      [n],
    );
    expect(err).toMatch(/channel_enum|check/i);
  });

  it('attempts > 20 rejected', async () => {
    const t = await mkTenant(db, 'nd-ccc');
    const n = await mkNotif(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO notification_deliveries (notification_id, channel, attempts) VALUES ($1,'email', 21)`,
      [n],
    );
    expect(err).toMatch(/attempts_range|check/i);
  });

  it('sent requires sent_at', async () => {
    const t = await mkTenant(db, 'nd-ddd');
    const n = await mkNotif(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO notification_deliveries (notification_id, channel, status) VALUES ($1,'email','sent')`,
      [n],
    );
    expect(err).toMatch(/check/i);
  });

  it('delivered requires sent_at AND delivered_at', async () => {
    const t = await mkTenant(db, 'nd-eee');
    const n = await mkNotif(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO notification_deliveries (notification_id, channel, status, delivered_at)
       VALUES ($1,'email','delivered', now())`,
      [n],
    );
    expect(err).toMatch(/check/i);
  });

  it('read requires delivered_at AND read_at', async () => {
    const t = await mkTenant(db, 'nd-fff');
    const n = await mkNotif(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO notification_deliveries (notification_id, channel, status, sent_at, read_at)
       VALUES ($1,'email','read', now(), now())`,
      [n],
    );
    expect(err).toMatch(/check/i);
  });

  it('failed requires failed_at AND error_message', async () => {
    const t = await mkTenant(db, 'nd-ggg');
    const n = await mkNotif(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO notification_deliveries (notification_id, channel, status, failed_at)
       VALUES ($1,'email','failed', now())`,
      [n],
    );
    expect(err).toMatch(/check/i);
  });

  it('time ordering: sent before queued rejected', async () => {
    const t = await mkTenant(db, 'nd-hhh');
    const n = await mkNotif(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO notification_deliveries (notification_id, channel, queued_at, sent_at)
       VALUES ($1,'email', now(), now() - interval '1 hour')`,
      [n],
    );
    expect(err).toMatch(/check/i);
  });

  it('cost without currency rejected', async () => {
    const t = await mkTenant(db, 'nd-iii');
    const n = await mkNotif(db, t);
    const err = await tryExec(
      db,
      `INSERT INTO notification_deliveries (notification_id, channel, cost_micro_units) VALUES ($1,'sms', 12500)`,
      [n],
    );
    expect(err).toMatch(/cost_coupling|check/i);
  });

  it('UNIQUE (channel, provider_message_id) blocks dupe', async () => {
    const t = await mkTenant(db, 'nd-jjj');
    const n = await mkNotif(db, t);
    await db.query(
      `INSERT INTO notification_deliveries (notification_id, channel, provider_message_id) VALUES ($1,'whatsapp','wamid_X1')`,
      [n],
    );
    const err = await tryExec(
      db,
      `INSERT INTO notification_deliveries (notification_id, channel, provider_message_id) VALUES ($1,'whatsapp','wamid_X1')`,
      [n],
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('delivered happy path with cost', async () => {
    const t = await mkTenant(db, 'nd-kkk');
    const n = await mkNotif(db, t);
    await db.query(
      `INSERT INTO notification_deliveries (notification_id, channel, status, queued_at, sent_at, delivered_at, cost_micro_units, cost_currency, provider, provider_message_id)
       VALUES ($1,'sms','delivered', now() - interval '10 minutes', now() - interval '5 minutes', now() - interval '4 minutes', 25000, 'INR','twilio','SM123')`,
      [n],
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM notification_deliveries WHERE status='delivered'`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'nd-www');
    const n = await mkNotif(db, t);
    await db.query(
      `INSERT INTO notification_deliveries (notification_id, channel) VALUES ($1,'email')`,
      [n],
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM notification_deliveries`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM notification_deliveries`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
