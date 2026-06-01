import { sql } from 'drizzle-orm';
import { bigint, boolean, check, customType, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { superAdmins } from './super-admins.js';

const textArray = customType<{ data: string[] | null; driverData: string }>({
  dataType() { return 'text[]'; },
});

export const FAQ_CATEGORIES = [
  'billing','events','guests','vendors','clients','speakers','runsheet','floor_plan',
  'inventory','communications','payments','exports','onboarding','account','security',
  'integrations','technical','other',
] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

export const FAQ_AUDIENCES = ['all','tenant_member','client','vendor','guest','speaker','super_admin'] as const;
export type FaqAudience = (typeof FAQ_AUDIENCES)[number];

export const FAQ_VISIBILITIES = ['public','authenticated','tenant_only','super_admin_only'] as const;
export type FaqVisibility = (typeof FAQ_VISIBILITIES)[number];

export const supportFaqs = pgTable(
  'support_faqs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    questionPattern: text('question_pattern').notNull(),
    answer: text('answer').notNull(),
    category: text('category').$type<FaqCategory>(),
    tags: textArray('tags'),
    languageCode: text('language_code').notNull().default('en'),
    audience: text('audience').$type<FaqAudience>().notNull().default('all'),
    visibility: text('visibility').$type<FaqVisibility>().notNull().default('public'),
    relatedHelpKeys: textArray('related_help_keys'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    viewCount: bigint('view_count', { mode: 'bigint' }).notNull().default(0n),
    helpfulCount: integer('helpful_count').notNull().default(0),
    unhelpfulCount: integer('unhelpful_count').notNull().default(0),
    botMatchCount: bigint('bot_match_count', { mode: 'bigint' }).notNull().default(0n),
    sourceUrl: text('source_url'),
    authorId: uuid('author_id').references(() => superAdmins.id, { onDelete: 'set null' }),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    lastReviewedBy: uuid('last_reviewed_by').references(() => superAdmins.id, { onDelete: 'set null' }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retiredReason: text('retired_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    activeIx: index('idx_support_faqs_active').on(t.category, t.sortOrder).where(sql`${t.isActive} = TRUE AND ${t.deletedAt} IS NULL`),
    categoryEnum: check('sf_category_enum', sql`${t.category} IS NULL OR ${t.category} IN ('billing','events','guests','vendors','clients','speakers','runsheet','floor_plan','inventory','communications','payments','exports','onboarding','account','security','integrations','technical','other')`),
    audienceEnum: check('sf_audience_enum', sql`${t.audience} IN ('all','tenant_member','client','vendor','guest','speaker','super_admin')`),
    visibilityEnum: check('sf_visibility_enum', sql`${t.visibility} IN ('public','authenticated','tenant_only','super_admin_only')`),
    activeRetiredCoupling: check('sf_active_retired_coupling', sql`NOT ${t.isActive} OR ${t.retiredAt} IS NULL`),
    reviewCoupling: check('sf_review_coupling', sql`(${t.lastReviewedAt} IS NULL) = (${t.lastReviewedBy} IS NULL)`),
  }),
);
export type SupportFaq = typeof supportFaqs.$inferSelect;
