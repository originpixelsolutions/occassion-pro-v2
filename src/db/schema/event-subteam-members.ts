import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { eventSubteams } from './event-subteams.js';
import { tenantMembers } from './tenant-members.js';

export const eventSubteamMembers = pgTable(
  'event_subteam_members',
  {
    subteamId: uuid('subteam_id')
      .notNull()
      .references(() => eventSubteams.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => tenantMembers.id, { onDelete: 'cascade' }),
    roleLabel: text('role_label'),
    addedBy: uuid('added_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    addedAt: timestamp('added_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.subteamId, t.memberId] }),
    roleLen: check(
      'esm_role_label_len',
      sql`${t.roleLabel} IS NULL OR length(trim(${t.roleLabel})) BETWEEN 1 AND 80`,
    ),
    memberIdx: index('idx_event_subteam_members_member').on(t.memberId),
  }),
);
export type EventSubteamMember = typeof eventSubteamMembers.$inferSelect;
