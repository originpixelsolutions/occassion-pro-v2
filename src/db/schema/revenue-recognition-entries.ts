import { sql } from 'drizzle-orm';
import { check, date, index, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const REVENUE_RECOGNITION_METHODS = [
  'straight_line', 'milestone', 'immediate',
] as const;
export type RevenueRecognitionMethod = (typeof REVENUE_RECOGNITION_METHODS)[number];

export const revenueRecognitionEntries = pgTable(
  'revenue_recognition_entries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id'), // FK added in Phase 6
    amountTotal: numeric('amount_total', { precision: 14, scale: 2 }).notNull(),
    amountRecognized: numeric('amount_recognized', { precision: 14, scale: 2 }).notNull().default('0'),
    amountDeferred: numeric('amount_deferred', { precision: 14, scale: 2 }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    recognitionMethod: text('recognition_method').$type<RevenueRecognitionMethod>().notNull().default('straight_line'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    methodEnum: check(
      'rre_method',
      sql`${t.recognitionMethod} IN ('straight_line','milestone','immediate')`,
    ),
    currencyFmt: check('rre_currency_fmt', sql`${t.currencyCode} ~ '^[A-Z]{3}$'`),
    totalPos: check('rre_total_pos', sql`${t.amountTotal} > 0`),
    recognizedNonNeg: check('rre_recognized_non_neg', sql`${t.amountRecognized} >= 0`),
    deferredNonNeg: check('rre_deferred_non_neg', sql`${t.amountDeferred} >= 0`),
    periodOrder: check('rre_period_order', sql`${t.periodEnd} > ${t.periodStart}`),
    bookkeeping: check(
      'rre_bookkeeping',
      sql`${t.amountRecognized} + ${t.amountDeferred} = ${t.amountTotal}`,
    ),
    periodIdx: index('idx_revrec_period').on(t.periodStart, t.periodEnd),
  }),
);
export type RevenueRecognitionEntry = typeof revenueRecognitionEntries.$inferSelect;
