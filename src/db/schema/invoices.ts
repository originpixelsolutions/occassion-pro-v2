import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { citext } from '../columns.js';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';
import { clientAccounts } from './client-accounts.js';

export const INVOICE_STATUSES = [
  'draft',
  'sent',
  'viewed',
  'paid',
  'partially_paid',
  'overdue',
  'cancelled',
  'refunded',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
    clientAccountId: uuid('client_account_id').references(() => clientAccounts.id, {
      onDelete: 'set null',
    }),
    invoiceNumber: text('invoice_number').notNull(),
    billToName: text('bill_to_name').notNull(),
    billToEmail: citext('bill_to_email'),
    billToAddress: text('bill_to_address'),
    billToPhone: text('bill_to_phone'),
    billToGstin: text('bill_to_gstin'),
    billToCountry: varchar('bill_to_country', { length: 2 }),
    lineItems: jsonb('line_items').notNull(),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull(),
    taxTotal: numeric('tax_total', { precision: 14, scale: 2 }).notNull(),
    discountTotal: numeric('discount_total', { precision: 14, scale: 2 }).notNull().default('0'),
    grandTotal: numeric('grand_total', { precision: 14, scale: 2 }).notNull(),
    amountPaid: numeric('amount_paid', { precision: 14, scale: 2 }).notNull().default('0'),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    taxBreakdown: jsonb('tax_breakdown'),
    status: text('status').$type<InvoiceStatus>().notNull().default('draft'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    pdfUrl: text('pdf_url'),
    pdfR2Key: text('pdf_r2_key'),
    notes: text('notes'),
    terms: text('terms'),
    createdBy: uuid('created_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
  },
  (t) => ({
    numberUq: uniqueIndex('invoices_tenant_invoice_number_key').on(t.tenantId, t.invoiceNumber),
    statusIx: index('idx_invoices_status')
      .on(t.tenantId, t.status, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    statusEnum: check(
      'inv_status_enum',
      sql`${t.status} IN ('draft','sent','viewed','paid','partially_paid','overdue','cancelled','refunded')`,
    ),
    grandTotalMath: check(
      'inv_grand_total_math',
      sql`${t.grandTotal} = ${t.subtotal} + ${t.taxTotal} - ${t.discountTotal}`,
    ),
    paidLeGrand: check('inv_paid_le_grand', sql`${t.amountPaid} <= ${t.grandTotal}`),
    currencyFmt: check('inv_currency_fmt', sql`${t.currencyCode} ~ '^[A-Z]{3}$'`),
  }),
);
export type Invoice = typeof invoices.$inferSelect;
