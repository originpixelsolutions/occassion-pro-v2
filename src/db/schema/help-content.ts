import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const helpContent = pgTable(
  'help_content',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    contextKey: text('context_key').unique().notNull(),
    title: text('title').notNull(),
    bodyMarkdown: text('body_markdown'),
    videoUrl: text('video_url'),
    learnMoreUrl: text('learn_more_url'),
    locale: text('locale').notNull().default('en'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    contextIdx: index('idx_help_context')
      .on(t.contextKey, t.locale)
      .where(sql`${t.isActive} = true`),
  }),
);
export type HelpContent = typeof helpContent.$inferSelect;
