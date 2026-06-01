import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, primaryKey, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const NOTIF_PREF_USER_TYPES = ['tenant_member','client','vendor','guest','speaker','super_admin'] as const;
export type NotifPrefUserType = (typeof NOTIF_PREF_USER_TYPES)[number];

export const DIGEST_FREQUENCIES = ['immediate','hourly','daily','weekly'] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id').notNull(),
    userType: text('user_type').$type<NotifPrefUserType>().notNull(),
    category: text('category').notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    inAppEnabled: boolean('in_app_enabled').notNull().default(true),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    pushEnabled: boolean('push_enabled').notNull().default(true),
    smsEnabled: boolean('sms_enabled').notNull().default(false),
    whatsappEnabled: boolean('whatsapp_enabled').notNull().default(false),
    slackEnabled: boolean('slack_enabled').notNull().default(false),
    teamsEnabled: boolean('teams_enabled').notNull().default(false),
    digestFrequency: text('digest_frequency').$type<DigestFrequency>(),
    quietHoursStart: time('quiet_hours_start'),
    quietHoursEnd: time('quiet_hours_end'),
    quietHoursTimezone: text('quiet_hours_timezone'),
    bypassQuietForCritical: boolean('bypass_quiet_for_critical').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.userType, t.category] }),
    userIx: index('idx_notif_prefs_user').on(t.userId, t.userType),
    userTypeEnum: check('np_user_type_enum', sql`${t.userType} IN ('tenant_member','client','vendor','guest','speaker','super_admin')`),
    quietHoursCoupling: check('np_quiet_hours_coupling', sql`(${t.quietHoursStart} IS NULL) = (${t.quietHoursEnd} IS NULL)`),
    tenantOrSuper: check('np_tenant_or_super', sql`${t.tenantId} IS NOT NULL OR ${t.userType} = 'super_admin'`),
  }),
);
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
