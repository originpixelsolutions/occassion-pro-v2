import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const AUDIT_ACTOR_TYPES = [
  'super_admin',
  'tenant_member',
  'client',
  'vendor',
  'guest',
  'speaker',
  'system',
  'anonymous',
  'api_key',
  'webhook',
] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_SEVERITIES = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'security',
  'compliance',
] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export const AUDIT_STATUSES = ['success', 'failure', 'denied', 'partial'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const AUDIT_SOURCES = [
  'app',
  'api',
  'webhook',
  'job',
  'cli',
  'system',
  'migration',
  'seed',
  'impersonation',
  'sso',
] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const AUDIT_RETENTION_CLASSES = ['standard', 'extended', 'permanent', 'sensitive'] as const;
export type AuditRetentionClass = (typeof AUDIT_RETENTION_CLASSES)[number];

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    actorType: text('actor_type').$type<AuditActorType>().notNull(),
    actorId: uuid('actor_id'),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    resourceLabel: text('resource_label'),
    severity: text('severity').$type<AuditSeverity>().notNull().default('info'),
    status: text('status').$type<AuditStatus>().notNull().default('success'),
    failureReason: text('failure_reason'),
    requestId: uuid('request_id'),
    sessionId: text('session_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    source: text('source').$type<AuditSource>().notNull().default('app'),
    changes: jsonb('changes'),
    metadata: jsonb('metadata'),
    correlationId: uuid('correlation_id'),
    impersonatorId: uuid('impersonator_id'),
    retentionClass: text('retention_class')
      .$type<AuditRetentionClass>()
      .notNull()
      .default('standard'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.occurredAt] }),
    tenantOccurredIx: index('idx_audit_log_tenant_occurred')
      .on(t.tenantId, t.occurredAt)
      .where(sql`${t.tenantId} IS NOT NULL`),
    actorTypeEnum: check(
      'al_actor_type_enum',
      sql`${t.actorType} IN ('super_admin','tenant_member','client','vendor','guest','speaker','system','anonymous','api_key','webhook')`,
    ),
    severityEnum: check(
      'al_severity_enum',
      sql`${t.severity} IN ('debug','info','notice','warning','error','critical','security','compliance')`,
    ),
    statusEnum: check(
      'al_status_enum',
      sql`${t.status} IN ('success','failure','denied','partial')`,
    ),
    sourceEnum: check(
      'al_source_enum',
      sql`${t.source} IN ('app','api','webhook','job','cli','system','migration','seed','impersonation','sso')`,
    ),
    retentionEnum: check(
      'al_retention_enum',
      sql`${t.retentionClass} IN ('standard','extended','permanent','sensitive')`,
    ),
  }),
);
export type AuditEvent = typeof auditLog.$inferSelect;
