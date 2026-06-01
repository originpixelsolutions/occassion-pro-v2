import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { guests } from './guests.js';
import { tenantMembers } from './tenant-members.js';

export const RSVP_CHANGE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RsvpChangeStatus = (typeof RSVP_CHANGE_STATUSES)[number];

export const rsvpChangeRequests = pgTable(
  'rsvp_change_requests',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    guestId: uuid('guest_id').notNull().references(() => guests.id, { onDelete: 'cascade' }),
    oldRsvpStatus: text('old_rsvp_status').notNull(),
    newRsvpStatus: text('new_rsvp_status').notNull(),
    reason: text('reason'),
    status: text('status').$type<RsvpChangeStatus>().notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    eventStatusIx: index('idx_rsvp_changes_event').on(t.eventId, t.status),
    statusEnum: check('rcr_status_enum', sql`${t.status} IN ('pending','approved','rejected')`),
    differentStatuses: check('rcr_different_statuses', sql`${t.newRsvpStatus} <> ${t.oldRsvpStatus}`),
  }),
);
export type RsvpChangeRequest = typeof rsvpChangeRequests.$inferSelect;
