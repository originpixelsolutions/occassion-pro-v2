import { sql } from 'drizzle-orm';
import { check, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const CHARGEBACK_GATEWAYS = ['razorpay', 'stripe'] as const;
export type ChargebackGateway = (typeof CHARGEBACK_GATEWAYS)[number];

export const CHARGEBACK_STATUSES = [
  'received','evidence_required','evidence_submitted','won','lost','accepted',
] as const;
export type ChargebackStatus = (typeof CHARGEBACK_STATUSES)[number];

export const CHARGEBACK_ACCOUNT_ACTIONS = [
  'none','warning','frozen','suspended','terminated',
] as const;
export type ChargebackAccountAction = (typeof CHARGEBACK_ACCOUNT_ACTIONS)[number];

export interface EvidenceFile {
  r2_key: string;
  filename: string;
  content_type: string;
  size_bytes?: number;
  category?: string;
}

export const chargebacks = pgTable(
  'chargebacks',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    paymentId: uuid('payment_id'), // FK added in Phase 6
    gateway: text('gateway').$type<ChargebackGateway>().notNull(),
    gatewayDisputeId: text('gateway_dispute_id').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    reasonCode: text('reason_code'),
    reasonDescription: text('reason_description'),
    status: text('status').$type<ChargebackStatus>().notNull().default('received'),
    evidenceDueBy: timestamp('evidence_due_by', { withTimezone: true }),
    evidenceSubmittedAt: timestamp('evidence_submitted_at', { withTimezone: true }),
    evidenceFiles: jsonb('evidence_files').$type<EvidenceFile[]>(),
    resolutionAt: timestamp('resolution_at', { withTimezone: true }),
    accountAction: text('account_action').$type<ChargebackAccountAction>().notNull().default('none'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    gatewayDisputeUq: uniqueIndex('chargebacks_gateway_gateway_dispute_id_key').on(
      t.gateway,
      t.gatewayDisputeId,
    ),
    gatewayEnum: check('cb_gateway', sql`${t.gateway} IN ('razorpay','stripe')`),
    statusEnum: check(
      'cb_status',
      sql`${t.status} IN ('received','evidence_required','evidence_submitted','won','lost','accepted')`,
    ),
    actionEnum: check(
      'cb_account_action',
      sql`${t.accountAction} IN ('none','warning','frozen','suspended','terminated')`,
    ),
    amountPos: check('cb_amount_pos', sql`${t.amount} > 0`),
    currencyFmt: check('cb_currency_fmt', sql`${t.currencyCode} ~ '^[A-Z]{3}$'`),
    evidenceArrayOnly: check(
      'cb_evidence_array_only',
      sql`${t.evidenceFiles} IS NULL OR jsonb_typeof(${t.evidenceFiles}) = 'array'`,
    ),
    tenantIdx: index('idx_chargebacks_tenant').on(t.tenantId),
  }),
);
export type Chargeback = typeof chargebacks.$inferSelect;
