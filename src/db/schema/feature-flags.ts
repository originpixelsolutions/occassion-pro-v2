import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, uuid, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { subscriptionPlans } from './subscription-plans.js';

export const featureFlags = pgTable('feature_flags', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  defaultEnabled: boolean('default_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
export type FeatureFlag = typeof featureFlags.$inferSelect;

export const planFeatureFlags = pgTable(
  'plan_feature_flags',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: 'cascade' }),
    flagCode: text('flag_code')
      .notNull()
      .references(() => featureFlags.code, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.planId, t.flagCode] }),
    flagIdx: index('idx_plan_feature_flags_flag').on(t.flagCode),
  }),
);
export type PlanFeatureFlag = typeof planFeatureFlags.$inferSelect;
