import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

export const INVENTORY_AUDIT_TYPES = [
  'periodic',
  'spot_check',
  'post_event',
  'annual',
  'triggered',
] as const;
export type InventoryAuditType = (typeof INVENTORY_AUDIT_TYPES)[number];

export const INVENTORY_AUDIT_STATUSES = ['in_progress', 'completed', 'cancelled'] as const;
export type InventoryAuditStatus = (typeof INVENTORY_AUDIT_STATUSES)[number];

export const inventoryAudits = pgTable(
  'inventory_audits',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    auditedAt: timestamp('audited_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    auditedBy: uuid('audited_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    auditType: text('audit_type').$type<InventoryAuditType>().notNull().default('periodic'),
    status: text('status').$type<InventoryAuditStatus>().notNull().default('in_progress'),
    snapshot: jsonb('snapshot'),
    discrepancies: jsonb('discrepancies'),
    itemCount: integer('item_count'),
    discrepancyCount: integer('discrepancy_count').notNull().default(0),
    totalValueAudited: numeric('total_value_audited', { precision: 14, scale: 2 }),
    totalValueCurrency: varchar('total_value_currency', { length: 3 }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    tenantTimeIx: index('idx_inventory_audits_tenant_time').on(t.tenantId, t.auditedAt),
    typeEnum: check(
      'iau_type_enum',
      sql`${t.auditType} IN ('periodic','spot_check','post_event','annual','triggered')`,
    ),
    statusEnum: check(
      'iau_status_enum',
      sql`${t.status} IN ('in_progress','completed','cancelled')`,
    ),
    valueCurrencyCoupling: check(
      'iau_value_currency',
      sql`(${t.totalValueAudited} IS NULL) = (${t.totalValueCurrency} IS NULL)`,
    ),
  }),
);
export type InventoryAudit = typeof inventoryAudits.$inferSelect;
