import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext } from '../columns.js';

export const OAUTH_PROVIDERS = ['google', 'microsoft', 'apple', 'linkedin'] as const;
export type OauthProvider = (typeof OAUTH_PROVIDERS)[number];

export const oauthProviderLinks = pgTable(
  'oauth_provider_links',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    authUserId: uuid('auth_user_id').notNull(),
    provider: text('provider').$type<OauthProvider>().notNull(),
    providerUserId: text('provider_user_id').notNull(),
    providerEmail: citext('provider_email'),
    linkedAt: timestamp('linked_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({
    providerEnum: check(
      'opl_provider',
      sql`${t.provider} IN ('google','microsoft','apple','linkedin')`,
    ),
    providerUserIdLen: check(
      'opl_provider_user_id_len',
      sql`length(trim(${t.providerUserId})) BETWEEN 1 AND 256`,
    ),
    lastUsedOrder: check(
      'opl_last_used_order',
      sql`${t.lastUsedAt} IS NULL OR ${t.lastUsedAt} >= ${t.linkedAt}`,
    ),
    providerSubjectUq: uniqueIndex('oauth_provider_links_provider_provider_user_id_key').on(
      t.provider,
      t.providerUserId,
    ),
    userProviderUq: uniqueIndex('uq_oauth_user_provider').on(t.authUserId, t.provider),
    userIdx: index('idx_oauth_user').on(t.authUserId),
  }),
);
export type OauthProviderLink = typeof oauthProviderLinks.$inferSelect;
