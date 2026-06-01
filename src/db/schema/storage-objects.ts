import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';

export const STORAGE_CATEGORIES = [
  'logo',
  'tenant_avatar',
  'user_avatar',
  'event_cover',
  'event_photo',
  'event_video',
  'document',
  'export',
  'vendor_doc',
  'client_doc',
  'invitation_media',
  'speaker_photo',
  'speaker_presentation',
  'crew_doc',
  'inventory_image',
  'signed_contract',
  'badge_pdf',
  'floor_plan_export',
  'runsheet_export',
  'report',
  'other',
] as const;
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

export const STORAGE_CLASSES = [
  'standard',
  'infrequent_access',
  'archive',
  'deep_archive',
] as const;
export type StorageClass = (typeof STORAGE_CLASSES)[number];

export const UPLOADER_TYPES = [
  'tenant_member',
  'client',
  'vendor',
  'guest',
  'speaker',
  'system',
  'super_admin',
] as const;
export type UploaderType = (typeof UPLOADER_TYPES)[number];

export const ARCHIVE_DESTINATIONS = [
  'r2_archive',
  's3_glacier',
  'b2_archive',
  'wasabi',
  'azure_archive',
] as const;
export type ArchiveDestination = (typeof ARCHIVE_DESTINATIONS)[number];

export const storageObjects = pgTable(
  'storage_objects',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    category: text('category').$type<StorageCategory>().notNull(),
    r2Key: text('r2_key').notNull(),
    r2Bucket: text('r2_bucket').notNull().default('occasionpro-tenant-storage'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    contentHashSha256: text('content_hash_sha256'),
    uploadedBy: uuid('uploaded_by'),
    uploadedByType: text('uploaded_by_type').$type<UploaderType>(),
    storageClass: text('storage_class').$type<StorageClass>().notNull().default('standard'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archiveDestination: text('archive_destination').$type<ArchiveDestination>(),
    archiveExpiresAt: timestamp('archive_expires_at', { withTimezone: true }),
    restoredAt: timestamp('restored_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    r2KeyUq: uniqueIndex('storage_objects_r2_key_key').on(t.r2Key),
    tenantIx: index('idx_storage_objects_tenant')
      .on(t.tenantId, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    categoryEnum: check(
      'so_category_enum',
      sql`${t.category} IN ('logo','tenant_avatar','user_avatar','event_cover','event_photo','event_video','document','export','vendor_doc','client_doc','invitation_media','speaker_photo','speaker_presentation','crew_doc','inventory_image','signed_contract','badge_pdf','floor_plan_export','runsheet_export','report','other')`,
    ),
    storageClassEnum: check(
      'so_storage_class_enum',
      sql`${t.storageClass} IN ('standard','infrequent_access','archive','deep_archive')`,
    ),
    sizePositive: check(
      'so_size_positive',
      sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 10737418240`,
    ),
    archiveCoupling: check(
      'so_archive_coupling',
      sql`(${t.archivedAt} IS NULL AND ${t.archiveDestination} IS NULL AND ${t.archiveExpiresAt} IS NULL) OR (${t.archivedAt} IS NOT NULL AND ${t.archiveDestination} IS NOT NULL)`,
    ),
  }),
);
export type StorageObject = typeof storageObjects.$inferSelect;
