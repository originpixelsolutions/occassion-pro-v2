import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';

export const TICKET_TYPES = [
  'general',
  'vip',
  'early_bird',
  'student',
  'press',
  'staff',
  'complimentary',
  'sponsor',
  'workshop',
  'exhibitor',
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const eventTickets = pgTable(
  'event_tickets',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    ticketType: text('ticket_type').$type<TicketType>().notNull(),
    name: text('name').notNull(),
    description: text('description'),
    price: numeric('price', { precision: 10, scale: 2 }).notNull().default('0'),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    quantityTotal: integer('quantity_total'),
    quantitySold: integer('quantity_sold').notNull().default(0),
    quantityReserved: integer('quantity_reserved').notNull().default(0),
    minPerOrder: integer('min_per_order').notNull().default(1),
    maxPerOrder: integer('max_per_order'),
    saleStartsAt: timestamp('sale_starts_at', { withTimezone: true }),
    saleEndsAt: timestamp('sale_ends_at', { withTimezone: true }),
    lateFee: numeric('late_fee', { precision: 10, scale: 2 }),
    lateWindowEndsAt: timestamp('late_window_ends_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    typeEnum: check(
      'et_ticket_type',
      sql`${t.ticketType} IN ('general','vip','early_bird','student','press','staff','complimentary','sponsor','workshop','exhibitor')`,
    ),
    pricePos: check('et_price_pos', sql`${t.price} >= 0`),
    currencyFmt: check('et_currency_fmt', sql`${t.currencyCode} ~ '^[A-Z]{3}$'`),
    capacity: check(
      'et_capacity',
      sql`${t.quantityTotal} IS NULL OR ${t.quantitySold} + ${t.quantityReserved} <= ${t.quantityTotal}`,
    ),
    perOrderRange: check(
      'et_per_order_range',
      sql`${t.maxPerOrder} IS NULL OR ${t.maxPerOrder} >= ${t.minPerOrder}`,
    ),
    saleWindow: check(
      'et_sale_window',
      sql`${t.saleEndsAt} IS NULL OR ${t.saleStartsAt} IS NULL OR ${t.saleEndsAt} > ${t.saleStartsAt}`,
    ),
    lateFeeCoupling: check(
      'et_late_fee_coupling',
      sql`(${t.lateFee} IS NULL AND ${t.lateWindowEndsAt} IS NULL)
       OR (${t.lateFee} IS NOT NULL AND ${t.lateWindowEndsAt} IS NOT NULL AND ${t.saleEndsAt} IS NOT NULL)`,
    ),
    eventIdx: index('idx_event_tickets_event').on(t.eventId),
  }),
);
export type EventTicket = typeof eventTickets.$inferSelect;
