import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const ONBOARDING_TOUR_STEPS = ['welcome','branding','first_event','portal_tour','invite_team','payment','next_steps'] as const;
export type OnboardingTourStep = (typeof ONBOARDING_TOUR_STEPS)[number];

export const onboardingState = pgTable(
  'onboarding_state',
  {
    tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
    signupCompletedAt: timestamp('signup_completed_at', { withTimezone: true }),
    workspaceSetupAt: timestamp('workspace_setup_at', { withTimezone: true }),
    firstEventCreatedAt: timestamp('first_event_created_at', { withTimezone: true }),
    firstMemberInvitedAt: timestamp('first_member_invited_at', { withTimezone: true }),
    paymentSetupAt: timestamp('payment_setup_at', { withTimezone: true }),
    tourCompletedAt: timestamp('tour_completed_at', { withTimezone: true }),
    tourSkippedAt: timestamp('tour_skipped_at', { withTimezone: true }),
    currentTourStep: text('current_tour_step').$type<OnboardingTourStep>(),
    currentTourStepIndex: integer('current_tour_step_index'),
    totalTourSteps: integer('total_tour_steps').notNull().default(7),
    templateUsed: text('template_used'),
    templateUsedAt: timestamp('template_used_at', { withTimezone: true }),
    demoDataLoaded: boolean('demo_data_loaded').notNull().default(false),
    demoDataLoadedAt: timestamp('demo_data_loaded_at', { withTimezone: true }),
    demoDataClearedAt: timestamp('demo_data_cleared_at', { withTimezone: true }),
    checklistProgress: jsonb('checklist_progress'),
    completionPercent: integer('completion_percent').notNull().default(0),
    emailSequencePaused: boolean('email_sequence_paused').notNull().default(false),
    emailSequenceCompletedAt: timestamp('email_sequence_completed_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    activeIx: index('idx_onboarding_state_active').on(t.lastActiveAt).where(sql`${t.tourCompletedAt} IS NULL AND ${t.tourSkippedAt} IS NULL`),
    tourStepEnum: check('os_tour_step_enum', sql`${t.currentTourStep} IS NULL OR ${t.currentTourStep} IN ('welcome','branding','first_event','portal_tour','invite_team','payment','next_steps')`),
    tourTerminalXor: check('os_tour_terminal_xor', sql`${t.tourCompletedAt} IS NULL OR ${t.tourSkippedAt} IS NULL`),
    templateCoupling: check('os_template_coupling', sql`(${t.templateUsed} IS NULL) = (${t.templateUsedAt} IS NULL)`),
    completionRange: check('os_completion_range', sql`${t.completionPercent} >= 0 AND ${t.completionPercent} <= 100`),
  }),
);
export type OnboardingState = typeof onboardingState.$inferSelect;
