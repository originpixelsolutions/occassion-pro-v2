import { sql } from 'drizzle-orm';
import { bigint, boolean, check, customType, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() { return 'bytea'; },
});

const textArrayNotNull = customType<{ data: string[]; driverData: string }>({
  dataType() { return 'text[]'; },
});

const inetArray = customType<{ data: string[] | null; driverData: string }>({
  dataType() { return 'inet[]'; },
});

export const WEBHOOK_SIGNING_ALGORITHMS = ['hmac_sha256','hmac_sha512'] as const;
export type WebhookSigningAlgorithm = (typeof WEBHOOK_SIGNING_ALGORITHMS)[number];

export const outgoingWebhookSubscriptions = pgTable(
  'outgoing_webhook_subscriptions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name'),
    description: text('description'),
    url: text('url').notNull(),
    events: textArrayNotNull('events').notNull(),
    signingSecretEncrypted: bytea('signing_secret_encrypted').notNull(),
    signingSecretKmsKeyId: text('signing_secret_kms_key_id').notNull(),
    signingAlgorithm: text('signing_algorithm').$type<WebhookSigningAlgorithm>().notNull().default('hmac_sha256'),
    isActive: boolean('is_active').notNull().default(true),
    isPaused: boolean('is_paused').notNull().default(false),
    allowedIps: inetArray('allowed_ips'),
    customHeaders: jsonb('custom_headers'),
    timeoutSeconds: integer('timeout_seconds').notNull().default(10),
    maxRetries: integer('max_retries').notNull().default(6),
    createdBy: uuid('created_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    lastDeliveredAt: timestamp('last_delivered_at', { withTimezone: true }),
    lastStatusCode: integer('last_status_code'),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    totalDeliveries: bigint('total_deliveries', { mode: 'bigint' }).notNull().default(0n),
    totalFailures: bigint('total_failures', { mode: 'bigint' }).notNull().default(0n),
    autoDisabledAt: timestamp('auto_disabled_at', { withTimezone: true }),
    autoDisabledReason: text('auto_disabled_reason'),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    pausedReason: text('paused_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    activeIx: index('idx_webhook_subs_active').on(t.tenantId).where(sql`${t.isActive} = TRUE AND ${t.isPaused} = FALSE AND ${t.deletedAt} IS NULL`),
    urlFmt: check('ows_url_fmt', sql`${t.url} ~ '^https://' AND length(${t.url}) BETWEEN 1 AND 2048`),
    algorithmEnum: check('ows_algorithm_enum', sql`${t.signingAlgorithm} IN ('hmac_sha256','hmac_sha512')`),
    failuresLeDeliveries: check('ows_failures_le_deliveries', sql`${t.totalFailures} <= ${t.totalDeliveries}`),
    pauseCoupling: check('ows_pause_coupling', sql`${t.isPaused} = FALSE OR (${t.pausedAt} IS NOT NULL AND ${t.pausedReason} IS NOT NULL)`),
  }),
);
export type OutgoingWebhookSubscription = typeof outgoingWebhookSubscriptions.$inferSelect;
