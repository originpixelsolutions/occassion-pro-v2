import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

export const subscriptionPauses = pgTable(
  'subscription_pauses',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    pausedAt: timestamp('paused_at', { withTimezone: true }).notNull().default(sql`now()`),
    pauseResumeAt: timestamp('pause_resume_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
    initiatedBy: uuid('initiated_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    resumedAt: timestamp('resumed_at', { withTimezone: true }),
    resumedBy: uuid('resumed_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    cancelledDuringPause: boolean('cancelled_during_pause').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    minDuration: check(
      'sp_min_duration',
      sql`${t.pauseResumeAt} >= ${t.pausedAt} + INTERVAL '7 days'`,
    ),
    maxDuration: check(
      'sp_max_duration',
      sql`${t.pauseResumeAt} <= ${t.pausedAt} + INTERVAL '120 days'`,
    ),
    resumedAfterPaused: check(
      'sp_resumed_after_paused',
      sql`${t.resumedAt} IS NULL OR ${t.resumedAt} >= ${t.pausedAt}`,
    ),
    tenantIdx: index('idx_subscription_pauses_tenant').on(t.tenantId, t.createdAt),
  }),
);
export type SubscriptionPause = typeof subscriptionPauses.$inferSelect;
