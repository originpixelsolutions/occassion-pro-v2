import { pgTable, varchar, date, numeric, text, primaryKey, index } from 'drizzle-orm/pg-core';

export const currencyRates = pgTable(
  'currency_rates',
  {
    rateDate: date('rate_date').notNull(),
    baseCode: varchar('base_code', { length: 3 }).notNull(),
    targetCode: varchar('target_code', { length: 3 }).notNull(),
    rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
    source: text('source').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.rateDate, t.baseCode, t.targetCode] }),
    dateIdx: index('idx_currency_rates_date').on(t.rateDate),
  }),
);
export type CurrencyRate = typeof currencyRates.$inferSelect;
