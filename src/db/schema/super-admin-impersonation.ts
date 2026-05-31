import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { superAdmins } from './super-admins.js';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

export const superAdminImpersonation = pgTable(
  'super_admin_impersonation',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    superAdminId: uuid('super_admin_id')
      .notNull()
      .references(() => superAdmins.id, { onDelete: 'restrict' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    impersonatedUser: uuid('impersonated_user')
      .notNull()
      .references(() => tenantMembers.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    sourceIp: text('source_ip'), // SQL type inet
    userAgent: text('user_agent'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    actionCount: integer('action_count').notNull().default(0),
  },
  (t) => ({
    reasonLen: check('sai_reason_len', sql`length(trim(${t.reason})) BETWEEN 10 AND 2000`),
    actionCountNonNeg: check('sai_action_count_non_neg', sql`${t.actionCount} >= 0`),
    endedOrder: check(
      'sai_ended_order',
      sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`,
    ),
    superAdminIdx: index('idx_sai_super_admin').on(t.superAdminId, t.startedAt),
  }),
);
export type SuperAdminImpersonation = typeof superAdminImpersonation.$inferSelect;
