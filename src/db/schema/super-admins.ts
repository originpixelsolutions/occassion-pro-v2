import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { citext, inetArray } from '../columns.js';

/**
 * super_admins — Phase 1, Unit 1.
 *
 * Mirrors `supabase/migrations/0001_super_admins.sql` exactly. The migration
 * file is the source of truth; this Drizzle definition exists for type-safe
 * queries. Any divergence is a bug — keep them in sync.
 *
 * Spec refs:
 *   - 2.9.1  Seven Platform Roles
 *   - 2.9.5  Time-Boxed Access
 *   - 2.9.7  IP Allowlist
 *   - 2.9.8  Auto-Disable Sole Operator Mode (trigger lands Phase 11)
 *   - 34.0   Phase 1 migration order
 */
export const SUPER_ADMIN_ROLES = [
  'owner',
  'admin',
  'engineering',
  'support',
  'sales',
  'finance',
  'auditor',
] as const;

export type SuperAdminRole = (typeof SUPER_ADMIN_ROLES)[number];

export const superAdmins = pgTable(
  'super_admins',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    email: citext('email').notNull(),
    fullName: text('full_name').notNull(),

    role: text('role').$type<SuperAdminRole>().notNull(),

    allowedIps: inetArray('allowed_ips'),

    recoveryEmail: citext('recovery_email'),
    recoveryPhone: text('recovery_phone'),

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
    roleCheck: check(
      'super_admins_role_check',
      sql`${t.role} IN ('owner','admin','engineering','support','sales','finance','auditor')`,
    ),
    fullNameCheck: check('super_admins_full_name_check', sql`length(trim(${t.fullName})) > 0`),
    recoveryPhoneCheck: check(
      'super_admins_recovery_phone_check',
      sql`${t.recoveryPhone} IS NULL OR ${t.recoveryPhone} ~ '^\\+[1-9][0-9]{6,14}$'`,
    ),
    removedAtCheck: check(
      'super_admins_removed_at_check',
      sql`${t.removedAt} IS NULL OR ${t.removedAt} <= now()`,
    ),

    emailActiveUnique: uniqueIndex('uq_super_admins_email_active')
      .on(t.email)
      .where(sql`${t.removedAt} IS NULL`),

    roleActiveIdx: index('idx_super_admins_role_active')
      .on(t.role)
      .where(sql`${t.removedAt} IS NULL`),

    inactiveEngSupportIdx: index('idx_super_admins_inactive_eng_support')
      .on(t.lastActiveAt)
      .where(sql`${t.removedAt} IS NULL AND ${t.role} IN ('engineering','support')`),

    recoveryEmailIdx: index('idx_super_admins_recovery_email')
      .on(t.recoveryEmail)
      .where(sql`${t.recoveryEmail} IS NOT NULL AND ${t.removedAt} IS NULL`),
  }),
);

export type SuperAdmin = typeof superAdmins.$inferSelect;
export type NewSuperAdmin = typeof superAdmins.$inferInsert;
