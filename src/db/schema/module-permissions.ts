import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

export const PERMISSION_ROLES = ['event_manager', 'team_lead', 'team_member'] as const;
export type PermissionRole = (typeof PERMISSION_ROLES)[number];

export const PERMISSION_MODULES = [
  'events','event_templates','event_types','clients','vendors','guests',
  'runsheet','budget','expenses','payments','invoices','contracts',
  'documents','tasks','crew','f_and_b','inventory','floorplan',
  'shared_inbox','calendar','reports','team_members','settings','billing',
  'integrations','audit_log','api_keys','custom_domains','sso','exports','webhooks',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const modulePermissions = pgTable(
  'module_permissions',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    role: text('role').$type<PermissionRole>().notNull(),
    module: text('module').$type<PermissionModule>().notNull(),
    canRead: boolean('can_read').notNull().default(false),
    canWrite: boolean('can_write').notNull().default(false),
    canDelete: boolean('can_delete').notNull().default(false),
    canExport: boolean('can_export').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedBy: uuid('updated_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.role, t.module] }),
    roleEnum: check('mp_role', sql`${t.role} IN ('event_manager','team_lead','team_member')`),
    writeImpliesRead: check('mp_write_implies_read', sql`NOT ${t.canWrite}  OR ${t.canRead}`),
    deleteImpliesRead: check('mp_delete_implies_read', sql`NOT ${t.canDelete} OR ${t.canRead}`),
    exportImpliesRead: check('mp_export_implies_read', sql`NOT ${t.canExport} OR ${t.canRead}`),
    moduleIdx: index('idx_mp_module').on(t.module),
  }),
);
export type ModulePermission = typeof modulePermissions.$inferSelect;
