import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  boolean,
  timestamp,
  primaryKey,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { SUPER_ADMIN_ROLES, type SuperAdminRole } from './super-admins.js';

/**
 * super_admin_role_permissions — Phase 1, Unit 2.
 *
 * Mirrors `supabase/migrations/0002_super_admin_role_permissions.sql`.
 * Composite PK (role, capability). Seeded in Phase 12 with the full
 * 7-role x 23-capability matrix from spec 2.9.3.
 */
export { SUPER_ADMIN_ROLES, type SuperAdminRole };

export const superAdminRolePermissions = pgTable(
  'super_admin_role_permissions',
  {
    role: text('role').$type<SuperAdminRole>().notNull(),
    capability: text('capability').notNull(),

    granted: boolean('granted').notNull().default(false),
    needsApproval: boolean('needs_approval').notNull().default(false),

    conditional: text('conditional'),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.role, t.capability] }),
    roleCheck: check(
      'sarp_role_check',
      sql`${t.role} IN ('owner','admin','engineering','support','sales','finance','auditor')`,
    ),
    capabilityCheck: check(
      'sarp_capability_check',
      sql`length(trim(${t.capability})) > 0`,
    ),
    capabilityGrantedIdx: index('idx_sarp_capability_granted')
      .on(t.capability)
      .where(sql`${t.granted} = true`),
    roleNeedsApprovalIdx: index('idx_sarp_role_needs_approval')
      .on(t.role)
      .where(sql`${t.granted} = true AND ${t.needsApproval} = true`),
  }),
);

export type SuperAdminRolePermission = typeof superAdminRolePermissions.$inferSelect;
export type NewSuperAdminRolePermission = typeof superAdminRolePermissions.$inferInsert;
