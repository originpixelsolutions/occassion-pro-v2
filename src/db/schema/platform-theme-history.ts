import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { superAdmins } from './super-admins.js';

/**
 * platform_theme_history — Phase 1, Unit 5.
 *
 * Append-only audit log of platform_theme_config publishes. Mirrors
 * `supabase/migrations/20260523100020_platform_theme_history.sql`.
 *
 * Spec refs: 33.10 (theme tokens), 33.10.3 (state machine),
 * Part 14 (audit-log immutability principle).
 *
 * UPDATE and DELETE are blocked by the trg_pth_no_update /
 * trg_pth_no_delete triggers. Use INSERT only.
 */
export const platformThemeHistory = pgTable(
  'platform_theme_history',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    changedBy: uuid('changed_by').references(() => superAdmins.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    publishedAt: timestamp('published_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    versionCheck: check('pth_version_check', sql`${t.version} >= 1`),
    snapshotShapeCheck: check(
      'pth_snapshot_shape_check',
      sql`jsonb_typeof(${t.snapshot}) = 'object'`,
    ),
    reasonCheck: check(
      'pth_reason_check',
      sql`${t.reason} IS NULL OR length(trim(${t.reason})) > 0`,
    ),
    versionDescIdx: index('idx_theme_history_version').on(sql`${t.version} DESC`),
    publishedAtIdx: index('idx_theme_history_published_at').on(sql`${t.publishedAt} DESC`),
    changedByIdx: index('idx_theme_history_changed_by')
      .on(t.changedBy)
      .where(sql`${t.changedBy} IS NOT NULL`),
  }),
);

export type PlatformThemeHistory = typeof platformThemeHistory.$inferSelect;
export type NewPlatformThemeHistory = typeof platformThemeHistory.$inferInsert;
