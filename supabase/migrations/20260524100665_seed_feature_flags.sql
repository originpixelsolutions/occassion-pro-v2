-- Phase 12 Unit 109b: 10 platform feature flags per spec Part 34.0.
INSERT INTO feature_flags (code, name, description, default_enabled) VALUES
  ('floor_plan_3d',           '3D Floor Plan',           'Three-dimensional floor plan rendering',                            FALSE),
  ('vendor_marketplace',      'Vendor Marketplace',      'Public vendor discovery portal',                                    TRUE),
  ('whatsapp_broadcasts',     'WhatsApp Broadcasts',     'Bulk guest WhatsApp messaging via WABA',                            TRUE),
  ('ai_recommendations',      'AI Recommendations',      'AI-powered vendor and runsheet recommendations',                    FALSE),
  ('live_streaming',          'Live Streaming',          'Live event streaming integration',                                  FALSE),
  ('badge_printing',          'Badge Printing',          'On-site badge printing flow',                                       TRUE),
  ('cpd_certificates',        'CPD Certificates',        'Auto-issue continuing-professional-development certificates',      FALSE),
  ('multi_currency_payments', 'Multi-currency Payments', 'Accept payments in multiple currencies via Stripe',                 FALSE),
  ('white_label_domain',      'White-label Domain',      'Tenant custom domain for portals and websites',                     FALSE),
  ('vendor_self_invoice',     'Vendor Self-invoice',     'Allow vendors to issue their own invoices for tenant approval',     TRUE)
ON CONFLICT DO NOTHING;
