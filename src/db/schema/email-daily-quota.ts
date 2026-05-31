import { sql } from 'drizzle-orm';
import { check, date, integer, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const emailDailyQuota = pgTable(
  'email_daily_quota',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    sentCount: integer('sent_count').notNull().default(0),
    limitValue: integer('limit_value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.date] }),
    sentNonNeg: check('edq_sent_non_neg', sql`${t.sentCount} >= 0`),
    limitNonNeg: check('edq_limit_non_neg', sql`${t.limitValue} >= 0`),
    sentUnderLimit: check('edq_sent_under_limit', sql`${t.sentCount} <= ${t.limitValue}`),
  }),
);
export type EmailDailyQuota = typeof emailDailyQuota.$inferSelect;
