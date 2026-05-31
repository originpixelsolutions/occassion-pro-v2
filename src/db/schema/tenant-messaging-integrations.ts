import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const MESSAGING_PROVIDERS = ['slack', 'microsoft_teams'] as const;
export type MessagingProvider = (typeof MESSAGING_PROVIDERS)[number];

export const MESSAGING_STATUSES = ['active', 'error', 'disconnected'] as const;
export type MessagingStatus = (typeof MESSAGING_STATUSES)[number];

export const tenantMessagingIntegrations = pgTable(
  'tenant_messaging_integrations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<MessagingProvider>().notNull(),
    webhookUrlEncrypted: bytea('webhook_url_encrypted').notNull(),
    channelName: text('channel_name'),
    workspaceName: text('workspace_name'),
    subscribedEvents: text('subscribed_events').array().notNull(),
    perEventRouting: jsonb('per_event_routing').$type<Record<string, string>>(),
    configuredBy: uuid('configured_by').references(() => tenantMembers.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<MessagingStatus>().notNull().default('active'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    providerEnum: check('tmi_provider', sql`${t.provider} IN ('slack','microsoft_teams')`),
    statusEnum: check('tmi_status', sql`${t.status} IN ('active','error','disconnected')`),
    webhookNonEmpty: check(
      'tmi_webhook_non_empty',
      sql`octet_length(${t.webhookUrlEncrypted}) > 0`,
    ),
    eventsNonEmpty: check('tmi_events_non_empty', sql`cardinality(${t.subscribedEvents}) >= 1`),
    routingObject: check(
      'tmi_routing_object',
      sql`${t.perEventRouting} IS NULL OR jsonb_typeof(${t.perEventRouting}) = 'object'`,
    ),
    errorRequiresMsg: check(
      'tmi_error_requires_msg',
      sql`${t.status} <> 'error' OR ${t.lastError} IS NOT NULL`,
    ),
    providerIdx: index('idx_tmi_provider').on(t.tenantId, t.provider),
  }),
);
export type TenantMessagingIntegration = typeof tenantMessagingIntegrations.$inferSelect;
