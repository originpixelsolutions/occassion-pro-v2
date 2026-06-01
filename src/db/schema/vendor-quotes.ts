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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';
import { vendorAccounts } from './vendor-accounts.js';
import { vendorEventAssignments } from './vendor-event-assignments.js';
import { clientAccounts } from './client-accounts.js';

export const VENDOR_QUOTE_STATUSES = [
  'draft',
  'submitted',
  'tenant_approved',
  'tenant_rejected',
  'client_approved',
  'client_rejected',
  'expired',
  'superseded',
] as const;
export type VendorQuoteStatus = (typeof VENDOR_QUOTE_STATUSES)[number];

export const vendorQuotes = pgTable(
  'vendor_quotes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    vendorAssignmentId: uuid('vendor_assignment_id')
      .notNull()
      .references(() => vendorEventAssignments.id, { onDelete: 'cascade' }),
    vendorAccountId: uuid('vendor_account_id')
      .notNull()
      .references(() => vendorAccounts.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    lineItems: jsonb('line_items'),
    notes: text('notes'),
    documentUrl: text('document_url'),
    status: text('status').$type<VendorQuoteStatus>().notNull().default('submitted'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    tenantReviewedAt: timestamp('tenant_reviewed_at', { withTimezone: true }),
    tenantReviewedBy: uuid('tenant_reviewed_by').references(() => tenantMembers.id, {
      onDelete: 'set null',
    }),
    tenantReviewNotes: text('tenant_review_notes'),
    sharedWithClientAt: timestamp('shared_with_client_at', { withTimezone: true }),
    clientAccountId: uuid('client_account_id').references(() => clientAccounts.id, {
      onDelete: 'set null',
    }),
    clientRespondedAt: timestamp('client_responded_at', { withTimezone: true }),
    clientResponseNotes: text('client_response_notes'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    supersededBy: uuid('superseded_by').references((): AnyPgColumn => vendorQuotes.id, {
      onDelete: 'set null',
    }),
    version: integer('version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    statusIx: index('idx_vendor_quotes_status_time')
      .on(t.status, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    statusEnum: check(
      'vq_status_enum',
      sql`${t.status} IN ('draft','submitted','tenant_approved','tenant_rejected','client_approved','client_rejected','expired','superseded')`,
    ),
    noSelfSupersede: check('vq_no_self_supersede', sql`${t.id} <> ${t.supersededBy}`),
    amountNonNeg: check('vq_amount_non_neg', sql`${t.amount} >= 0`),
  }),
);
export type VendorQuote = typeof vendorQuotes.$inferSelect;
