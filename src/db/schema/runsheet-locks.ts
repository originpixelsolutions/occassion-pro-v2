import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';

export const runsheetLocks = pgTable(
  'runsheet_locks',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => events.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    lockedBy: uuid('locked_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    lockedAt: timestamp('locked_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    reason: text('reason'),
  },
  (t) => ({
    tenantIx: index('idx_runsheet_locks_tenant').on(t.tenantId),
    expiryWindow: check(
      'rl_expiry_window',
      sql`${t.expiresAt} IS NULL OR (${t.expiresAt} > ${t.lockedAt} AND ${t.expiresAt} <= ${t.lockedAt} + interval '24 hours')`,
    ),
  }),
);
export type RunsheetLock = typeof runsheetLocks.$inferSelect;
