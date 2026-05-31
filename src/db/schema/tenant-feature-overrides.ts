import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { featureFlags } from './feature-flags.js';
import { superAdmins } from './super-admins.js';

/**
 * tenant_feature_overrides — Phase 2, Unit 6 (spec 3.6).
 *
 * Per-tenant override on a feature flag. Precedence:
 *   tenant override > plan flag > feature default.
 */
export const tenantFeatureOverrides = pgTable('tenant_feature_overrides', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  flagCode: text('flag_code').notNull().references(() => featureFlags.code, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull(),
  reason: text('reason'),
  setByAdmin: uuid('set_by_admin').references(() => superAdmins.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.flagCode] }),
  reasonLen: check('tfo_reason_len', sql`${t.reason} IS NULL OR length(${t.reason}) <= 500`),
  flagIdx: index('idx_tfo_flag_code').on(t.flagCode),
  enabledIdx: index('idx_tfo_enabled').on(t.tenantId, t.enabled),
}));
export type TenantFeatureOverride = typeof tenantFeatureOverrides.$inferSelect;
