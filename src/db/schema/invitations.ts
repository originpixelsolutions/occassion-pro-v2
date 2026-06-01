import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';

export const INVITATION_VARIANTS = ['static','animated_web','video'] as const;
export type InvitationVariant = (typeof INVITATION_VARIANTS)[number];

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    templateCode: text('template_code').notNull(),
    variant: text('variant').$type<InvitationVariant>().notNull().default('static'),
    config: jsonb('config').notNull(),
    previewUrl: text('preview_url'),
    pdfUrl: text('pdf_url'),
    pngUrl: text('png_url'),
    videoUrl: text('video_url'),
    isPublished: boolean('is_published').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    unpublishedAt: timestamp('unpublished_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
  },
  (t) => ({
    activeUq: uniqueIndex('uq_invitations_event_template_active')
      .on(t.eventId, t.templateCode).where(sql`${t.deletedAt} IS NULL`),
    eventIx: index('idx_invitations_event').on(t.eventId).where(sql`${t.deletedAt} IS NULL`),
    variantEnum: check('inv_variant_enum', sql`${t.variant} IN ('static','animated_web','video')`),
    publishCoupling: check('inv_publish_coupling', sql`${t.isPublished} = FALSE OR (${t.publishedAt} IS NOT NULL AND ${t.publishedBy} IS NOT NULL)`),
    videoRequiresUrl: check('inv_video_requires_url', sql`${t.variant} <> 'video' OR ${t.videoUrl} IS NOT NULL`),
  }),
);
export type Invitation = typeof invitations.$inferSelect;
