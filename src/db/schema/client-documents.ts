import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';
import { clientAccounts } from './client-accounts.js';

export const CLIENT_DOCUMENT_TYPES = [
  'contract',
  'invoice',
  'quote',
  'agreement',
  'consent_form',
  'release',
] as const;
export type ClientDocumentType = (typeof CLIENT_DOCUMENT_TYPES)[number];

export const SIGNATURE_PROVIDERS = ['docusign', 'signwell', 'internal'] as const;
export type SignatureProvider = (typeof SIGNATURE_PROVIDERS)[number];

export const SIGNATURE_STATUSES = [
  'draft',
  'sent',
  'viewed',
  'signed',
  'declined',
  'expired',
  'voided',
] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

export const clientDocuments = pgTable(
  'client_documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    clientAccountId: uuid('client_account_id').references(() => clientAccounts.id, {
      onDelete: 'set null',
    }),
    documentType: text('document_type').$type<ClientDocumentType>().notNull(),
    documentName: text('document_name').notNull(),
    r2Key: text('r2_key').notNull(),
    signedR2Key: text('signed_r2_key'),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'bigint' }),
    fileHashSha256: text('file_hash_sha256'),
    signatureProvider: text('signature_provider').$type<SignatureProvider>(),
    signatureEnvelopeId: text('signature_envelope_id'),
    signatureStatus: text('signature_status').$type<SignatureStatus>().notNull().default('draft'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    declinedReason: text('declined_reason'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedReason: text('voided_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    signatureAuditTrail: jsonb('signature_audit_trail'),
    reminderCount: integer('reminder_count').notNull().default(0),
    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    voidedBy: uuid('voided_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
  },
  (t) => ({
    statusIx: index('idx_client_docs_status')
      .on(t.signatureStatus, t.sentAt)
      .where(sql`${t.deletedAt} IS NULL`),
    typeEnum: check(
      'cd_type_enum',
      sql`${t.documentType} IN ('contract','invoice','quote','agreement','consent_form','release')`,
    ),
    providerEnum: check(
      'cd_provider_enum',
      sql`${t.signatureProvider} IS NULL OR ${t.signatureProvider} IN ('docusign','signwell','internal')`,
    ),
    statusEnum: check(
      'cd_status_enum',
      sql`${t.signatureStatus} IN ('draft','sent','viewed','signed','declined','expired','voided')`,
    ),
    reminderRange: check('cd_reminder_range', sql`${t.reminderCount} BETWEEN 0 AND 50`),
  }),
);
export type ClientDocument = typeof clientDocuments.$inferSelect;
