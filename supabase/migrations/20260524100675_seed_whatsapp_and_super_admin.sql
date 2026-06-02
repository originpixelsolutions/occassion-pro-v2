-- Phase 12 Unit 109d: Default WhatsApp templates + bootstrap Super Admin.
INSERT INTO whatsapp_templates (template_name, category, language_code, body_text) VALUES
  ('rsvp_invitation_v1', 'marketing', 'en', 'Hi {{1}}, you are invited to {{2}} on {{3}}. RSVP here: {{4}}'),
  ('rsvp_reminder_v1',   'utility',   'en', 'Hi {{1}}, reminder to RSVP for {{2}} happening {{3}}. Link: {{4}}'),
  ('payment_receipt_v1', 'utility',   'en', 'Hi {{1}}, we received your payment of {{2}} for {{3}}. Receipt: {{4}}')
ON CONFLICT DO NOTHING;

-- Bootstrap super_admin (only if zero super_admins exist).
INSERT INTO super_admins (email, role, full_name)
SELECT 'platform@occasionpro.local', 'owner', 'Platform Owner'
WHERE NOT EXISTS (SELECT 1 FROM super_admins);
