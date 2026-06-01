import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { revenueRecognitionEntries } from './revenue-recognition-entries.js';

export const revenueRecognitionMonthly = pgTable(
  'revenue_recognition_monthly',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => revenueRecognitionEntries.id, { onDelete: 'cascade' }),
    recognitionMonth: date('recognition_month').notNull(),
    amountRecognized: numeric('amount_recognized', { precision: 14, scale: 2 }).notNull(),
    recognizedAt: timestamp('recognized_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    entryMonthUq: uniqueIndex('revenue_recognition_monthly_entry_id_recognition_month_key').on(
      t.entryId,
      t.recognitionMonth,
    ),
    amountPos: check('rrm_amount_pos', sql`${t.amountRecognized} > 0`),
    firstOfMonth: check(
      'rrm_first_of_month',
      sql`${t.recognitionMonth} = date_trunc('month', ${t.recognitionMonth})::date`,
    ),
    monthIdx: index('idx_revrec_monthly_month').on(t.recognitionMonth),
  }),
);
export type RevenueRecognitionMonthly = typeof revenueRecognitionMonthly.$inferSelect;
