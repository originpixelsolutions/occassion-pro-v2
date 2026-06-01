import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const NOTIFICATION_RECIPIENT_TYPES = ['tenant_member','client','vendor','guest','speaker','super_admin'] as const;
export type NotificationRecipientType = (typeof NOTIFICATION_RECIPIENT_TYPES)[number];

export const NOTIFICATION_PRIORITIES = ['low','normal','high','critical'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    recipientType: text('recipient_type').$type<NotificationRecipientType>().notNull(),
    recipientId: uuid('recipient_id').notNull(),
    category: text('category').notNull(),
    priority: text('priority').$type<NotificationPriority>().notNull().default('normal'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    actionUrl: text('action_url'),
    data: jsonb('data'),
    isRead: boolean('is_read').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`(now() + interval '30 days')`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    recipientIx: index('idx_notifications_recipient').on(t.recipientType, t.recipientId, t.isRead),
    recipientEnum: check('n_recipient_enum', sql`${t.recipientType} IN ('tenant_member','client','vendor','guest','speaker','super_admin')`),
    priorityEnum: check('n_priority_enum', sql`${t.priority} IN ('low','normal','high','critical')`),
    readCoupling: check('n_read_coupling', sql`(${t.isRead} = TRUE) = (${t.readAt} IS NOT NULL)`),
    tenantOrSuper: check('n_tenant_or_super', sql`${t.tenantId} IS NOT NULL OR ${t.recipientType} = 'super_admin'`),
  }),
);
export type Notification = typeof notifications.$inferSelect;
