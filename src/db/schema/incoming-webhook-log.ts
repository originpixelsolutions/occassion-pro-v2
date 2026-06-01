import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const INCOMING_WEBHOOK_SOURCES = [
  'razorpay',
  'stripe',
  'cashfree',
  'paytm',
  'meta_whatsapp',
  'sendgrid',
  'twilio',
  'docusign',
  'signwell',
  'workos',
  'google_calendar',
  'outlook',
  'zapier',
  'generic_webhook',
] as const;
export type IncomingWebhookSource = (typeof INCOMING_WEBHOOK_SOURCES)[number];

export const INCOMING_WEBHOOK_STATUSES = [
  'received',
  'processing',
  'processed',
  'failed',
  'rejected',
  'duplicate',
] as const;
export type IncomingWebhookStatus = (typeof INCOMING_WEBHOOK_STATUSES)[number];

export const incomingWebhookLog = pgTable(
  'incoming_webhook_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    source: text('source').$type<IncomingWebhookSource>().notNull(),
    externalId: text('external_id'),
    eventType: text('event_type'),
    payload: jsonb('payload').notNull(),
    headers: jsonb('headers'),
    signatureValid: boolean('signature_valid'),
    signatureAlgorithm: text('signature_algorithm'),
    signatureReceived: text('signature_received'),
    sourceIp: text('source_ip'),
    userAgent: text('user_agent'),
    status: text('status').$type<IncomingWebhookStatus>().notNull().default('received'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    processingDurationMs: integer('processing_duration_ms'),
    error: text('error'),
    retryCount: integer('retry_count').notNull().default(0),
    relatedResourceType: text('related_resource_type'),
    relatedResourceId: text('related_resource_id'),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    sourceExternalUq: uniqueIndex('incoming_webhook_log_source_external_id_key').on(
      t.source,
      t.externalId,
    ),
    receivedIx: index('idx_incoming_webhook_received').on(t.receivedAt),
    sourceEnum: check(
      'iwl_source_enum',
      sql`${t.source} IN ('razorpay','stripe','cashfree','paytm','meta_whatsapp','sendgrid','twilio','docusign','signwell','workos','google_calendar','outlook','zapier','generic_webhook')`,
    ),
    statusEnum: check(
      'iwl_status_enum',
      sql`${t.status} IN ('received','processing','processed','failed','rejected','duplicate')`,
    ),
    retryRange: check('iwl_retry_range', sql`${t.retryCount} >= 0 AND ${t.retryCount} <= 20`),
  }),
);
export type IncomingWebhookLog = typeof incomingWebhookLog.$inferSelect;
