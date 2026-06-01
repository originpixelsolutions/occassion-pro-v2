import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext } from '../columns.js';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const clientAccounts = pgTable(
  'client_accounts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: citext('email').notNull(),
    fullName: text('full_name'),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    mfaSecret: bytea('mfa_secret'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    recoveryEmail: citext('recovery_email'),
    recoveryPhone: text('recovery_phone'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: text('last_login_ip'), // SQL type inet
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
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
    emailUq: uniqueIndex('client_accounts_email_key').on(t.email),
    emailFmt: check(
      'ca_email_fmt',
      sql`${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' AND length(${t.email}) <= 254`,
    ),
    phoneFmt: check(
      'ca_phone_fmt',
      sql`${t.phone} IS NULL OR ${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`,
    ),
    passwordHashLen: check(
      'ca_password_hash_len',
      sql`length(${t.passwordHash}) BETWEEN 50 AND 200`,
    ),
    mfaCoupling: check(
      'ca_mfa_coupling',
      sql`${t.mfaEnabled} = FALSE OR ${t.mfaSecret} IS NOT NULL`,
    ),
    suspendCoupling: check(
      'ca_suspend_coupling',
      sql`${t.suspendedAt} IS NULL OR ${t.suspendedReason} IS NOT NULL`,
    ),
    failedNonNeg: check('ca_failed_non_neg', sql`${t.failedLoginCount} >= 0`),
  }),
);
export type ClientAccount = typeof clientAccounts.$inferSelect;
