import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const BULK_OPERATION_TYPES = [
  'guest_import',
  'guest_bulk_delete',
  'email_send',
  'sms_send',
  'export',
  'webhook_deliver',
] as const;
export type BulkOperationType = (typeof BULK_OPERATION_TYPES)[number];

export const BULK_OPERATION_SCOPES = ['per_event', 'per_workspace', 'per_user'] as const;
export type BulkOperationScope = (typeof BULK_OPERATION_SCOPES)[number];

export const bulkOperationQuota = pgTable(
  'bulk_operation_quota',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    operationType: text('operation_type').$type<BulkOperationType>().notNull(),
    scope: text('scope').$type<BulkOperationScope>().notNull(),
    scopeId: uuid('scope_id').notNull(),
    date: date('date').notNull(),
    count: integer('count').notNull().default(0),
    limitValue: integer('limit_value'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.tenantId, t.operationType, t.scope, t.scopeId, t.date],
    }),
    opEnum: check(
      'boq_operation_type',
      sql`${t.operationType} IN ('guest_import','guest_bulk_delete','email_send','sms_send','export','webhook_deliver')`,
    ),
    scopeEnum: check('boq_scope', sql`${t.scope} IN ('per_event','per_workspace','per_user')`),
    countNonNeg: check('boq_count_non_neg', sql`${t.count} >= 0`),
    limitNonNeg: check('boq_limit_non_neg', sql`${t.limitValue} IS NULL OR ${t.limitValue} >= 0`),
    countUnderLimit: check(
      'boq_count_under_limit',
      sql`${t.limitValue} IS NULL OR ${t.count} <= ${t.limitValue}`,
    ),
    dateIdx: index('idx_bulk_quota_date').on(t.date),
  }),
);
export type BulkOperationQuota = typeof bulkOperationQuota.$inferSelect;
