import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function tryExec(db: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); return ''; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
}

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency)
     VALUES ($1, 'Acme', 'INR') RETURNING id`, [slug]);
  return r.rows[0]!.id;
}

describe('tenant_messaging_integrations — schema correctness (Phase 2 Unit 20)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('inserts a valid Slack integration', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_messaging_integrations (tenant_id, provider, webhook_url_encrypted, subscribed_events, channel_name, workspace_name)
       VALUES ($1, 'slack', '\\x00aa'::bytea, ARRAY['event.created','event.completed'], '#events', 'Acme WS')`, [t]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM tenant_messaging_integrations`)).rows[0]!.c;
    expect(c).toBe(1);
  });

  it('rejects bogus provider', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO tenant_messaging_integrations (tenant_id, provider, webhook_url_encrypted, subscribed_events)
       VALUES ($1, 'discord', '\\x00aa'::bytea, ARRAY['x'])`, [t]);
    expect(err).toMatch(/provider|check/i);
  });

  it('rejects empty webhook', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO tenant_messaging_integrations (tenant_id, provider, webhook_url_encrypted, subscribed_events)
       VALUES ($1, 'slack', ''::bytea, ARRAY['x'])`, [t]);
    expect(err).toMatch(/webhook_non_empty|check/i);
  });

  it('rejects empty subscribed_events array', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO tenant_messaging_integrations (tenant_id, provider, webhook_url_encrypted, subscribed_events)
       VALUES ($1, 'slack', '\\x00aa'::bytea, ARRAY[]::text[])`, [t]);
    expect(err).toMatch(/events_non_empty|check/i);
  });

  it('rejects non-object per_event_routing', async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO tenant_messaging_integrations (tenant_id, provider, webhook_url_encrypted, subscribed_events, per_event_routing)
       VALUES ($1, 'slack', '\\x00aa'::bytea, ARRAY['x'], '[1,2]'::jsonb)`, [t]);
    expect(err).toMatch(/routing_object|check/i);
  });

  it("rejects status 'error' without last_error", async () => {
    const t = await mkTenant(db, 'acme-co');
    const err = await tryExec(db,
      `INSERT INTO tenant_messaging_integrations (tenant_id, provider, webhook_url_encrypted, subscribed_events, status)
       VALUES ($1, 'slack', '\\x00aa'::bytea, ARRAY['x'], 'error')`, [t]);
    expect(err).toMatch(/error_requires_msg|check/i);
  });

  it('allows multiple active integrations per tenant (Slack + Teams)', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_messaging_integrations (tenant_id, provider, webhook_url_encrypted, subscribed_events)
       VALUES ($1, 'slack', '\\x00aa'::bytea, ARRAY['x']),
              ($1, 'microsoft_teams', '\\x00bb'::bytea, ARRAY['x'])`, [t]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM tenant_messaging_integrations`)).rows[0]!.c;
    expect(c).toBe(2);
  });

  it('CASCADE: deleting tenant removes its integrations', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_messaging_integrations (tenant_id, provider, webhook_url_encrypted, subscribed_events)
       VALUES ($1, 'slack', '\\x00aa'::bytea, ARRAY['x'])`, [t]);
    await db.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    const c = (await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM tenant_messaging_integrations`)).rows[0]!.c;
    expect(c).toBe(0);
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'acme-co');
    await db.query(
      `INSERT INTO tenant_messaging_integrations (tenant_id, provider, webhook_url_encrypted, subscribed_events)
       VALUES ($1, 'slack', '\\x00aa'::bytea, ARRAY['x'])`, [t]);
    const anon = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM tenant_messaging_integrations`)).rows.length);
    expect(anon).toBe(0);
    const svc = await withRole(db, 'service_role', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM tenant_messaging_integrations`)).rows.length);
    expect(svc).toBe(1);
  });
});
