import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';

export const EDIT_LOCK_RELEASE_REASONS = [
  'user',
  'heartbeat_lost',
  'takeover',
  'admin_force',
  'expired',
  'session_ended',
] as const;
export type EditLockReleaseReason = (typeof EDIT_LOCK_RELEASE_REASONS)[number];

export const eventEditSessions = pgTable(
  'event_edit_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => tenantMembers.id, { onDelete: 'cascade' }),
    fieldPath: text('field_path').notNull(),
    clientId: text('client_id'),
    userAgent: text('user_agent'),
    lockedAt: timestamp('locked_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`(now() + INTERVAL '60 seconds')`),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedReason: text('released_reason').$type<EditLockReleaseReason>(),
  },
  (t) => ({
    fieldPathLen: check('ees_field_path_len', sql`length(trim(${t.fieldPath})) BETWEEN 1 AND 500`),
    expiresUnder1h: check(
      'ees_expires_under_1h',
      sql`${t.expiresAt} <= ${t.lockedAt} + INTERVAL '1 hour'`,
    ),
    releasedPair: check(
      'ees_released_pair',
      sql`(${t.releasedAt} IS NULL) = (${t.releasedReason} IS NULL)`,
    ),
    eventActiveIdx: index('idx_edit_sessions_event').on(t.eventId),
  }),
);
export type EventEditSession = typeof eventEditSessions.$inferSelect;
