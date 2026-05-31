import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';
import { superAdmins } from './super-admins.js';

export const DISPUTE_CHANNELS = ['email','phone','support_ticket','legal_notice','other'] as const;
export type DisputeChannel = (typeof DISPUTE_CHANNELS)[number];

export const pendingEmergencyTransfers = pgTable(
  'pending_emergency_transfers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    currentOwnerId: uuid('current_owner_id')
      .notNull()
      .references(() => tenantMembers.id, { onDelete: 'restrict' }),
    proposedOwnerId: uuid('proposed_owner_id')
      .notNull()
      .references(() => tenantMembers.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    evidenceUrl: text('evidence_url'),
    initiatedByAdmin: uuid('initiated_by_admin')
      .notNull()
      .references(() => superAdmins.id, { onDelete: 'restrict' }),
    initiatedAt: timestamp('initiated_at', { withTimezone: true }).notNull().default(sql`now()`),
    disputeWindowEnd: timestamp('dispute_window_end', { withTimezone: true }).notNull(),
    disputedAt: timestamp('disputed_at', { withTimezone: true }),
    disputeChannel: text('dispute_channel').$type<DisputeChannel>(),
    disputeReason: text('dispute_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by').references(() => superAdmins.id, { onDelete: 'set null' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => superAdmins.id, { onDelete: 'set null' }),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    reversedBy: uuid('reversed_by').references(() => superAdmins.id, { onDelete: 'set null' }),
  },
  (t) => ({
    reasonLen: check('pet_reason_len', sql`length(trim(${t.reason})) BETWEEN 20 AND 2000`),
    differentOwners: check(
      'pet_owners_differ',
      sql`${t.currentOwnerId} <> ${t.proposedOwnerId}`,
    ),
    disputeWindowFuture: check(
      'pet_dispute_window_future',
      sql`${t.disputeWindowEnd} > ${t.initiatedAt}`,
    ),
    terminalMx: check(
      'pet_terminal_mx',
      sql`((${t.completedAt} IS NOT NULL)::int + (${t.cancelledAt} IS NOT NULL)::int) <= 1`,
    ),
    tenantIdx: index('idx_pet_tenant').on(t.tenantId),
  }),
);
export type PendingEmergencyTransfer = typeof pendingEmergencyTransfers.$inferSelect;
