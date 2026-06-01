import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { vendorAccounts } from './vendor-accounts.js';

export const VENDOR_TEMPLATE_TYPES = ['html', 'pdf_overlay', 'docx'] as const;
export type VendorTemplateType = (typeof VENDOR_TEMPLATE_TYPES)[number];

export const vendorInvoiceTemplates = pgTable(
  'vendor_invoice_templates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    vendorAccountId: uuid('vendor_account_id')
      .notNull()
      .references(() => vendorAccounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    templateType: text('template_type').$type<VendorTemplateType>().notNull(),
    templateFileR2Key: text('template_file_r2_key'),
    templateHtml: text('template_html'),
    templateFileSizeBytes: bigint('template_file_size_bytes', { mode: 'bigint' }),
    templateFileHashSha256: text('template_file_hash_sha256'),
    defaultLogoUrl: text('default_logo_url'),
    defaultTerms: text('default_terms'),
    defaultPaymentTermsDays: integer('default_payment_terms_days'),
    defaultCurrencyCode: varchar('default_currency_code', { length: 3 }),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retiredReason: text('retired_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    defaultUq: uniqueIndex('uq_vendor_invoice_templates_default')
      .on(t.vendorAccountId)
      .where(sql`${t.isDefault} = TRUE AND ${t.deletedAt} IS NULL`),
    nameUq: uniqueIndex('uq_vendor_invoice_templates_name')
      .on(t.vendorAccountId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    vendorIx: index('idx_vendor_templates')
      .on(t.vendorAccountId)
      .where(sql`${t.deletedAt} IS NULL`),
    typeEnum: check('vit_type_enum', sql`${t.templateType} IN ('html','pdf_overlay','docx')`),
    htmlRequiresContent: check(
      'vit_html_requires_content',
      sql`${t.templateType} <> 'html' OR ${t.templateHtml} IS NOT NULL`,
    ),
    fileRequiresKey: check(
      'vit_file_requires_key',
      sql`${t.templateType} = 'html' OR ${t.templateFileR2Key} IS NOT NULL`,
    ),
    activeRetiredCoupling: check(
      'vit_active_retired_coupling',
      sql`NOT ${t.isActive} OR ${t.retiredAt} IS NULL`,
    ),
  }),
);
export type VendorInvoiceTemplate = typeof vendorInvoiceTemplates.$inferSelect;
