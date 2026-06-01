import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { notifications } from './notifications.js';

export const NOTIFICATION_CHANNELS = ['in_app','email','push','sms','whatsapp','slack','teams'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_DELIVERY_STATUSES = ['queued','sending','sent','delivered','read','failed','bounced','suppressed'] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    notificationId: uuid('notification_id').notNull().references(() => notifications.id, { onDelete: 'cascade' }),
    channel: text('channel').$type<NotificationChannel>().notNull(),
    provider: text('provider'),
    recipientAddress: text('recipient_address'),
    templateName: text('template_name'),
    status: text('status').$type<NotificationDeliveryStatus>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().default(sql`now()`),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    providerMessageId: text('provider_message_id'),
    costMicroUnits: bigint('cost_micro_units', { mode: 'bigint' }),
    costCurrency: varchar('cost_currency', { length: 3 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    providerUq: uniqueIndex('uq_notification_deliveries_provider')
      .on(t.channel, t.providerMessageId).where(sql`${t.providerMessageId} IS NOT NULL`),
    statusQueuedIx: index('idx_notification_deliveries_status').on(t.status).where(sql`${t.status} = 'queued'`),
    channelEnum: check('nd_channel_enum', sql`${t.channel} IN ('in_app','email','push','sms','whatsapp','slack','teams')`),
    statusEnum: check('nd_status_enum', sql`${t.status} IN ('queued','sending','sent','delivered','read','failed','bounced','suppressed')`),
    attemptsRange: check('nd_attempts_range', sql`${t.attempts} >= 0 AND ${t.attempts} <= 20`),
    costCoupling: check('nd_cost_coupling', sql`(${t.costMicroUnits} IS NULL) = (${t.costCurrency} IS NULL)`),
  }),
);
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
