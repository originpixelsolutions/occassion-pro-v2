import { sql } from 'drizzle-orm';
import { boolean, check, customType, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext } from '../columns.js';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() { return 'bytea'; },
});

const textArray = customType<{ data: string[] | null; driverData: string }>({
  dataType() { return 'text[]'; },
});

export const speakerAccounts = pgTable(
  'speaker_accounts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: citext('email').notNull(),
    fullName: text('full_name'),
    phone: text('phone'),
    passwordHash: text('password_hash'),
    mfaSecret: bytea('mfa_secret'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    bio: text('bio'),
    photoUrl: text('photo_url'),
    socials: jsonb('socials'),
    expertiseTags: textArray('expertise_tags'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: text('last_login_ip'),
    lastMagicLinkAt: timestamp('last_magic_link_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    emailUq: uniqueIndex('speaker_accounts_email_key').on(t.email),
    mfaSecretCoupling: check('sa_mfa_secret_coupling', sql`${t.mfaEnabled} = FALSE OR ${t.mfaSecret} IS NOT NULL`),
    mfaPasswordCoupling: check('sa_mfa_password_coupling', sql`${t.mfaEnabled} = FALSE OR ${t.passwordHash} IS NOT NULL`),
    suspendCoupling: check('sa_suspend_coupling', sql`${t.suspendedAt} IS NULL OR ${t.suspendedReason} IS NOT NULL`),
  }),
);
export type SpeakerAccount = typeof speakerAccounts.$inferSelect;
