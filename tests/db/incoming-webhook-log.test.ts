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

describe('incoming_webhook_log — schema correctness (Phase 9 Unit 58)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid received webhook', async () => {
    await db.query(
      `INSERT INTO incoming_webhook_log (source, external_id, event_type, payload, signature_valid, signature_algorithm)
       VALUES ('razorpay','pay_R123','payment.captured','{"id":"pay_R123","amount":250000}'::jsonb, TRUE, 'hmac_sha256')`,
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM incoming_webhook_log`))
        .rows[0]!.c,
    ).toBe(1);
  });

  it('UNIQUE (source, external_id) blocks dupe', async () => {
    await db.query(
      `INSERT INTO incoming_webhook_log (source, external_id, payload) VALUES ('stripe','evt_X1','{}'::jsonb)`,
    );
    const err = await tryExec(
      db,
      `INSERT INTO incoming_webhook_log (source, external_id, payload) VALUES ('stripe','evt_X1','{}'::jsonb)`,
    );
    expect(err).toMatch(/duplicate|unique/i);
  });

  it('same external_id across TWO sources allowed', async () => {
    await db.query(
      `INSERT INTO incoming_webhook_log (source, external_id, payload) VALUES ('razorpay','xyz123','{}'::jsonb)`,
    );
    await db.query(
      `INSERT INTO incoming_webhook_log (source, external_id, payload) VALUES ('stripe','xyz123','{}'::jsonb)`,
    );
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM incoming_webhook_log WHERE external_id='xyz123'`,
        )
      ).rows[0]!.c,
    ).toBe(2);
  });

  it('rejects bad source', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO incoming_webhook_log (source, payload) VALUES ('rogue_gateway','{}'::jsonb)`,
    );
    expect(err).toMatch(/source_enum|check/i);
  });

  it('processed requires processed_at', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO incoming_webhook_log (source, payload, status) VALUES ('stripe','{}'::jsonb,'processed')`,
    );
    expect(err).toMatch(/check/i);
  });

  it('failed requires error', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO incoming_webhook_log (source, payload, status) VALUES ('stripe','{}'::jsonb,'failed')`,
    );
    expect(err).toMatch(/check/i);
  });

  it('duplicate requires external_id', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO incoming_webhook_log (source, payload, status) VALUES ('stripe','{}'::jsonb,'duplicate')`,
    );
    expect(err).toMatch(/check/i);
  });

  it('processing requires processing_started_at', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO incoming_webhook_log (source, payload, status) VALUES ('stripe','{}'::jsonb,'processing')`,
    );
    expect(err).toMatch(/check/i);
  });

  it('rejects bad signature_algorithm', async () => {
    const err = await tryExec(
      db,
      `INSERT INTO incoming_webhook_log (source, payload, signature_algorithm) VALUES ('stripe','{}'::jsonb,'md5')`,
    );
    expect(err).toMatch(/signature_algorithm|check/i);
  });

  it('payload array accepted (Stripe batch)', async () => {
    await db.query(
      `INSERT INTO incoming_webhook_log (source, payload) VALUES ('stripe','[{"e":"x"}]'::jsonb)`,
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM incoming_webhook_log`))
        .rows[0]!.c,
    ).toBe(1);
  });

  it('canonical-field UPDATE blocked', async () => {
    await db.query(
      `INSERT INTO incoming_webhook_log (source, external_id, payload) VALUES ('stripe','locked','{}'::jsonb)`,
    );
    const err = await tryExec(
      db,
      `UPDATE incoming_webhook_log SET payload = '{"tampered":true}'::jsonb WHERE external_id = 'locked'`,
    );
    expect(err).toMatch(/immutable|append-only/i);
  });

  it('status UPDATE allowed (processing -> processed)', async () => {
    await db.query(
      `INSERT INTO incoming_webhook_log (source, external_id, payload) VALUES ('stripe','flow','{}'::jsonb)`,
    );
    await db.query(
      `UPDATE incoming_webhook_log SET status = 'processing', processing_started_at = now() WHERE external_id = 'flow'`,
    );
    await db.query(
      `UPDATE incoming_webhook_log SET status = 'processed', processed_at = now() WHERE external_id = 'flow'`,
    );
    const r = await db.query<{ status: string }>(
      `SELECT status FROM incoming_webhook_log WHERE external_id='flow'`,
    );
    expect(r.rows[0]!.status).toBe('processed');
  });

  it('bigserial PK auto-increments', async () => {
    await db.query(
      `INSERT INTO incoming_webhook_log (source, payload) VALUES ('stripe','{}'::jsonb)`,
    );
    await db.query(
      `INSERT INTO incoming_webhook_log (source, payload) VALUES ('stripe','{}'::jsonb)`,
    );
    const r = await db.query<{ id: string }>(`SELECT id FROM incoming_webhook_log ORDER BY id`);
    expect(Number(r.rows[1]!.id)).toBeGreaterThan(Number(r.rows[0]!.id));
  });

  it('RLS pair', async () => {
    await db.query(
      `INSERT INTO incoming_webhook_log (source, payload) VALUES ('stripe','{}'::jsonb)`,
    );
    const anon = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM incoming_webhook_log`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM incoming_webhook_log`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
