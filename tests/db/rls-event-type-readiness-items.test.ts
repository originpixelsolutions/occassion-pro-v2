import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, asSuperuser, setupTestDb, withRole, type TestDb } from '../setup/pg.js';

async function mkTenant(db: TestDb, slug: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO tenants (slug, company_name, billing_currency) VALUES ($1,'Acme','INR') RETURNING id`,
      [slug],
    )
  ).rows[0]!.id;
}
async function mkMember(
  db: TestDb,
  tenantId: string,
  uid: string,
  email: string,
  role = 'owner',
): Promise<void> {
  await db.query(
    `INSERT INTO tenant_members (id, tenant_id, email, full_name, role) VALUES ($1, $2, $3, 'M', $4)`,
    [uid, tenantId, email, role],
  );
}
async function mkSysEventType(db: TestDb, code: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (tenant_id, code, name, is_system) VALUES (NULL, $1, 'Sys', TRUE) RETURNING id`,
      [code],
    )
  ).rows[0]!.id;
}
async function mkTenantEventType(db: TestDb, tenantId: string, code: string): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `INSERT INTO event_types (tenant_id, code, name, is_system) VALUES ($1, $2, 'Cust', FALSE) RETURNING id`,
      [tenantId, code],
    )
  ).rows[0]!.id;
}
async function setCtx(
  db: TestDb,
  uid: string | null,
  userType: string | null,
  tenantId: string | null,
) {
  await db.query(`SELECT set_config('app.user_id', $1, false)`, [uid ?? '']);
  await db.query(`SELECT set_config('app.user_type', $1, false)`, [userType ?? '']);
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
}

describe('RLS on event_type_readiness_items (Phase 12 Unit 84)', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await setupTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it('authenticated member sees system readiness items', async () => {
    const sysEt = await mkSysEventType(db, 'wedding');
    await db.query(
      `INSERT INTO event_type_readiness_items (event_type_id, label, weight, sort_order) VALUES ($1,'Venue confirmed', 1, 1)`,
      [sysEt],
    );
    const t = await mkTenant(db, 'etri-aaa');
    const u = '00000000-0000-0000-0000-000000001700';
    await mkMember(db, t, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    const n = (await db.query<{ id: string }>(`SELECT id FROM event_type_readiness_items`)).rows
      .length;
    await asSuperuser(db);
    expect(n).toBe(1);
  });

  it('anon CANNOT see system readiness items', async () => {
    const sysEt = await mkSysEventType(db, 'wedding');
    await db.query(
      `INSERT INTO event_type_readiness_items (event_type_id, label, weight, sort_order) VALUES ($1,'X', 1, 1)`,
      [sysEt],
    );
    const n = await withRole(
      db,
      'anon',
      async () =>
        (await db.query<{ id: string }>(`SELECT id FROM event_type_readiness_items`)).rows.length,
    );
    expect(n).toBe(0);
  });

  it('tenant items are scoped to own tenant', async () => {
    const t1 = await mkTenant(db, 'etri-bbb');
    const t2 = await mkTenant(db, 'etri-ccc');
    const et1 = await mkTenantEventType(db, t1, 'gala-1');
    const et2 = await mkTenantEventType(db, t2, 'gala-2');
    await db.query(
      `INSERT INTO event_type_readiness_items (event_type_id, label, weight, sort_order) VALUES ($1,'A', 1, 1)`,
      [et1],
    );
    await db.query(
      `INSERT INTO event_type_readiness_items (event_type_id, label, weight, sort_order) VALUES ($1,'B', 1, 1)`,
      [et2],
    );
    const u = '00000000-0000-0000-0000-000000001710';
    await mkMember(db, t1, u, 'm@y.dev');
    await setCtx(db, u, 'tenant_member', t1);
    await asRole(db, 'authenticated');
    const labels = (
      await db.query<{ label: string }>(`SELECT label FROM event_type_readiness_items`)
    ).rows.map((r) => r.label);
    await asSuperuser(db);
    expect(labels).toEqual(['A']);
  });

  it('owner can INSERT tenant readiness item', async () => {
    const t = await mkTenant(db, 'etri-ddd');
    const et = await mkTenantEventType(db, t, 'gala-3');
    const u = '00000000-0000-0000-0000-000000001720';
    await mkMember(db, t, u, 'o@y.dev', 'owner');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    await db.query(
      `INSERT INTO event_type_readiness_items (event_type_id, label, weight, sort_order) VALUES ($1,'New', 1, 1)`,
      [et],
    );
    await asSuperuser(db);
    expect(
      (
        await db.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM event_type_readiness_items WHERE label='New'`,
        )
      ).rows[0]!.c,
    ).toBe(1);
  });

  it('tenant member cannot INSERT against a system event_type', async () => {
    const sysEt = await mkSysEventType(db, 'wedding');
    const t = await mkTenant(db, 'etri-eee');
    const u = '00000000-0000-0000-0000-000000001730';
    await mkMember(db, t, u, 'o@y.dev', 'owner');
    await setCtx(db, u, 'tenant_member', t);
    await asRole(db, 'authenticated');
    let err = '';
    try {
      await db.query(
        `INSERT INTO event_type_readiness_items (event_type_id, label, weight, sort_order) VALUES ($1,'Sneak', 1, 1)`,
        [sysEt],
      );
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    await asSuperuser(db);
    expect(err).toMatch(/row-level security|policy/i);
  });
});
