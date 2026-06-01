import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { guests } from './guests.js';

export const PLUS_ONE_AGE_CATEGORIES = ['adult','child','infant'] as const;
export type PlusOneAgeCategory = (typeof PLUS_ONE_AGE_CATEGORIES)[number];

export const guestPlusOnes = pgTable(
  'guest_plus_ones',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    primaryGuestId: uuid('primary_guest_id').notNull().references(() => guests.id, { onDelete: 'cascade' }),
    name: text('name'),
    dietaryRequirement: text('dietary_requirement'),
    accessibilityNeeds: text('accessibility_needs'),
    ageCategory: text('age_category').$type<PlusOneAgeCategory>().notNull().default('adult'),
    rsvpStatus: text('rsvp_status').notNull().default('attending'),
    checkInStatus: text('check_in_status').notNull().default('not_checked_in'),
    checkInAt: timestamp('check_in_at', { withTimezone: true }),
    checkOutAt: timestamp('check_out_at', { withTimezone: true }),
    erasedAt: timestamp('erased_at', { withTimezone: true }),
    erasedReason: text('erased_reason'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    primaryIx: index('idx_plus_ones_primary').on(t.primaryGuestId),
    eventIx: index('idx_plus_ones_event').on(t.eventId),
    ageEnum: check('po_age_enum', sql`${t.ageCategory} IN ('adult','child','infant')`),
    rsvpEnum: check('po_rsvp_enum', sql`${t.rsvpStatus} IN ('attending','not_attending')`),
    checkInEnum: check('po_check_in_enum', sql`${t.checkInStatus} IN ('not_checked_in','checked_in','checked_out','no_show')`),
    erasedCoupling: check('po_erased_coupling', sql`(${t.erasedAt} IS NULL) = (${t.erasedReason} IS NULL)`),
  }),
);
export type GuestPlusOne = typeof guestPlusOnes.$inferSelect;
