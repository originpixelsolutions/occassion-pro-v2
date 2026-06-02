-- Phase 12 Unit 109c: Default platform theme (amber -> coral per spec Part 33).
INSERT INTO platform_theme_config (
  brand_primary, brand_primary_dark, brand_secondary,
  brand_gradient_start, brand_gradient_end, brand_gradient_angle,
  color_success, color_warning, color_danger, color_info,
  light_page_bg, light_sidebar_bg, light_card_bg, light_hover_bg, light_border_default,
  light_text_primary, light_text_secondary, light_text_tertiary,
  dark_page_bg, dark_sidebar_bg, dark_card_bg, dark_hover_bg, dark_border_default,
  dark_text_primary, dark_text_secondary, dark_text_tertiary,
  font_family_sans, font_family_serif, font_family_mono,
  radius_sm, radius_md, radius_lg, radius_xl,
  default_theme_mode, version, status, published_at
) VALUES (
  '#F59E0B', '#B45309', '#FB7185',
  '#F59E0B', '#FB7185', 135,
  '#10B981', '#F59E0B', '#EF4444', '#3B82F6',
  '#FFFBEB', '#FFFFFF', '#FFFFFF', '#FEF3C7', '#FED7AA',
  '#1F2937', '#4B5563', '#6B7280',
  '#0F172A', '#1E293B', '#1E293B', '#334155', '#475569',
  '#F8FAFC', '#CBD5E1', '#94A3B8',
  'Geist, system-ui, -apple-system, sans-serif',
  'Fraunces, Georgia, serif',
  'JetBrains Mono, ui-monospace, monospace',
  4, 6, 10, 16,
  'light', 1, 'live', now()
) ON CONFLICT DO NOTHING;
