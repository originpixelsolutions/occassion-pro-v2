-- Phase 12 Unit 109a: 15 system event_types per spec Part 34.0.
-- Idempotent via ON CONFLICT DO NOTHING on the (code, tenant_id) UNIQUE.
INSERT INTO event_types (tenant_id, code, name, is_system, tone) VALUES
  (NULL, 'wedding',                'Wedding',                TRUE, 'celebratory'),
  (NULL, 'engagement',             'Engagement',             TRUE, 'celebratory'),
  (NULL, 'reception',              'Reception',              TRUE, 'celebratory'),
  (NULL, 'birthday',               'Birthday',               TRUE, 'playful'),
  (NULL, 'anniversary',            'Anniversary',            TRUE, 'celebratory'),
  (NULL, 'corporate-conference',   'Corporate Conference',   TRUE, 'formal'),
  (NULL, 'corporate-offsite',      'Corporate Offsite',      TRUE, 'formal'),
  (NULL, 'product-launch',         'Product Launch',         TRUE, 'formal'),
  (NULL, 'fundraiser-gala',        'Fundraiser Gala',        TRUE, 'formal'),
  (NULL, 'workshop-bootcamp',      'Workshop/Bootcamp',      TRUE, 'formal'),
  (NULL, 'concert-music-festival', 'Concert/Music Festival', TRUE, 'playful'),
  (NULL, 'religious-ceremony',     'Religious Ceremony',     TRUE, 'solemn'),
  (NULL, 'memorial-service',       'Memorial Service',       TRUE, 'solemn'),
  (NULL, 'sports-tournament',      'Sports Tournament',      TRUE, 'playful'),
  (NULL, 'community-meetup',       'Community Meetup',       TRUE, 'celebratory')
ON CONFLICT DO NOTHING;
