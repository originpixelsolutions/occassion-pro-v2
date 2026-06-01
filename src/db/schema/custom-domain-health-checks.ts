import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const DOMAIN_CHECK_TYPES = [
  'cname_intact',
  'ssl_valid',
  'content_served',
  'orphaned',
] as const;
export type DomainCheckType = (typeof DOMAIN_CHECK_TYPES)[number];

export const DOMAIN_CHECK_STATUSES = ['healthy', 'warning', 'critical', 'orphaned'] as const;
export type DomainCheckStatus = (typeof DOMAIN_CHECK_STATUSES)[number];

export const customDomainHealthChecks = pgTable(
  'custom_domain_health_checks',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    domain: text('domain').notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    checkType: text('check_type').$type<DomainCheckType>().notNull(),
    status: text('status').$type<DomainCheckStatus>().notNull(),
    observedTarget: text('observed_target'),
    httpStatus: integer('http_status'),
    latencyMs: integer('latency_ms'),
    sslExpiresAt: timestamp('ssl_expires_at', { withTimezone: true }),
    notes: text('notes'),
    checkedAt: timestamp('checked_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    checkTypeEnum: check(
      'cdhc_check_type',
      sql`${t.checkType} IN ('cname_intact','ssl_valid','content_served','orphaned')`,
    ),
    statusEnum: check(
      'cdhc_status',
      sql`${t.status} IN ('healthy','warning','critical','orphaned')`,
    ),
    orphanedScope: check(
      'cdhc_orphaned_scope',
      sql`${t.status} <> 'orphaned' OR ${t.checkType} = 'orphaned'`,
    ),
    httpStatusBounds: check(
      'cdhc_http_status_bounds',
      sql`${t.httpStatus} IS NULL OR ${t.httpStatus} BETWEEN 100 AND 599`,
    ),
    latencyNonNeg: check(
      'cdhc_latency_non_neg',
      sql`${t.latencyMs} IS NULL OR ${t.latencyMs} >= 0`,
    ),
    domainIdx: index('idx_domain_health_domain').on(t.domain, t.checkedAt),
  }),
);
export type CustomDomainHealthCheck = typeof customDomainHealthChecks.$inferSelect;
