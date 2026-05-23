import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core';
import { superAdmins } from './super-admins.js';

export const SUPER_ADMIN_APPROVAL_ACTIONS = [
  'force_purge',
  'emergency_transfer',
  'large_refund',
  'platform_secret_rotation',
  'archive_plan',
  'role_change_to_admin_or_owner',
  'pricing_override',
  'plan_create',
] as const;
export type SuperAdminApprovalAction = (typeof SUPER_ADMIN_APPROVAL_ACTIONS)[number];

export const superAdminApprovals = pgTable(
  'super_admin_approvals',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    actionType: text('action_type').$type<SuperAdminApprovalAction>().notNull(),
    initiatedBy: uuid('initiated_by').references(() => superAdmins.id, { onDelete: 'restrict' }),
    initiatorReason: text('initiator_reason').notNull(),
    targetEntityType: text('target_entity_type'),
    targetEntityId: uuid('target_entity_id'),
    proposedChanges: jsonb('proposed_changes'),
    approvedBy: uuid('approved_by').references(() => superAdmins.id, { onDelete: 'restrict' }),
    approverReason: text('approver_reason'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectedReason: text('rejected_reason'),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`(now() + INTERVAL '24 hours')`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pendingIdx: index('idx_sa_approvals_pending')
      .on(t.createdAt)
      .where(sql`${t.approvedAt} IS NULL AND ${t.rejectedAt} IS NULL AND ${t.executedAt} IS NULL`),
    initiatedByIdx: index('idx_sa_approvals_initiated_by').on(t.initiatedBy),
    differentApproverCheck: check(
      'sa_approvals_different_approver',
      sql`${t.initiatedBy} IS NULL OR ${t.approvedBy} IS NULL OR ${t.initiatedBy} <> ${t.approvedBy}`,
    ),
  }),
);
export type SuperAdminApproval = typeof superAdminApprovals.$inferSelect;
