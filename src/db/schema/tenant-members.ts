import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext } from '../columns.js';
import { tenants } from './tenants.js';

export const TENANT_MEMBER_ROLES = ['owner', 'event_manager', 'team_lead', 'team_member'] as const;
export type TenantMemberRole = (typeof TENANT_MEMBER_ROLES)[number];

export const tenantMembers = pgTable(
  'tenant_members',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    fullName: text('full_name').notNull(),
    role: text('role').$type<TenantMemberRole>().notNull(),
    recoveryEmail: citext('recovery_email'),
    recoveryPhone: text('recovery_phone'),
    invitedBy: uuid('invited_by'),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    roleEnum: check(
      'tenant_members_role',
      sql`${t.role} IN ('owner','event_manager','team_lead','team_member')`,
    ),
    emailActiveUq: uniqueIndex('uq_tenant_members_email_active')
      .on(t.tenantId, t.email)
      .where(sql`${t.removedAt} IS NULL`),
    oneOwner: uniqueIndex('one_owner_per_workspace')
      .on(t.tenantId)
      .where(sql`${t.role} = 'owner' AND ${t.removedAt} IS NULL`),
    tenantActiveIdx: index('idx_tenant_members_tenant_active')
      .on(t.tenantId)
      .where(sql`${t.removedAt} IS NULL`),
  }),
);
export type TenantMember = typeof tenantMembers.$inferSelect;
