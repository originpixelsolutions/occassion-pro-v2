import { sql } from 'drizzle-orm';
import { boolean, check, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { sessions } from './sessions.js';
import { tenantMembers } from './tenant-members.js';
import { speakerAccounts } from './speaker-accounts.js';

export const SPEAKER_ROLES = ['speaker','moderator','panelist','keynote'] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];

export const SPEAKER_ASSIGNMENT_STATUSES = ['invited','confirmed','declined','cancelled'] as const;
export type SpeakerAssignmentStatus = (typeof SPEAKER_ASSIGNMENT_STATUSES)[number];

export const speakerEventAssignments = pgTable(
  'speaker_event_assignments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    speakerAccountId: uuid('speaker_account_id').notNull().references(() => speakerAccounts.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
    role: text('role').$type<SpeakerRole>().notNull().default('speaker'),
    status: text('status').$type<SpeakerAssignmentStatus>().notNull().default('invited'),
    invitedBy: uuid('invited_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().default(sql`now()`),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    declinedReason: text('declined_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    honorarium: numeric('honorarium', { precision: 14, scale: 2 }),
    currencyCode: varchar('currency_code', { length: 3 }),
    travelExpensesCovered: boolean('travel_expenses_covered').notNull().default(false),
    bioSnapshot: text('bio_snapshot'),
    presentationUrl: text('presentation_url'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    activeUq: uniqueIndex('uq_speaker_event_assignments_active')
      .on(t.speakerAccountId, t.sessionId).where(sql`${t.deletedAt} IS NULL`),
    eventStatusIx: index('idx_speaker_assignments_status').on(t.eventId, t.status).where(sql`${t.deletedAt} IS NULL`),
    roleEnum: check('sea_role_enum', sql`${t.role} IN ('speaker','moderator','panelist','keynote')`),
    statusEnum: check('sea_status_enum', sql`${t.status} IN ('invited','confirmed','declined','cancelled')`),
    honorariumCoupling: check('sea_honorarium_coupling', sql`(${t.honorarium} IS NULL) = (${t.currencyCode} IS NULL)`),
  }),
);
export type SpeakerEventAssignment = typeof speakerEventAssignments.$inferSelect;
