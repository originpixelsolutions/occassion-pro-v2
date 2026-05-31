import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';
import type { PermissionModule } from './module-permissions.js';

/**
 * Per-member NULLABLE override on module_permissions.
 *   NULL  = inherit role default
 *   true  = explicit grant
 *   false = explicit deny
 */
export const memberPermissionOverrides = pgTable(
  'member_permission_overrides',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull().references(() => tenantMembers.id, { onDelete: 'cascade' }),
    module: text('module').$type<PermissionModule>().notNull(),
    canRead: boolean('can_read'),
    canWrite: boolean('can_write'),
    canDelete: boolean('can_delete'),
    canExport: boolean('can_export'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedBy: uuid('updated_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.memberId, t.module] }),
    atLeastOne: check(
      'mpo_at_least_one',
      sql`${t.canRead} IS NOT NULL OR ${t.canWrite} IS NOT NULL OR ${t.canDelete} IS NOT NULL OR ${t.canExport} IS NOT NULL`,
    ),
    writeImpliesNotDeniedRead: check(
      'mpo_write_implies_read',
      sql`${t.canWrite}  IS NULL OR ${t.canWrite}  IS FALSE OR ${t.canRead} IS NOT FALSE`,
    ),
    deleteImpliesNotDeniedRead: check(
      'mpo_delete_implies_read',
      sql`${t.canDelete} IS NULL OR ${t.canDelete} IS FALSE OR ${t.canRead} IS NOT FALSE`,
    ),
    exportImpliesNotDeniedRead: check(
      'mpo_export_implies_read',
      sql`${t.canExport} IS NULL OR ${t.canExport} IS FALSE OR ${t.canRead} IS NOT FALSE`,
    ),
    moduleIdx: index('idx_mpo_module').on(t.module),
  }),
);
export type MemberPermissionOverride = typeof memberPermissionOverrides.$inferSelect;
