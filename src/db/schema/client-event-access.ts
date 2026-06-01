import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';
import { clientAccounts } from './client-accounts.js';

export const CLIENT_EVENT_ACCESS_ROLES = ['primary','secondary','viewer','approver','signer'] as const;
export type ClientEventAccessRole = (typeof CLIENT_EVENT_ACCESS_ROLES)[number];

export const clientEventAccess = pgTable(
  'client_event_access',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    clientAccountId: uuid('client_account_id').notNull().references(() => clientAccounts.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    permissions: jsonb('permissions').notNull().default(sql`'{}'::jsonb`),
    role: text('role').$type<ClientEventAccessRole>().notNull().default('primary'),
    invitedBy: uuid('invited_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().default(sql`now()`),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    revokedReason: text('revoked_reason'),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    accessUq: uniqueIndex('uq_client_event_access').on(t.clientAccountId, t.eventId),
    clientIx: index('idx_client_event_access_client').on(t.clientAccountId).where(sql`${t.revokedAt} IS NULL`),
    roleEnum: check('cea_role_enum', sql`${t.role} IN ('primary','secondary','viewer','approver','signer')`),
    revokeCoupling: check('cea_revoke_coupling', sql`${t.revokedAt} IS NULL OR (${t.revokedBy} IS NOT NULL AND ${t.revokedReason} IS NOT NULL)`),
  }),
);
export type ClientEventAccess = typeof clientEventAccess.$inferSelect;
