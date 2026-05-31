import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';
import { superAdmins } from './super-admins.js';

export const TRANSFER_STATUSES = [
  'requested','target_confirmed','admin_approved',
  'running','completed','rejected','failed','cancelled',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export interface TransferScope {
  events?: string[];
  vendors?: boolean;
  clients?: boolean;
  files?: boolean;
  invoices?: boolean;
  audit_log_shadows?: boolean;
}

export const tenantTransferRequests = pgTable(
  'tenant_transfer_requests',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    sourceTenantId: uuid('source_tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    targetTenantId: uuid('target_tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    initiatedBy: uuid('initiated_by').notNull().references(() => tenantMembers.id, { onDelete: 'restrict' }),
    targetConfirmedBy: uuid('target_confirmed_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    scope: jsonb('scope').$type<TransferScope>().notNull(),
    legalDocumentsUrl: text('legal_documents_url'),
    approvedByAdmin: uuid('approved_by_admin').references(() => superAdmins.id, { onDelete: 'set null' }),
    status: text('status').$type<TransferStatus>().notNull().default('requested'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    statusEnum: check(
      'ttr_status',
      sql`${t.status} IN ('requested','target_confirmed','admin_approved','running','completed','rejected','failed','cancelled')`,
    ),
    sourceTargetDiffer: check(
      'ttr_source_target_differ',
      sql`${t.sourceTenantId} <> ${t.targetTenantId}`,
    ),
    legalUrlHttps: check(
      'ttr_legal_url_https',
      sql`${t.legalDocumentsUrl} IS NULL OR ${t.legalDocumentsUrl} ~ '^https://'`,
    ),
    sourceIdx: index('idx_transfer_source').on(t.sourceTenantId),
    targetIdx: index('idx_transfer_target').on(t.targetTenantId),
  }),
);
export type TenantTransferRequest = typeof tenantTransferRequests.$inferSelect;
