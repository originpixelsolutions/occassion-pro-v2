import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { citext } from '../columns.js';

export const DUNNING_CHANNELS = ['email','sms','in_app','phone_call_scheduled'] as const;
export type DunningChannel = (typeof DUNNING_CHANNELS)[number];

export const DUNNING_OUTCOMES = [
  'sent','delivered','opened','clicked','paid','no_response','bounced','complained',
] as const;
export type DunningOutcome = (typeof DUNNING_OUTCOMES)[number];

export const dunningEvents = pgTable(
  'dunning_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id'), // FK added in Phase 6
    attemptNumber: integer('attempt_number').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().default(sql`now()`),
    channel: text('channel').$type<DunningChannel>().notNull(),
    outcome: text('outcome').$type<DunningOutcome>().notNull().default('sent'),
    recipientEmail: citext('recipient_email'),
    templateCode: text('template_code'),
    providerId: text('provider_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    attemptBounds: check('de_attempt_bounds', sql`${t.attemptNumber} BETWEEN 1 AND 5`),
    channelEnum: check(
      'de_channel',
      sql`${t.channel} IN ('email','sms','in_app','phone_call_scheduled')`,
    ),
    outcomeEnum: check(
      'de_outcome',
      sql`${t.outcome} IN ('sent','delivered','opened','clicked','paid','no_response','bounced','complained')`,
    ),
    tenantSentIdx: index('idx_dunning_tenant').on(t.tenantId, t.sentAt),
  }),
);
export type DunningEvent = typeof dunningEvents.$inferSelect;
