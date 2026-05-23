import { sql } from 'drizzle-orm';
import {
  pgTable,
  integer,
  text,
  timestamp,
  uuid,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { superAdmins } from './super-admins.js';

/**
 * platform_theme_config — Phase 1, Unit 4.
 *
 * Singleton theme-tokens table (spec 33.10). Mirrors
 * `supabase/migrations/0004_platform_theme_config.sql`. Colors are
 * stored as plain text in Drizzle (the SQL-side hex_color DOMAIN
 * enforces the format at the database).
 */
export const PLATFORM_THEME_STATUSES = ['draft', 'staged', 'live', 'rollback'] as const;
export type PlatformThemeStatus = (typeof PLATFORM_THEME_STATUSES)[number];

export const PLATFORM_THEME_MODES = ['light', 'dark', 'auto'] as const;
export type PlatformThemeMode = (typeof PLATFORM_THEME_MODES)[number];

export const platformThemeConfig = pgTable(
  'platform_theme_config',
  {
    id: integer('id').primaryKey().default(1),

    brandPrimary: text('brand_primary').notNull().default('#CA4B32'),
    brandPrimaryDark: text('brand_primary_dark').notNull().default('#DD6850'),
    brandSecondary: text('brand_secondary').notNull().default('#E2A528'),
    brandGradientStart: text('brand_gradient_start').notNull().default('#E2A528'),
    brandGradientEnd: text('brand_gradient_end').notNull().default('#CA4B32'),
    brandGradientAngle: integer('brand_gradient_angle').notNull().default(135),

    colorSuccess: text('color_success').notNull().default('#10B981'),
    colorWarning: text('color_warning').notNull().default('#EAB308'),
    colorDanger: text('color_danger').notNull().default('#DC2626'),
    colorInfo: text('color_info').notNull().default('#3B82F6'),

    lightPageBg: text('light_page_bg').notNull().default('#EDF0F4'),
    lightSidebarBg: text('light_sidebar_bg').notNull().default('#F7F9FB'),
    lightCardBg: text('light_card_bg').notNull().default('#FFFFFF'),
    lightHoverBg: text('light_hover_bg').notNull().default('#F1F4F8'),
    lightBorderDefault: text('light_border_default').notNull().default('#D5DAE0'),
    lightTextPrimary: text('light_text_primary').notNull().default('#0F1115'),
    lightTextSecondary: text('light_text_secondary').notNull().default('#4A5260'),
    lightTextTertiary: text('light_text_tertiary').notNull().default('#6C7380'),

    darkPageBg: text('dark_page_bg').notNull().default('#04050A'),
    darkSidebarBg: text('dark_sidebar_bg').notNull().default('#0E1015'),
    darkCardBg: text('dark_card_bg').notNull().default('#1B1E25'),
    darkHoverBg: text('dark_hover_bg').notNull().default('#252932'),
    darkBorderDefault: text('dark_border_default').notNull().default('#2D3138'),
    darkTextPrimary: text('dark_text_primary').notNull().default('#F4F5F8'),
    darkTextSecondary: text('dark_text_secondary').notNull().default('#A0A6B0'),
    darkTextTertiary: text('dark_text_tertiary').notNull().default('#6C7380'),

    fontFamilySans: text('font_family_sans')
      .notNull()
      .default('Inter, Noto Sans, system-ui, sans-serif'),
    fontFamilySerif: text('font_family_serif').notNull().default('Fraunces, Georgia, serif'),
    fontFamilyMono: text('font_family_mono')
      .notNull()
      .default('JetBrains Mono, ui-monospace, monospace'),

    radiusSm: integer('radius_sm').notNull().default(6),
    radiusMd: integer('radius_md').notNull().default(8),
    radiusLg: integer('radius_lg').notNull().default(12),
    radiusXl: integer('radius_xl').notNull().default(16),

    defaultThemeMode: text('default_theme_mode')
      .$type<PlatformThemeMode>()
      .notNull()
      .default('auto'),

    version: integer('version').notNull().default(1),
    status: text('status').$type<PlatformThemeStatus>().notNull().default('live'),

    draftStartedAt: timestamp('draft_started_at', { withTimezone: true }),
    stagedAt: timestamp('staged_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),

    draftBy: uuid('draft_by').references(() => superAdmins.id, { onDelete: 'set null' }),
    approvedBy: uuid('approved_by').references(() => superAdmins.id, { onDelete: 'set null' }),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    singletonCheck: check('ptc_singleton', sql`${t.id} = 1`),
    gradientAngleCheck: check(
      'ptc_gradient_angle',
      sql`${t.brandGradientAngle} BETWEEN 0 AND 360`,
    ),
    themeModeCheck: check(
      'ptc_theme_mode',
      sql`${t.defaultThemeMode} IN ('light','dark','auto')`,
    ),
    statusCheck: check(
      'ptc_status',
      sql`${t.status} IN ('draft','staged','live','rollback')`,
    ),
    draftByIdx: index('idx_ptc_draft_by').on(t.draftBy).where(sql`${t.draftBy} IS NOT NULL`),
    approvedByIdx: index('idx_ptc_approved_by')
      .on(t.approvedBy)
      .where(sql`${t.approvedBy} IS NOT NULL`),
  }),
);

export type PlatformThemeConfig = typeof platformThemeConfig.$inferSelect;
