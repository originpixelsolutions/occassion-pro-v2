import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';
import { citext } from '../columns.js';

export const INVOICE_RECIPIENT_ROLES = [
  'finance','accounts_payable','ceo','operations','admin','other',
] as const;
export type InvoiceRecipientRole = (typeof INVOICE_RECIPIENT_ROLES)[number];

export const tenantInvoiceRecipients = pgTable(
  'tenant_invoice_recipients',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    name: text('name'),
    role: text('role').$type<InvoiceRecipientRole>(),
    receiveInvoices: boolean('receive_invoices').notNull().default(true),
    receiveReceipts: boolean('receive_receipts').notNull().default(true),
    receiveDunning: boolean('receive_dunning').notNull().default(true),
    addedBy: uuid('added_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => ({
    emailFmt: check(
      'tir_email_fmt',
      sql`${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' AND length(${t.email}) <= 254`,
    ),
    roleEnum: check(
      'tir_role',
      sql`${t.role} IS NULL OR ${t.role} IN ('finance','accounts_payable','ceo','operations','admin','other')`,
    ),
    atLeastOneChannel: check(
      'tir_one_channel',
      sql`${t.receiveInvoices} OR ${t.receiveReceipts} OR ${t.receiveDunning}`,
    ),
  }),
);
export type TenantInvoiceRecipient = typeof tenantInvoiceRecipients.$inferSelect;
