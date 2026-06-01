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
async function mkLink(db: TestDb, tenant: string, code: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO short_links (code, destination_url, tenant_id, link_type) VALUES ($1,'https://x.dev', $2, 'generic') RETURNING id`,
      [code, tenant],
    )
  ).rows[0]!.id;
}

describe('short_link_clicks — schema correctness (Phase 3 Unit 25)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('inserts a valid click', async () => {
    const t = await mkTenant(db, 'slc-aaa');
    const l = await mkLink(db, t, 'aB3xY9');
    await db.query(
      `INSERT INTO short_link_clicks (link_id, tenant_id, device_type, country_code, outcome)
       VALUES ($1,$2,'mobile','IN','success')`,
      [l, t],
    );
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM short_link_clicks`)).rows[0]!
        .c,
    ).toBe(1);
  });

  it('rejects bad device_type', async () => {
    const t = await mkTenant(db, 'slc-bbb');
    const l = await mkLink(db, t, 'bB3xY9');
    const err = await tryExec(
      db,
      `INSERT INTO short_link_clicks (link_id, tenant_id, device_type) VALUES ($1,$2,'smartwatch')`,
      [l, t],
    );
    expect(err).toMatch(/device|check/i);
  });

  it('rejects bad outcome', async () => {
    const t = await mkTenant(db, 'slc-ccc');
    const l = await mkLink(db, t, 'cB3xY9');
    const err = await tryExec(
      db,
      `INSERT INTO short_link_clicks (link_id, tenant_id, outcome) VALUES ($1,$2,'maybe')`,
      [l, t],
    );
    expect(err).toMatch(/outcome|check/i);
  });

  it('rejects bad country_code (lowercase)', async () => {
    const t = await mkTenant(db, 'slc-ddd');
    const l = await mkLink(db, t, 'dB3xY9');
    const err = await tryExec(
      db,
      `INSERT INTO short_link_clicks (link_id, tenant_id, country_code) VALUES ($1,$2,'in')`,
      [l, t],
    );
    expect(err).toMatch(/country|check/i);
  });

  it('cross-tenant: click.tenant_id != link.tenant_id rejected', async () => {
    const t1 = await mkTenant(db, 'slc-ttt');
    const l1 = await mkLink(db, t1, 'eB3xY9');
    const t2 = await mkTenant(db, 'slc-uuu');
    const err = await tryExec(
      db,
      `INSERT INTO short_link_clicks (link_id, tenant_id) VALUES ($1,$2)`,
      [l1, t2],
    );
    expect(err).toMatch(/tenant|does not match/i);
  });

  it('append-only: UPDATE blocked', async () => {
    const t = await mkTenant(db, 'slc-eee');
    const l = await mkLink(db, t, 'fB3xY9');
    await db.query(`INSERT INTO short_link_clicks (link_id, tenant_id) VALUES ($1,$2)`, [l, t]);
    const err = await tryExec(db, `UPDATE short_link_clicks SET outcome='not_found'`);
    expect(err).toMatch(/append-only|forbidden/i);
  });

  it('DELETE permitted (archive sweep)', async () => {
    const t = await mkTenant(db, 'slc-fff');
    const l = await mkLink(db, t, 'gB3xY9');
    await db.query(`INSERT INTO short_link_clicks (link_id, tenant_id) VALUES ($1,$2)`, [l, t]);
    await db.query(`DELETE FROM short_link_clicks WHERE link_id=$1`, [l]);
    expect(
      (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM short_link_clicks`)).rows[0]!
        .c,
    ).toBe(0);
  });

  it('rejects oversize user_agent', async () => {
    const t = await mkTenant(db, 'slc-ggg');
    const l = await mkLink(db, t, 'hB3xY9');
    const longUa = 'X'.repeat(1001);
    const err = await tryExec(
      db,
      `INSERT INTO short_link_clicks (link_id, tenant_id, user_agent) VALUES ($1,$2,$3)`,
      [l, t, longUa],
    );
    expect(err).toMatch(/user_agent|check/i);
  });

  it('bigserial PK auto-increments', async () => {
    const t = await mkTenant(db, 'slc-hhh');
    const l = await mkLink(db, t, 'iB3xY9');
    await db.query(`INSERT INTO short_link_clicks (link_id, tenant_id) VALUES ($1,$2)`, [l, t]);
    await db.query(`INSERT INTO short_link_clicks (link_id, tenant_id) VALUES ($1,$2)`, [l, t]);
    const r = await db.query<{ id: string }>(`SELECT id FROM short_link_clicks ORDER BY id`);
    expect(r.rows).toHaveLength(2);
    expect(Number(r.rows[1]!.id)).toBeGreaterThan(Number(r.rows[0]!.id));
  });

  it('RLS pair', async () => {
    const t = await mkTenant(db, 'slc-www');
    const l = await mkLink(db, t, 'jB3xY9');
    await db.query(`INSERT INTO short_link_clicks (link_id, tenant_id) VALUES ($1,$2)`, [l, t]);
    const anon = await withRole(
      db,
      'anon',
      async () => (await db.query<{ id: string }>(`SELECT id FROM short_link_clicks`)).rows.length,
    );
    expect(anon).toBe(0);
    const svc = await withRole(
      db,
      'service_role',
      async () => (await db.query<{ id: string }>(`SELECT id FROM short_link_clicks`)).rows.length,
    );
    expect(svc).toBe(1);
  });
});
