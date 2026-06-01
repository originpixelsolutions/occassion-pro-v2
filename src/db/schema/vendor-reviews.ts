import { sql } from 'drizzle-orm';
import { boolean, check, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { vendorAccounts } from './vendor-accounts.js';
import { vendorEventAssignments } from './vendor-event-assignments.js';
import { superAdmins } from './super-admins.js';

export const vendorReviews = pgTable(
  'vendor_reviews',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    vendorAccountId: uuid('vendor_account_id').notNull().references(() => vendorAccounts.id, { onDelete: 'cascade' }),
    reviewerTenantId: uuid('reviewer_tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    vendorAssignmentId: uuid('vendor_assignment_id').references(() => vendorEventAssignments.id, { onDelete: 'set null' }),
    rating: numeric('rating', { precision: 2, scale: 1 }).notNull(),
    reviewText: text('review_text'),
    reviewerName: text('reviewer_name'),
    serviceCategory: text('service_category'),
    professionalismScore: numeric('professionalism_score', { precision: 2, scale: 1 }),
    qualityScore: numeric('quality_score', { precision: 2, scale: 1 }),
    valueScore: numeric('value_score', { precision: 2, scale: 1 }),
    isVerified: boolean('is_verified').notNull().default(true),
    isPublished: boolean('is_published').notNull().default(true),
    unpublishedAt: timestamp('unpublished_at', { withTimezone: true }),
    unpublishedReason: text('unpublished_reason'),
    vendorResponse: text('vendor_response'),
    vendorRespondedAt: timestamp('vendor_responded_at', { withTimezone: true }),
    flaggedAt: timestamp('flagged_at', { withTimezone: true }),
    flaggedReason: text('flagged_reason'),
    flaggedBy: uuid('flagged_by').references(() => superAdmins.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    assignmentUq: uniqueIndex('uq_vendor_reviews_assignment')
      .on(t.vendorAssignmentId).where(sql`${t.vendorAssignmentId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    vendorIx: index('idx_vendor_reviews').on(t.vendorAccountId, t.createdAt).where(sql`${t.deletedAt} IS NULL`),
    ratingRange: check('vr_rating_range', sql`${t.rating} >= 1.0 AND ${t.rating} <= 5.0`),
    publishCoupling: check('vr_publish_coupling', sql`NOT ${t.isPublished} OR ${t.unpublishedAt} IS NULL`),
    unpublishReasonCoupling: check('vr_unpublish_reason', sql`${t.unpublishedAt} IS NULL OR ${t.unpublishedReason} IS NOT NULL`),
    responseCoupling: check('vr_response_coupling', sql`(${t.vendorResponse} IS NULL) = (${t.vendorRespondedAt} IS NULL)`),
    flagCoupling: check('vr_flag_coupling', sql`(${t.flaggedAt} IS NULL) = (${t.flaggedReason} IS NULL)`),
  }),
);
export type VendorReview = typeof vendorReviews.$inferSelect;
