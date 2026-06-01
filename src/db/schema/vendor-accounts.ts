import { sql } from 'drizzle-orm';
import { boolean, check, customType, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { citext } from '../columns.js';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() { return 'bytea'; },
});

export const vendorAccounts = pgTable(
  'vendor_accounts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: citext('email').notNull(),
    companyName: text('company_name'),
    contactName: text('contact_name'),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    mfaSecret: bytea('mfa_secret'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    recoveryEmail: citext('recovery_email'),
    recoveryPhone: text('recovery_phone'),
    taxId: text('tax_id'),
    defaultCurrency: varchar('default_currency', { length: 3 }),
    bankAccountEncrypted: bytea('bank_account_encrypted'),
    bankKmsKeyId: text('bank_kms_key_id'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: text('last_login_ip'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    emailUq: uniqueIndex('vendor_accounts_email_key').on(t.email),
    mfaCoupling: check('va_mfa_coupling', sql`${t.mfaEnabled} = FALSE OR ${t.mfaSecret} IS NOT NULL`),
    suspendCoupling: check('va_suspend_coupling', sql`${t.suspendedAt} IS NULL OR ${t.suspendedReason} IS NOT NULL`),
    bankCoupling: check('va_bank_coupling', sql`(${t.bankAccountEncrypted} IS NULL) = (${t.bankKmsKeyId} IS NULL)`),
    currencyFmt: check('va_currency_fmt', sql`${t.defaultCurrency} IS NULL OR ${t.defaultCurrency} ~ '^[A-Z]{3}$'`),
  }),
);
export type VendorAccount = typeof vendorAccounts.$inferSelect;
