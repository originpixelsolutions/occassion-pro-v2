import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { citext } from '../columns.js';

export const CREW_ROLES = [
  'supervisor','runner','greeter','technical','security','usher','crowd_control',
  'sound','lighting','stage_hand','translator','medic','driver','other',
] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

export const crewPool = pgTable(
  'crew_pool',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    email: citext('email'),
    role: text('role').$type<CrewRole>(),
    hourlyRate: numeric('hourly_rate', { precision: 10, scale: 2 }),
    dailyRate: numeric('daily_rate', { precision: 10, scale: 2 }),
    currencyCode: varchar('currency_code', { length: 3 }),
    skills: text('skills').array(),
    languages: text('languages').array(),
    isFreelance: boolean('is_freelance').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    rating: numeric('rating', { precision: 2, scale: 1 }),
    totalEventsWorked: integer('total_events_worked').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    nameLen: check('cp_name_len', sql`length(trim(${t.fullName})) BETWEEN 1 AND 200`),
    phoneFmt: check('cp_phone_fmt', sql`${t.phone} IS NULL OR ${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`),
    rateCurrencyCoupling: check(
      'cp_rate_currency_coupling',
      sql`(${t.hourlyRate} IS NULL AND ${t.dailyRate} IS NULL) OR ${t.currencyCode} IS NOT NULL`,
    ),
    ratingBounds: check(
      'cp_rating_bounds',
      sql`${t.rating} IS NULL OR (${t.rating} >= 1.0 AND ${t.rating} <= 5.0)`,
    ),
    tenantIdx: index('idx_crew_pool_tenant').on(t.tenantId),
  }),
);
export type CrewPoolEntry = typeof crewPool.$inferSelect;
