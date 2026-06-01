import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { guests } from './guests.js';

export const GUEST_OTP_CHANNELS = ['whatsapp', 'sms', 'email'] as const;
export type GuestOtpChannel = (typeof GUEST_OTP_CHANNELS)[number];

export const GUEST_OTP_INVALIDATED_REASONS = [
  'max_attempts',
  'superseded',
  'manual',
  'expired_rotation',
] as const;
export type GuestOtpInvalidatedReason = (typeof GUEST_OTP_INVALIDATED_REASONS)[number];

export const guestOtps = pgTable(
  'guest_otps',
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
    guestId: uuid('guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    channel: text('channel').$type<GuestOtpChannel>().notNull(),
    recipient: text('recipient').notNull(),
    otpHash: text('otp_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    invalidatedReason: text('invalidated_reason').$type<GuestOtpInvalidatedReason>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    recipientIx: index('idx_guest_otps_recipient').on(t.recipient, t.eventId, t.expiresAt),
    guestIx: index('idx_guest_otps_guest').on(t.guestId),
    channelEnum: check('go_channel_enum', sql`${t.channel} IN ('whatsapp','sms','email')`),
    attemptsRange: check('go_attempts_range', sql`${t.attempts} BETWEEN 0 AND 5`),
    expiryWindow: check(
      'go_expiry_window',
      sql`${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + interval '15 minutes'`,
    ),
    invCoupling: check(
      'go_inv_coupling',
      sql`(${t.invalidatedAt} IS NULL) = (${t.invalidatedReason} IS NULL)`,
    ),
    terminalXor: check(
      'go_terminal_xor',
      sql`${t.consumedAt} IS NULL OR ${t.invalidatedAt} IS NULL`,
    ),
  }),
);
export type GuestOtp = typeof guestOtps.$inferSelect;
