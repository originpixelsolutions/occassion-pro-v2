import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const WHATSAPP_CATEGORIES = [
  'authentication',
  'transactional',
  'marketing',
  'utility',
] as const;
export type WhatsappCategory = (typeof WHATSAPP_CATEGORIES)[number];

export const WHATSAPP_META_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'paused',
  'disabled',
] as const;
export type WhatsappMetaStatus = (typeof WHATSAPP_META_STATUSES)[number];

export const WHATSAPP_HEADER_FORMATS = [
  'none',
  'text',
  'image',
  'video',
  'document',
  'location',
] as const;
export type WhatsappHeaderFormat = (typeof WHATSAPP_HEADER_FORMATS)[number];

export const WHATSAPP_DLT_CONTENT_TYPES = [
  'transactional',
  'service_implicit',
  'service_explicit',
  'promotional',
] as const;
export type WhatsappDltContentType = (typeof WHATSAPP_DLT_CONTENT_TYPES)[number];

export const whatsappTemplates = pgTable(
  'whatsapp_templates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    templateName: text('template_name').notNull(),
    category: text('category').$type<WhatsappCategory>().notNull(),
    languageCode: text('language_code').notNull().default('en'),
    headerFormat: text('header_format').$type<WhatsappHeaderFormat>(),
    headerText: text('header_text'),
    bodyText: text('body_text').notNull(),
    footerText: text('footer_text'),
    variables: text('variables')
      .array()
      .notNull()
      .default(sql`'{}'`),
    exampleValues: jsonb('example_values'),
    buttons: jsonb('buttons'),
    metaStatus: text('meta_status').$type<WhatsappMetaStatus>().notNull().default('pending'),
    metaTemplateId: text('meta_template_id'),
    metaRejectionReason: text('meta_rejection_reason'),
    dltTemplateId: text('dlt_template_id'),
    dltEntityId: text('dlt_entity_id'),
    dltContentType: text('dlt_content_type').$type<WhatsappDltContentType>(),
    isSystem: boolean('is_system').notNull().default(false),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    disabledReason: text('disabled_reason'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    activeIx: index('idx_whatsapp_templates_active')
      .on(t.templateName, t.languageCode)
      .where(sql`${t.metaStatus} = 'approved' AND ${t.deletedAt} IS NULL`),
    metaUq: uniqueIndex('uq_whatsapp_templates_meta')
      .on(t.metaTemplateId)
      .where(sql`${t.metaTemplateId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    statusEnum: check(
      'whatsapp_templates_meta_status_check',
      sql`${t.metaStatus} IN ('pending','approved','rejected','paused','disabled')`,
    ),
    categoryEnum: check(
      'whatsapp_templates_category_check',
      sql`${t.category} IN ('authentication','transactional','marketing','utility')`,
    ),
    nameFmt: check(
      'wt_name_fmt',
      sql`${t.templateName} ~ '^[a-z][a-z0-9_]{0,250}[a-z0-9]$' AND length(${t.templateName}) BETWEEN 1 AND 512`,
    ),
    languageFmt: check('wt_language_fmt', sql`${t.languageCode} ~ '^[a-z]{2,3}(_[A-Z]{2})?$'`),
    approvedCoupling: check(
      'wt_approved_coupling',
      sql`${t.metaStatus} <> 'approved' OR (${t.approvedAt} IS NOT NULL AND ${t.metaTemplateId} IS NOT NULL)`,
    ),
  }),
);
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
