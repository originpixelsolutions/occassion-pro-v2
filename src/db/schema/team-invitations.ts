import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';
import { citext } from '../columns.js';

export const INVITATION_STATUSES = [
  'pending','accepting','accepted','revoked','expired',
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const INVITATION_ROLES = ['event_manager', 'team_lead', 'team_member'] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

export const teamInvitations = pgTable(
  'team_invitations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    invitedEmail: citext('invited_email').notNull(),
    role: text('role').$type<InvitationRole>().notNull(),
    token: text('token').notNull(),
    invitedBy: uuid('invited_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    status: text('status').$type<InvitationStatus>().notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    tokenUq: uniqueIndex('team_invitations_token_key').on(t.token),
    roleEnum: check('ti_role', sql`${t.role} IN ('event_manager','team_lead','team_member')`),
    statusEnum: check(
      'ti_status',
      sql`${t.status} IN ('pending','accepting','accepted','revoked','expired')`,
    ),
    tokenFmt: check(
      'ti_token_fmt',
      sql`length(${t.token}) BETWEEN 32 AND 256 AND ${t.token} ~ '^[A-Za-z0-9_-]+$'`,
    ),
    expiresFuture: check('ti_expires_future', sql`${t.expiresAt} > ${t.createdAt}`),
    tenantEmailIdx: index('idx_team_invitations_tenant_email').on(t.tenantId, t.invitedEmail, t.status),
  }),
);
export type TeamInvitation = typeof teamInvitations.$inferSelect;
