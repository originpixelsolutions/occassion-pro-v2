import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`, [slug])).rows[0]!.id;
}
async function mkMember(db: TestDb, tenantId: string, uid: string, email: string, role = 'owner'): Promise<void> {
  await db.query(
    `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($1, $2, $3, 'M', $4)`,
    [uid, tenantId, email, role]);
}
async function setCtx(db: TestDb, uid: string | null, userType: string | null, tenantId: string | null) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on short_links + clicks (Phase 12 Unit 98)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('anon CAN resolve active short_link', async () => {
    const t = await mkTenant(db, 'sl-aaa');
    await db.query(`INSERT INTO short_links (code, destination_url, tenant_id, link_type, click_count, is_active) VALUES ('aBc1234', 'https://x.example/y', $1, 'invitation', 0, TRUE)`, [t]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM short_links`)).rows.length);
    expect(n).toBe(1);
  });

  it('anon CANNOT resolve inactive short_link', async () => {
    const t = await mkTenant(db, 'sl-bbb');
    await db.query(`INSERT INTO short_links (code, destination_url, tenant_id, link_type, click_count, is_active) VALUES ('xYz5678', 'https://x.example/y', $1, 'invitation', 0, FALSE)`, [t]);
    const n = await withRole(db, 'anon', async () =>
      (await db.query<{ id: string }>(`SELECT id FROM short_links`)).rows.length);
    expect(n).toBe(0);
  });

  it('anon CAN record a click', async () => {
    const t = await mkTenant(db, 'sl-ccc');
    const linkId = (await db.query<{ id: string }>(
      `INSERT INTO short_links (code, destination_url, tenant_id, link_type, click_count, is_active) VALUES ('lMn9012', 'https://x.example/y', $1, 'invitation', 0, TRUE) RETURNING id`,
      [t])).rows[0]!.id;
    await withRole(db, 'anon', async () => {
      await db.query(`INSERT INTO short_link_clicks (link_id, tenant_id, clicked_at, outcome) VALUES ($1, $2, now(), 'success')`, [linkId, t]);
    });
    expect((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM short_link_clicks`)).rows[0]!.c).toBe(1);
  });

  it('tenant_member sees own tenant clicks', async () => {
    const t1 = await mkTenant(db, 'sl-ddd');
    const t2 = await mkTenant(db, 'sl-eee');
    const l1 = (await db.query<{ id: string }>(`INSERT INTO short_links (code, destination_url, tenant_id, link_type, click_count, is_active) VALUES ('aBcdEf1', 'https://x.example/a', $1, 'invitation', 0, TRUE) RETURNING id`, [t1])).rows[0]!.id;
    const l2 = (await db.query<{ id: string }>(`INSERT INTO short_links (code, destination_url, tenant_id, link_type, click_count, is_active) VALUES ('aBcdEf2', 'https://x.example/b', $1, 'invitation', 0, TRUE) RETURNING id`, [t2])).rows[0]!.id;
    await db.query(`INSERT INTO short_link_clicks (link_id, tenant_id, clicked_at, outcome) VALUES ($1, $2, now(), 'success')`, [l1, t1]);
    await db.query(`INSERT INTO short_link_clicks (link_id, tenant_id, clicked_at, outcome) VALUES ($1, $2, now(), 'success')`, [l2, t2]);
    const u = '00000000-0000-0000-0000-000000003100';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM short_link_clicks`)).rows.length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });
});
