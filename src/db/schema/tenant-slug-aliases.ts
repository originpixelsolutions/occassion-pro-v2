import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { superAdmins } from './super-admins.js';

/**
 * tenant_slug_aliases — Phase 2, Unit 5 (spec 3.5).
 *
 * 90-day slug redirect log; a trigger (in SQL only) enforces at-most-one
 * active alias per old_slug.
 */
export const tenantSlugAliases = pgTable(
  'tenant_slug_aliases',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    oldSlug: text('old_slug').notNull(),
    newSlug: text('new_slug').notNull(),
    redirectUntil: timestamp('redirect_until', { withTimezone: true }).notNull(),
    reason: text('reason'),
    changedBy: uuid('changed_by').references(() => superAdmins.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    oldSlugFmt: check(
      'slug_alias_old_format',
      sql`${t.oldSlug} ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'`,
    ),
    newSlugFmt: check(
      'slug_alias_new_format',
      sql`${t.newSlug} ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'`,
    ),
    slugsDiffer: check('slug_alias_differ', sql`${t.oldSlug} <> ${t.newSlug}`),
    tenantIdx: index('idx_slug_alias_tenant').on(t.tenantId),
    newIdx: index('idx_slug_alias_new').on(t.newSlug),
  }),
);
export type TenantSlugAlias = typeof tenantSlugAliases.$inferSelect;
