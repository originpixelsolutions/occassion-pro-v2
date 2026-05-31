import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

export const PAYMENT_GATEWAYS = ['razorpay', 'stripe'] as const;
export type PaymentGateway = (typeof PAYMENT_GATEWAYS)[number];

export const CARD_BRANDS = [
  'visa',
  'mastercard',
  'amex',
  'rupay',
  'discover',
  'diners',
  'jcb',
  'unionpay',
  'other',
] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

export const tenantPaymentMethods = pgTable(
  'tenant_payment_methods',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    gateway: text('gateway').$type<PaymentGateway>().notNull(),
    gatewayPaymentMethodId: text('gateway_payment_method_id').notNull(),
    last4: text('last4'),
    brand: text('brand').$type<CardBrand>(),
    expMonth: integer('exp_month'),
    expYear: integer('exp_year'),
    isPrimary: boolean('is_primary').notNull().default(false),
    isBackup: boolean('is_backup').notNull().default(false),
    addedBy: uuid('added_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => ({
    gatewayEnum: check('tpm_gateway', sql`${t.gateway} IN ('razorpay','stripe')`),
    primaryBackupMx: check('tpm_primary_backup_mx', sql`NOT (${t.isPrimary} AND ${t.isBackup})`),
    expPair: check('tpm_exp_pair', sql`(${t.expMonth} IS NULL) = (${t.expYear} IS NULL)`),
    last4Fmt: check('tpm_last4_fmt', sql`${t.last4} IS NULL OR ${t.last4} ~ '^[0-9]{4}$'`),
    monthBounds: check('tpm_month', sql`${t.expMonth} IS NULL OR ${t.expMonth} BETWEEN 1 AND 12`),
    yearBounds: check(
      'tpm_year',
      sql`${t.expYear}  IS NULL OR ${t.expYear}  BETWEEN 2024 AND 2099`,
    ),
  }),
);
export type TenantPaymentMethod = typeof tenantPaymentMethods.$inferSelect;
