import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { outgoingWebhookSubscriptions } from './outgoing-webhook-subscriptions.js';

export const outgoingWebhookDeliveries = pgTable(
  'outgoing_webhook_deliveries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').notNull().references(() => outgoingWebhookSubscriptions.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    eventId: uuid('event_id').notNull().default(sql`gen_random_uuid()`),
    payload: jsonb('payload').notNull(),
    signature: text('signature'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastStatusCode: integer('last_status_code'),
    lastResponseBody: text('last_response_body'),
    lastError: text('last_error'),
    lastResponseHeaders: jsonb('last_response_headers'),
    durationMs: integer('duration_ms'),
    failedPermanently: boolean('failed_permanently').notNull().default(false),
    failedPermanentlyAt: timestamp('failed_permanently_at', { withTimezone: true }),
    failedPermanentlyReason: text('failed_permanently_reason'),
    idempotencyKey: text('idempotency_key'),
    triggerResourceType: text('trigger_resource_type'),
    triggerResourceId: text('trigger_resource_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    idempotencyUq: uniqueIndex('uq_webhook_deliveries_idempotency')
      .on(t.subscriptionId, t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
    pendingIx: index('idx_webhook_deliveries_pending').on(t.nextAttemptAt).where(sql`${t.deliveredAt} IS NULL AND ${t.failedPermanently} = FALSE`),
    attemptRange: check('owd_attempt_range', sql`${t.attemptCount} >= 0 AND ${t.attemptCount} <= 12`),
    delivVsFail: check('owd_deliv_vs_fail', sql`${t.deliveredAt} IS NULL OR ${t.failedPermanently} = FALSE`),
    failCoupling: check('owd_fail_coupling', sql`${t.failedPermanently} = FALSE OR (${t.failedPermanentlyAt} IS NOT NULL AND ${t.failedPermanentlyReason} IS NOT NULL)`),
  }),
);
export type OutgoingWebhookDelivery = typeof outgoingWebhookDeliveries.$inferSelect;
