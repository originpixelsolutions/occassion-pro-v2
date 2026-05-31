-- Phase 2 Unit 25: team_invitations (spec 3.8).
-- Pending invitation tokens. token is URL-safe; accepted/revoked/expired
-- rows linger for audit. One open invitation per (tenant, email).

CREATE TABLE team_invitations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  invited_email citext      NOT NULL CHECK (invited_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(invited_email) <= 254),
  role          text        NOT NULL CHECK (role IN ('event_manager','team_lead','team_member')),
  token         text        NOT NULL UNIQUE CHECK (length(token) BETWEEN 32 AND 256 AND token ~ '^[A-Za-z0-9_-]+$'),
  invited_by    uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepting','accepted','revoked','expired')),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  revoked_at    timestamptz,
  revoked_by    uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (status <> 'accepted' OR (accepted_at IS NOT NULL AND accepted_by IS NOT NULL)),
  CHECK (status <> 'revoked'  OR revoked_at  IS NOT NULL)
);

CREATE INDEX idx_team_invitations_token        ON team_invitations (token);
CREATE INDEX idx_team_invitations_tenant_email ON team_invitations (tenant_id, invited_email, status);
CREATE INDEX idx_team_invitations_pending      ON team_invitations (expires_at) WHERE status IN ('pending','accepting');
CREATE INDEX idx_team_invitations_invited_by   ON team_invitations (invited_by) WHERE invited_by IS NOT NULL;

CREATE UNIQUE INDEX uq_team_invitations_open
  ON team_invitations (tenant_id, invited_email)
  WHERE status IN ('pending','accepting');

ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invitations FORCE ROW LEVEL SECURITY;
