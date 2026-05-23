import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, unique, index } from 'drizzle-orm/pg-core';

export const WHATSAPP_CATEGORIES = [
  'authentication',
  'transactional',
  'marketing',
  'utility',
] as const;
export type WhatsappCategory = (typeof WHATSAPP_CATEGORIES)[number];

export const WHATSAPP_META_STATUSES = ['pending', 'approved', 'rejected', 'paused'] as const;
export type WhatsappMetaStatus = (typeof WHATSAPP_META_STATUSES)[number];

export const whatsappTemplates = pgTable(
  'whatsapp_templates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    templateName: text('template_name').notNull(),
    category: text('category').$type<WhatsappCategory>().notNull(),
    languageCode: text('language_code').notNull().default('en'),
    bodyText: text('body_text').notNull(),
    variables: text('variables')
      .array()
      .notNull()
      .default(sql`'{}'`),
    metaStatus: text('meta_status').$type<WhatsappMetaStatus>().notNull().default('pending'),
    metaTemplateId: text('meta_template_id'),
    dltTemplateId: text('dlt_template_id'),
    dltEntityId: text('dlt_entity_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    nameLangUq: unique('whatsapp_templates_template_name_language_code_key').on(
      t.templateName,
      t.languageCode,
    ),
    statusIdx: index('idx_whatsapp_templates_status').on(t.metaStatus),
  }),
);
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
