import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext } from '../columns.js';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';

export const guests = pgTable(
  'guests',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: citext('email'),
    phone: text('phone'),
    category: text('category'),
    tableNo: text('table_no'),
    dietaryRequirement: text('dietary_requirement'),
    accessibilityNeeds: text('accessibility_needs'),
    notes: text('notes'),
    rsvpStatus: text('rsvp_status').notNull().default('pending'),
    rsvpRespondedAt: timestamp('rsvp_responded_at', { withTimezone: true }),
    registrationStatus: text('registration_status').notNull().default('pending_approval'),
    approvedBy: uuid('approved_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    checkInStatus: text('check_in_status').notNull().default('not_checked_in'),
    checkInAt: timestamp('check_in_at', { withTimezone: true }),
    checkOutAt: timestamp('check_out_at', { withTimezone: true }),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    invitedVia: text('invited_via'),
    shortLinkId: uuid('short_link_id'),
    erasedAt: timestamp('erased_at', { withTimezone: true }),
    erasedReason: text('erased_reason'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    emailPerEvent: uniqueIndex('idx_guests_email_per_event')
      .on(t.eventId, sql`lower(${t.email}::text)`)
      .where(sql`${t.email} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    phonePerEvent: uniqueIndex('idx_guests_phone_per_event')
      .on(t.eventId, t.phone)
      .where(sql`${t.phone} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    eventIx: index('idx_guests_event').on(t.eventId).where(sql`${t.deletedAt} IS NULL`),
    rsvpEnum: check(
      'g_rsvp_status',
      sql`${t.rsvpStatus} IN ('pending','attending','not_attending','tentative')`,
    ),
    regEnum: check(
      'g_reg_status',
      sql`${t.registrationStatus} IN ('pending_approval','approved','rejected')`,
    ),
    checkInEnum: check(
      'g_check_in_status',
      sql`${t.checkInStatus} IN ('not_checked_in','checked_in','checked_out','no_show')`,
    ),
    erasedCoupling: check(
      'g_erased_coupling',
      sql`(${t.erasedAt} IS NULL) = (${t.erasedReason} IS NULL)`,
    ),
  }),
);
export type Guest = typeof guests.$inferSelect;
