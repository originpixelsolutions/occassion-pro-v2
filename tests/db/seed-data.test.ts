import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../setup/pg.js';

describe('Seed data (Phase 12 Unit 109)', () => {
  let db: TestDb;
  beforeEach(async () => { db = await setupTestDb(); });
  afterEach(async () => { await db.close(); });

  it('seeds 15 system event_types', async () => {
    const r = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_types WHERE is_system = TRUE`);
    expect(r.rows[0]!.c).toBe(15);
  });

  it('seeds the canonical 15 event_type codes', async () => {
    const codes = (await db.query<{ code: string }>(`SELECT code FROM event_types WHERE is_system = TRUE ORDER BY code`)).rows.map(r => r.code);
    expect(codes).toContain('wedding');
    expect(codes).toContain('corporate-conference');
    expect(codes).toContain('religious-ceremony');
    expect(codes).toContain('community-meetup');
  });

  it('seeds 10 feature flags', async () => {
    const r = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM feature_flags`);
    expect(r.rows[0]!.c).toBe(10);
  });

  it('seeds the default platform theme (live)', async () => {
    const r = await db.query<{ c: number; status: string; brand_primary: string }>(
      `SELECT count(*)::int AS c, max(status) AS status, max(brand_primary) AS brand_primary FROM platform_theme_config`);
    expect(r.rows[0]!.c).toBe(1);
    expect(r.rows[0]!.status).toBe('live');
    expect(r.rows[0]!.brand_primary).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('seeds 3 default WhatsApp templates', async () => {
    const r = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM whatsapp_templates`);
    expect(r.rows[0]!.c).toBe(3);
  });

  it('seeds bootstrap super_admin', async () => {
    const r = await db.query<{ email: string; role: string }>(`SELECT email, role FROM super_admins`);
    expect(r.rows[0]!.email).toBe('platform@occasionpro.local');
    expect(r.rows[0]!.role).toBe('owner');
  });

  it('is idempotent: re-running seed inserts does not duplicate', async () => {
    await db.query(`INSERT INTO event_types (tenant_id, code, name, is_system, tone) VALUES (NULL, 'wedding', 'Wedding', TRUE, 'celebratory') ON CONFLICT DO NOTHING`);
    const r = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM event_types WHERE code='wedding' AND is_system=TRUE`);
    expect(r.rows[0]!.c).toBe(1);
  });
});
