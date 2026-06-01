import { sql } from 'drizzle-orm';
import { check, date, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { superAdmins } from './super-admins.js';

export const PO_STATUSES = [
  'pending_review', 'approved', 'active', 'exhausted', 'expired', 'cancelled',
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    poNumber: text('po_number').notNull(),
    poAmount: numeric('po_amount', { precision: 14, scale: 2 }).notNull(),
    poCurrency: varchar('po_currency', { length: 3 }).notNull(),
    poIssuedDate: date('po_issued_date'),
    poExpiresDate: date('po_expires_date'),
    poDocumentUrl: text('po_document_url'),
    approvedByAdmin: uuid('approved_by_admin').references(() => superAdmins.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    status: text('status').$type<PoStatus>().notNull().default('pending_review'),
    amountConsumed: numeric('amount_consumed', { precision: 14, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => superAdmins.id, { onDelete: 'set null' }),
    cancelledReason: text('cancelled_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    tenantPoUq: uniqueIndex('purchase_orders_tenant_id_po_number_key').on(t.tenantId, t.poNumber),
    amountPos: check('po_amount_pos', sql`${t.poAmount} > 0`),
    currencyFmt: check('po_currency_fmt', sql`${t.poCurrency} ~ '^[A-Z]{3}$'`),
    consumedNonNeg: check('po_consumed_non_neg', sql`${t.amountConsumed} >= 0`),
    consumedUnderAmount: check(
      'po_consumed_under_amount',
      sql`${t.amountConsumed} <= ${t.poAmount}`,
    ),
    statusEnum: check(
      'po_status',
      sql`${t.status} IN ('pending_review','approved','active','exhausted','expired','cancelled')`,
    ),
    approvedPair: check(
      'po_approved_pair',
      sql`(${t.approvedAt} IS NULL) = (${t.approvedByAdmin} IS NULL)`,
    ),
    tenantStatusIdx: index('idx_po_tenant').on(t.tenantId, t.status),
  }),
);
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
