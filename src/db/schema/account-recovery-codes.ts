import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const RECOVERY_USER_TYPES = [
  'tenant_member', 'super_admin', 'client', 'vendor', 'speaker',
] as const;
export type RecoveryUserType = (typeof RECOVERY_USER_TYPES)[number];

export const accountRecoveryCodes = pgTable(
  'account_recovery_codes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull(),
    userType: text('user_type').$type<RecoveryUserType>().notNull(),
    codeHash: text('code_hash').notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedIp: text('consumed_ip'), // SQL type inet
    consumedUa: text('consumed_ua'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    codeHashUq: uniqueIndex('account_recovery_codes_code_hash_key').on(t.codeHash),
    userTypeEnum: check(
      'arc_user_type',
      sql`${t.userType} IN ('tenant_member','super_admin','client','vendor','speaker')`,
    ),
    codeHashLen: check('arc_code_hash_len', sql`length(${t.codeHash}) = 64`),
    consumedPair: check(
      'arc_consumed_pair',
      sql`(${t.consumedAt} IS NULL) = (${t.consumedIp} IS NULL)`,
    ),
    ownerIdx: index('idx_recovery_codes_owner').on(t.userId, t.userType),
  }),
);
export type AccountRecoveryCode = typeof accountRecoveryCodes.$inferSelect;
