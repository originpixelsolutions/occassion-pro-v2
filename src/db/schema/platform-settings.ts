import { sql } from 'drizzle-orm';
import {
  pgTable,
  smallint,
  boolean,
  timestamp,
  check,
} from 'drizzle-orm/pg-core';

/**
 * platform_settings — Phase 1, Unit 3.
 *
 * Singleton: exactly one row, id = 1. Mirrors
 * `supabase/migrations/0003_platform_settings.sql`.
 *
 * Spec refs: 2.9.2 (Sole Operator Mode), 2.9.8 (auto-disable trigger,
 * lands Phase 11).
 */
export const platformSettings = pgTable(
  'platform_settings',
  {
    id: smallint('id').primaryKey().default(1),
    soleOperatorMode: boolean('sole_operator_mode').notNull().default(true),
    soleOperatorDisabledAt: timestamp('sole_operator_disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    singletonCheck: check('platform_settings_singleton', sql`${t.id} = 1`),
    soleOperatorConsistencyCheck: check(
      'platform_settings_sole_operator_consistency',
      sql`(${t.soleOperatorMode} = true  AND ${t.soleOperatorDisabledAt} IS NULL)
          OR
          (${t.soleOperatorMode} = false AND ${t.soleOperatorDisabledAt} IS NOT NULL)`,
    ),
  }),
);

export type PlatformSettings = typeof platformSettings.$inferSelect;
