import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { inetArray } from '../columns.js'; // unused inet helper for now — see note
// note: drizzle doesn't have a first-class inet column; we use text() at the
// schema level (the SQL-side enforces it via the inet TYPE).

export const SIGNUP_OUTCOMES = [
  'verified',
  'rejected_captcha',
  'rejected_disposable',
  'rejected_ip_rate_limit',
  'rejected_device_fingerprint',
  'rejected_behavioral_pattern',
  'approved',
  'rejected_manual',
  'expired',
] as const;
export type SignupOutcome = (typeof SIGNUP_OUTCOMES)[number];

export const tenantSignupAttempts = pgTable(
  'tenant_signup_attempts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    emailHash: text('email_hash').notNull(),
    email: text('email').notNull(),
    ipAddress: text('ip_address').notNull(), // SQL type inet
    ipCountry: varchar('ip_country', { length: 2 }),
    userAgent: text('user_agent'),
    deviceFingerprint: text('device_fingerprint'),
    outcome: text('outcome').$type<SignupOutcome>().notNull(),
    riskScore: numeric('risk_score', { precision: 3, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    outcomeEnum: check(
      'signup_attempts_outcome',
      sql`${t.outcome} IN ('verified','rejected_captcha','rejected_disposable','rejected_ip_rate_limit','rejected_device_fingerprint','rejected_behavioral_pattern','approved','rejected_manual','expired')`,
    ),
    emailHashLen: check('signup_attempts_email_hash_len', sql`length(${t.emailHash}) = 64`),
    emailHashIdx: index('idx_signup_attempts_email_hash').on(t.emailHash),
    ipIdx: index('idx_signup_attempts_ip').on(t.ipAddress, t.createdAt),
  }),
);
export type TenantSignupAttempt = typeof tenantSignupAttempts.$inferSelect;
// keep inetArray import alive
void inetArray;
