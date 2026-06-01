import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { superAdmins } from './super-admins.js';
import { supportFaqs } from './support-faqs.js';

export const TICKET_USER_TYPES = ['tenant_member', 'client', 'vendor', 'guest', 'speaker'] as const;
export type TicketUserType = (typeof TICKET_USER_TYPES)[number];

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = [
  'open',
  'bot_handled',
  'escalated',
  'in_progress',
  'waiting_on_user',
  'resolved',
  'closed',
  'reopened',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_SOURCES = ['web', 'email', 'widget', 'api', 'bot', 'phone'] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ticketNumber: text('ticket_number').notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    userType: text('user_type').$type<TicketUserType>().notNull(),
    subject: text('subject').notNull(),
    category: text('category'),
    priority: text('priority').$type<TicketPriority>().notNull().default('normal'),
    messages: jsonb('messages')
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text('status').$type<TicketStatus>().notNull().default('open'),
    botHandledAt: timestamp('bot_handled_at', { withTimezone: true }),
    botHandledFaqId: uuid('bot_handled_faq_id').references(() => supportFaqs.id, {
      onDelete: 'set null',
    }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    escalationReason: text('escalation_reason'),
    assignedTo: uuid('assigned_to').references(() => superAdmins.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => superAdmins.id, { onDelete: 'set null' }),
    resolutionSummary: text('resolution_summary'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    reopenedReason: text('reopened_reason'),
    satisfactionRating: integer('satisfaction_rating'),
    satisfactionFeedback: text('satisfaction_feedback'),
    satisfactionSubmittedAt: timestamp('satisfaction_submitted_at', { withTimezone: true }),
    relatedResourceType: text('related_resource_type'),
    relatedResourceId: text('related_resource_id'),
    attachments: jsonb('attachments'),
    source: text('source').$type<TicketSource>().notNull().default('web'),
    languageCode: text('language_code').notNull().default('en'),
    userIp: text('user_ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    ticketNumberUq: uniqueIndex('support_tickets_ticket_number_key').on(t.ticketNumber),
    statusIx: index('idx_support_tickets_status').on(t.status, t.createdAt),
    userTypeEnum: check(
      'st_user_type_enum',
      sql`${t.userType} IN ('tenant_member','client','vendor','guest','speaker')`,
    ),
    priorityEnum: check('st_priority_enum', sql`${t.priority} IN ('low','normal','high','urgent')`),
    statusEnum: check(
      'st_status_enum',
      sql`${t.status} IN ('open','bot_handled','escalated','in_progress','waiting_on_user','resolved','closed','reopened')`,
    ),
    ratingRange: check(
      'st_rating_range',
      sql`${t.satisfactionRating} IS NULL OR (${t.satisfactionRating} BETWEEN 1 AND 5)`,
    ),
  }),
);
export type SupportTicket = typeof supportTickets.$inferSelect;
