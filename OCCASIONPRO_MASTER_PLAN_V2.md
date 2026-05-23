# OccasionPro — Master Plan v2 (Production-Ready)
> Complete buildable specification. Every gap closed, every user stakeholder addressed, error-proof, deployment-ready.

## Document Map

| Part | Section |
|------|---------|
| 1 | Foundation (vision, scale, tech stack, scheduled jobs) |
| 2 | Portal Architecture & Power Model (incl. Platform Staff Roles, Sole Operator Mode) |
| 3 | Tenant Lifecycle, Pricing & Billing (incl. PO, NET-30, dunning, revenue recognition, portability, chargeback, pause, proration, currency lock, backup cards) |
| 4 | Event Foundation & Lifecycle (incl. templates, bulk-op throttles, conflict resolution) |
| 5 | Communication Infrastructure |
| 6 | Guest-Facing Modules (incl. email OTP fallback, +1 flow, RSVP change) |
| 7 | Cross-Tenant Portals (Client multi-event + expenses + e-sig; Vendor calendar + crew + portfolio + invoice; Speaker) |
| 8 | Operations Modules (incl. Equipment, Crew Staffing, Shared Inbox, Vendor Approval Workflow) |
| 9 | Conference Module |
| 10 | Post-Event Module |
| 11 | Mobile App & PWA |
| 12 | Data Exports |
| 13 | Real-Time Architecture (incl. @mentions, activity feed, diff viewer, conflict UI, presence) |
| 14 | Notifications System |
| 15 | Webhooks (incl. IP allowlist) |
| 16 | Support System |
| 17 | Finance Module |
| 18 | Storage Module |
| 19 | Security (incl. social login, magic link, recovery codes, device mgmt, constant-time, brand impersonation, subdomain takeover, app-layer DDoS, sub-processor breach) |
| 20 | Environments, CI/CD, Deployment |
| 21 | Observability & SLAs |
| 22 | Backup & Disaster Recovery |
| 23 | Testing Strategy |
| 24 | Compliance & Legal |
| 25 | API Versioning & Public API |
| 26 | Internationalisation |
| 27 | Accessibility |
| 28 | Performance Budgets |
| 29 | Cost Model & Provider Alternatives |
| 30 | Onboarding & UX (product tour, demo data, templates, email sequence, contextual help, empty states) |
| 31 | Integrations & Ecosystem (SSO, calendar sync, CRM, accounting, Slack/Teams, Zapier, webhook IP allowlist) |
| 32 | Super Admin Analytics (tenant health, cohort analysis, churn prediction) |
| 33 | UI/UX Design System & Theme Control (confirmed brand palette · `platform_theme_config` · `platform_theme_history` · tenant white-label overrides · UI quality gates) |
| 34 | Core Schema Reference & Migration Order |

---

# PART 1 — FOUNDATION

## 1.1 Product Vision
OccasionPro is an **AI-powered enterprise event operating system** — the SAP of event management. It serves ALL event types globally: weddings, corporate events, concerts, government summits, sports events, religious gatherings, conferences, exhibitions, and virtual/hybrid events.

## 1.2 Target Scale
- Multi-tenant SaaS — event companies as tenants
- From solo wedding planners to billion-dollar global event companies
- Supports events from 5 attendees to 500,000+

## 1.3 Tech Stack (Cost-Efficient, Realtime-First)

### Frontend
- **Cloudflare Pages** · Next.js 14 (App Router) · TypeScript · TailwindCSS · ShadCN UI
- Framer Motion (lazy invitations) · Konva.js (lazy floor plan)
- React Query + Zustand · React Hook Form + Zod · date-fns · Recharts · next-intl · @dnd-kit
- React Native + Expo (mobile, Android Phase 1 → iOS Phase 2)
- **Icon library**: Phosphor Icons + Lucide React (both professional, license-friendly)

### Backend
- **Cloudflare Workers + Hono** (edge V8 isolates)
- **Supabase Edge Functions** (Deno) for DB-heavy operations
- **Drizzle ORM** (RLS-context-aware)
- Cloudflare Workers KV (cache, rate-limit counters, short-link routing)

### Database, Auth, Realtime
- **Supabase Postgres** (DB + Auth + Vault)
- **Supabase Realtime** (postgres_changes + presence + broadcast — replaces Socket.IO)
- **pg_cron** for scheduled jobs
- **pgvector** for AI embeddings
- Supavisor pooler

### Background Jobs
- **Inngest** for async workflows
- **Cloudflare Queues** for webhook delivery

### File Storage
- **Cloudflare R2** ALL files; path keys `tenants/[tenant_id]/[category]/[uuid].[ext]`
- **Cloudflare Images** for transforms
- Tenant cloud offload: Google Drive / Dropbox / OneDrive / S3 (Pro+)

### Edge / CDN
- **Cloudflare** DNS, CDN, WAF, DDoS, Workers, Pages, R2, KV, Queues, Turnstile, AI Gateway
- Cloudflare for SaaS — tenant custom domains

### Communication
- **Resend** default email · `IEmailProvider` interface
- **Fast2SMS** / MSG91 / Twilio — DLT-registered for India, tenant BYO
- **AiSensy** / Gupshup / Twilio for WhatsApp — tenant BYO
- **Expo Push** for mobile

### Payments
- **Razorpay** (India) + Razorpay X (vendor payouts)
- **Stripe** (international) + Stripe Connect (vendor payouts)

### Auth & SSO
- **Supabase Auth** for tenant staff (50k MAU free) — password + OAuth + magic-link + WebAuthn
- OAuth providers: Google, Microsoft, Apple, LinkedIn
- **WorkOS** for Enterprise SSO (SAML/OIDC)

### E-Signature
- **DocuSign API** (Enterprise) or **Signwell** (Pro+) for client contracts, vendor agreements

### Observability
- **Sentry** errors + replays + performance
- **PostHog Cloud** product analytics
- **Cloudflare Web Analytics**
- **BetterStack** uptime + status page
- **Grafana Cloud** metrics + logs

### AI / ML
- **Anthropic Claude API** / **OpenAI** via Cloudflare AI Gateway
- **pgvector** for embeddings · **Whisper** for STT

### Search
- **Postgres tsvector** + GIN (free) · Meilisearch self-hosted at Year-2 scale

### Captcha & Anti-Abuse
- **Cloudflare Turnstile**
- Cloudflare Workers rate limiting
- **Device fingerprinting** via FingerprintJS Pro (behavioral signup analysis)

### Integrations
- **Native**: Google Calendar, Outlook 365, Slack, MS Teams, Salesforce, HubSpot, Zoho CRM, QuickBooks, Tally, Zoho Books, Google Sheets
- **Generic**: Zapier, Make.com, n8n via outgoing webhooks + Public API

## 1.4 Scheduled Jobs

| Job | Frequency | Purpose |
|-----|-----------|---------|
| `EventPurgeScheduler` | Daily | Hard-delete soft-deleted events past purge_after |
| `TrialExpiryScheduler` | Hourly | Transition trial → past_due |
| `StorageUsageCalculator` | Daily | Recompute tenant storage |
| `AuditLogPartitioner` | Monthly | Create next month's partition |
| `NotificationDispatcher` | On-demand (Inngest) | Multi-channel fanout |
| `WebhookDeliveryWorker` | On-demand (Queues) | Outgoing webhook delivery + retry |
| `MessageBodyPurger` | Daily | Clear WhatsApp/email body after 30d |
| `SessionReaper` | Daily | Revoke inactive sessions |
| `CurrencyRateRefresher` | Daily | Refresh FX rates |
| `GuestPIIAnonymizer` | Monthly | Prompt anonymization at 24mo |
| `EventAutoCompleter` | Daily | Mark events completed 7d post-end |
| `SmartCleanupSuggester` | Daily | Generate cleanup suggestions at 80% storage |
| `StorageOverQuotaWarner` | Daily | Grace-period reminders |
| `StorageOverQuotaArchiver` | Daily | Move overage to cold archive at day 30 |
| `StorageArchivePurger` | Daily | Permanent delete archived at day 61 |
| `KeepAliveWorker` | Daily | Prevent Supabase free-tier pause |
| `DunningEmailWorker` | Daily | Dunning sequence for past_due tenants |
| `OnboardingEmailWorker` | Daily | Day 1/3/7 onboarding emails |
| `HealthScoreCalculator` | Daily | Compute tenant health |
| `CohortAnalyzer` | Weekly | Tenant cohort metrics |
| `RevenueRecognitionWorker` | Monthly | Move deferred → recognized revenue |
| `SubdomainTakeoverScanner` | Daily | Detect orphaned custom domains |
| `BrandImpersonationScanner` | Weekly | Search for fake "occasionpro" sites |
| `SubProcessorComplianceChecker` | Quarterly | Verify sub-processor DPAs current |
| `DeviceFingerprintAnalyzer` | Hourly | Detect signup abuse patterns |
| `ChargebackProcessor` | Daily | Process chargeback webhooks, freeze accounts |
| `VendorCalendarSyncWorker` | Hourly | Pull vendor external calendars |

---

# PART 2 — PORTAL ARCHITECTURE & POWER MODEL

## 2.1 Six Portals

| Portal | Subdomain | Who Uses It |
|--------|-----------|-------------|
| **Super Admin** | `admin.occasionpro.in` | Platform owner (OccasionPro staff) |
| **Company Admin** (AI Command Center) | `app.occasionpro.in` (`/admin`) | Workspace Owner + Managers |
| **Event Manager Portal** | `app.occasionpro.in` | All workspace staff (role-filtered) |
| **Client Portal** | `client.occasionpro.in` | Event clients |
| **Guest Portal** | `links.occasionpro.in/[slug]/portal` (or tenant custom domain) | Event guests |
| **Vendor Portal** | `vendor.occasionpro.in` | Event vendors |

**Cookie strategy**: portal-scoped httpOnly cookies, `SameSite=Lax`, `Secure`, HMAC-signed. No cross-subdomain auth sharing.

## 2.2 Three-Layer Power Model

> Three power layers with non-overlapping authority. Higher layers act on lower layers only through audited, time-boxed mechanisms.

### Layer 1 — Super Admin (Platform Owner / OccasionPro)
**Scope: Platform-wide.** Acts across all tenants but never *as* a tenant without audit. Sub-roles in Part 2.9.

### Layer 2 — Workspace Owner (Tenant)
**Scope: One workspace.** Unconditional full authority within their workspace. Cannot be restricted by anyone except Super Admin via documented escape hatches.

### Layer 3 — Manager / Lead / Member

| Role | DB Key | Rank | Capabilities |
|------|--------|------|-------------|
| **Manager** | `event_manager` | 3 | Manages events and team ops. May invite Leads/Members if Owner delegates. Module access per `module_permissions`. Cannot change billing, ownership, workspace settings. |
| **Lead** | `team_lead` | 2 | Leads sub-teams within events. Can assign tasks to Members in their sub-team. |
| **Member** | `team_member` | 1 | Standard staff. Module access per `module_permissions` only. |

## 2.3 Module Permissions System

```sql
CREATE TABLE module_permissions (
  tenant_id  uuid REFERENCES tenants(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('event_manager','team_lead','team_member')),
  module     text NOT NULL,
  can_read   boolean DEFAULT false,
  can_write  boolean DEFAULT false,
  can_delete boolean DEFAULT false,
  can_export boolean DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, role, module)
);

CREATE TABLE member_permission_overrides (
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  member_id   uuid REFERENCES tenant_members(id) ON DELETE CASCADE,
  module      text NOT NULL,
  can_read    boolean,
  can_write   boolean,
  can_delete  boolean,
  can_export  boolean,
  updated_at  timestamptz DEFAULT now(),
  PRIMARY KEY (tenant_id, member_id, module)
);
```

**Seed defaults** (in `create_tenant()`):
- Manager: full r/w/d/x on all modules
- Lead: r+w on all modules
- Member: r on all modules; w on assigned modules

**Owner is never restricted** — hard-coded in guard layer.

Cache invalidation: `pg_notify('permissions_changed', tenant_id)` on UPDATE.

## 2.4 Sub-Teams (Lead Scope)

```sql
CREATE TABLE event_subteams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id    uuid REFERENCES events(id) ON DELETE CASCADE,
  name        text NOT NULL,
  lead_id     uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (event_id, lead_id)
);
CREATE INDEX idx_event_subteams_tenant ON event_subteams (tenant_id);
CREATE INDEX idx_event_subteams_event ON event_subteams (event_id);

CREATE TABLE event_subteam_members (
  subteam_id  uuid REFERENCES event_subteams(id) ON DELETE CASCADE,
  member_id   uuid REFERENCES tenant_members(id) ON DELETE CASCADE,
  added_at    timestamptz DEFAULT now(),
  PRIMARY KEY (subteam_id, member_id)
);
CREATE INDEX idx_event_subteam_members_member ON event_subteam_members (member_id);
```

## 2.5 Ownership Mechanics

```sql
CREATE UNIQUE INDEX one_owner_per_workspace
  ON tenant_members (tenant_id)
  WHERE role = 'owner' AND removed_at IS NULL;

CREATE OR REPLACE FUNCTION transfer_workspace_ownership(
  _tenant uuid, _current_owner uuid, _new_owner uuid, _actor uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF _actor <> _current_owner
     AND NOT EXISTS (SELECT 1 FROM super_admins WHERE id = _actor) THEN
    RAISE EXCEPTION 'Only current Owner or Super Admin can transfer ownership';
  END IF;
  UPDATE tenant_members SET role = 'event_manager'
   WHERE tenant_id = _tenant AND id = _current_owner AND role = 'owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'Current owner not found'; END IF;
  UPDATE tenant_members SET role = 'owner'
   WHERE tenant_id = _tenant AND id = _new_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'New owner not found'; END IF;
  PERFORM write_audit_log(_tenant, _actor, 'tenant_member',
    'ownership_transferred', _new_owner,
    jsonb_build_object('previous_owner', _current_owner),
    jsonb_build_object('new_owner', _new_owner));
END;
$$;
```

### Emergency Transfer
Multi-channel dispute (primary email + recovery email + verified mobile SMS + in-app banner) over 7-day window. Dispute via any channel without login. Late dispute (30d post-completion) reverses transfer.

```sql
CREATE TABLE pending_emergency_transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid REFERENCES tenants(id) ON DELETE CASCADE,
  current_owner_id    uuid REFERENCES tenant_members(id),
  proposed_owner_id   uuid REFERENCES tenant_members(id),
  reason              text NOT NULL,
  evidence_url        text,
  initiated_by_admin  uuid REFERENCES super_admins(id),
  initiated_at        timestamptz DEFAULT now(),
  dispute_window_end  timestamptz NOT NULL,
  disputed_at         timestamptz,
  dispute_channel     text,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  reversed_at         timestamptz
);
CREATE UNIQUE INDEX one_pending_transfer_per_tenant
  ON pending_emergency_transfers (tenant_id)
  WHERE completed_at IS NULL AND cancelled_at IS NULL;
```

## 2.6 Impersonation
30-min JWT with `impersonation: true` claim. Permitted: READ + diagnostics + feature flag toggle + support ticket status. Blocked: billing, ownership transfer, payment gateway, API keys, member changes, deletions >100 records, cloud offload OAuth, PII anonymization, subscription pause, data portability.

```sql
CREATE TABLE super_admin_impersonation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id    uuid REFERENCES super_admins(id),
  tenant_id         uuid REFERENCES tenants(id),
  impersonated_user uuid REFERENCES tenant_members(id),
  reason            text NOT NULL,
  started_at        timestamptz DEFAULT now(),
  ended_at          timestamptz,
  action_count      integer DEFAULT 0
);
CREATE INDEX idx_sai_super_admin ON super_admin_impersonation (super_admin_id, started_at);
CREATE INDEX idx_sai_tenant ON super_admin_impersonation (tenant_id, started_at);
```

## 2.7 Guards (Hono Middleware)

- `requireTenantRole(['owner','event_manager'])`
- `requireModuleAccess('guests', 'write')`
- `requireSuperAdmin(['owner','admin'])`
- `blockIfImpersonating()`
- `checkPlanLimit('events', 'create')`
- `rateLimit(scope, limit, windowSeconds)`
- `requireFreshAuth(maxAgeSeconds)` — re-prompts password for billing/secrets/ownership
- `requireIpAllowlist()` — Super Admin roles with restriction
- `requireApproval(actionType)` — 2-person approval

## 2.8 Team Member Portal Modules
CRM & Sales · Finance · Operations · Production · Hospitality · Artist Management · Venue Management · **Equipment & Inventory** · Guest Management · Marketing · Support · Mobile Operations · **Crew & Staffing** · **Shared Inbox**

## 2.9 Platform Staff Roles (Super Admin Hierarchy)

### 2.9.1 Seven Platform Roles

| Role | DB Key | Rank | Purpose |
|------|--------|------|---------|
| **Platform Owner** | `owner` | 6 | Founder / CEO — unrestricted |
| **Platform Admin** | `admin` | 5 | Day-to-day platform ops |
| **Engineering / SRE** | `engineering` | 4 | Incident response, debugging |
| **Customer Support** | `support` | 3 | Tickets, tenant help |
| **Sales / Customer Success** | `sales` | 3 | Enterprise accounts, demos |
| **Finance / Billing** | `finance` | 3 | Invoices, refunds, GST |
| **Auditor (read-only)** | `auditor` | 1 | Compliance reviews |

### 2.9.2 Sole Operator Mode (Bootstrap)

```sql
-- In platform_settings: sole_operator_mode boolean DEFAULT true
```

When active (only one Owner exists):
- All restrictions on Owner GRANTED unconditionally
- Two-person approval bypassed
- Auto-expiry doesn't apply
- IP allowlist optional
- Reason field still required (audit hygiene)
- Banner: *"Sole Operator Mode active — restrictions disabled. Add a second admin to enable separation of duties."*

**Auto-disables (one-way) when:** Second `owner` or any `admin` added. Cannot be re-enabled.

### 2.9.3 Permission Matrix

| Capability | Owner | Admin | Engineering | Support | Sales | Finance | Auditor |
|------------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Approve tenant signups | ✓ | ✓ | — | — | — | — | — |
| Suspend tenant | ✓ | ✓ | ✓ (incident) | — | — | — | — |
| Force-purge data | ✓ | ✓† | — | — | — | — | — |
| Extend trial | ✓ | ✓ | — | — | ✓ | — | — |
| Manage subscription plans | ✓ | ✓ | — | — | — | — | — |
| Override pricing | ✓ | ✓ | — | — | ✓† | — | — |
| Issue refunds | ✓ | ✓ | — | — | — | ✓‡ | — |
| View tenant billing | ✓ | ✓ | — | ✓ (plan) | ✓ | ✓ | — |
| View operational data | ✓ | ✓ | ✓ | ✓ (imp.) | — | — | — |
| Impersonate user | ✓ | ✓ | ✓ (incident) | ✓ (reason) | — | — | — |
| Emergency ownership transfer | ✓ | ✓† | — | — | — | — | — |
| Rotate tenant secrets | ✓ | ✓ | ✓ (incident) | — | — | — | — |
| Rotate platform secrets | ✓ | ✓† | — | — | — | — | — |
| Feature flags (tenant) | ✓ | ✓ | ✓ | — | ✓ | — | — |
| Feature flags (platform) | ✓ | ✓ | — | — | — | — | — |
| Approve custom domains | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Grant white-label | ✓ | ✓ | — | — | ✓ | — | — |
| WhatsApp templates | ✓ | ✓ | — | ✓ | ✓ | — | — |
| Full cross-tenant audit | ✓ | ✓ | ✓ | (own+imp) | — | ✓ | ✓ |
| Security alerts | ✓ | ✓ | ✓ | — | — | — | — |
| Tenant health & cohorts | ✓ | ✓ | — | — | ✓ | — | — |
| Manage Super Admin staff | ✓ | ✓ (≤Admin) | — | — | — | — | — |
| Create Owner accounts | ✓ (Owner) | — | — | — | — | — | — |

✓† = 2-person approval (bypassed in Sole Operator Mode)
✓‡ = Finance refund limit ₹50k self; >₹50k needs Admin approval

### 2.9.4 Two-Person Approval

```sql
CREATE TABLE super_admin_approvals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type         text NOT NULL CHECK (action_type IN (
                        'force_purge','emergency_transfer','large_refund',
                        'platform_secret_rotation','archive_plan',
                        'role_change_to_admin_or_owner','pricing_override','plan_create'
                      )),
  initiated_by        uuid REFERENCES super_admins(id),
  initiator_reason    text NOT NULL,
  target_entity_type  text,
  target_entity_id    uuid,
  proposed_changes    jsonb,
  approved_by         uuid REFERENCES super_admins(id),
  approver_reason     text,
  approved_at         timestamptz,
  rejected_at         timestamptz,
  rejected_reason     text,
  executed_at         timestamptz,
  expires_at          timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at          timestamptz DEFAULT now(),
  CHECK (initiated_by <> approved_by)
);
CREATE INDEX idx_sa_approvals_pending ON super_admin_approvals (created_at)
  WHERE approved_at IS NULL AND rejected_at IS NULL AND executed_at IS NULL;
```

### 2.9.5 Time-Boxed Access
Engineering / Support accounts auto-expire after 90d inactivity. Re-activation requires Admin approval. Engineering can't impersonate without open incident ticket. Bypassed in Sole Operator Mode.

### 2.9.6 Mandatory Reason Field
Every privileged action records reason: impersonation, force-purge, refund, emergency transfer, plan override, suspension, force-rotate. Enforced even in Sole Operator Mode.

### 2.9.7 IP Allowlist
`super_admins.allowed_ips inet[]` (NULL = no restriction). Recommended for engineering (office+VPN), finance, auditor. Never enforced in Sole Operator Mode.

### 2.9.8 Auto-Disable Sole Operator Mode

```sql
CREATE OR REPLACE FUNCTION auto_disable_sole_operator_mode() RETURNS trigger AS $$
BEGIN
  IF NEW.role IN ('owner','admin') AND NEW.removed_at IS NULL THEN
    IF (SELECT COUNT(*) FROM super_admins
         WHERE role IN ('owner','admin') AND removed_at IS NULL) > 1 THEN
      UPDATE platform_settings
         SET sole_operator_mode = false, sole_operator_disabled_at = NOW()
       WHERE sole_operator_mode = true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_disable_sole_operator
  AFTER INSERT OR UPDATE ON super_admins
  FOR EACH ROW EXECUTE FUNCTION auto_disable_sole_operator_mode();
```

---

# PART 3 — TENANT LIFECYCLE, PRICING & BILLING

## 3.1 Subscription Plans

```sql
CREATE TABLE subscription_plans (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                            text UNIQUE NOT NULL,
  name                            text NOT NULL,
  status                          text DEFAULT 'active' CHECK (status IN ('active','archived')),
  max_active_events               integer,
  max_users                       integer,
  max_storage_gb                  integer,
  max_guests_per_event            integer,
  max_concurrent_sessions         integer DEFAULT 5,
  max_emails_per_month            integer,
  max_api_requests_per_month      integer,
  max_outgoing_webhooks           integer,
  max_custom_event_types          integer,
  audit_log_retention_days        integer,
  trial_pool_sms_per_month        integer,
  -- Feature gates
  includes_conference_module      boolean DEFAULT false,
  includes_branded_exports        boolean DEFAULT false,
  includes_multi_currency         boolean DEFAULT false,
  includes_cross_event_analytics  boolean DEFAULT false,
  includes_white_label            boolean DEFAULT false,
  includes_custom_domain          boolean DEFAULT false,
  includes_ai_vendor_recommender  boolean DEFAULT false,
  includes_ai_command_center      boolean DEFAULT false,
  includes_vendor_payouts         boolean DEFAULT false,
  includes_byo_email              boolean DEFAULT false,
  includes_sso                    boolean DEFAULT false,
  includes_api_full               boolean DEFAULT false,
  includes_cloud_offload          boolean DEFAULT false,
  includes_esignature             boolean DEFAULT false,
  includes_po_billing             boolean DEFAULT false,
  includes_net30_terms            boolean DEFAULT false,
  sla_uptime_percent              numeric(5,2),
  -- Pricing
  price_inr_monthly               numeric(10,2),
  price_inr_yearly                numeric(10,2),
  price_usd_monthly               numeric(10,2),
  price_usd_yearly                numeric(10,2),
  setup_fee_inr                   numeric(10,2) DEFAULT 0,
  setup_fee_usd                   numeric(10,2) DEFAULT 0,
  trial_days                      integer DEFAULT 0,
  created_at                      timestamptz DEFAULT now(),
  archived_at                     timestamptz
);
```

### Plan Summary

| | Starter | Growth ⭐ | Pro | Enterprise |
|---|---|---|---|---|
| **Monthly INR / USD** | ₹999 / $14 | ₹2,999 / $39 | ₹7,999 / $99 | From ₹49,999 / $599 |
| **Annual INR/mo** | ₹833 | ₹2,499 | ₹6,666 | Custom |
| **Trial** | — | 14-day free | — | Negotiated POC |
| **Active events** | 3 | 10 | 40 | Unlimited (fair-use 250) |
| **Users** | 3 | 8 | 25 | Unlimited (fair-use 250) |
| **Storage base** | 10 GB | 50 GB | 200 GB | 500 GB |
| **Guests/event** | 1,000 | 5,000 | 50,000 | Unlimited |
| **Emails/mo** | 2,000 | 8,000 | 40,000 | 200,000 |
| **API/mo** | 5k read | 50k | 500k | 5M |
| **PO billing / NET-30** | — | — | — | ✓ |

All India prices +18% GST. Annual = 17% off. Currency locked at signup.

## 3.2 Tenant Subscriptions Schema

```sql
CREATE TABLE tenant_subscriptions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id                     uuid REFERENCES subscription_plans(id),
  price_override_amount       numeric(10,2),
  price_override_currency     varchar(3),
  billing_currency            varchar(3) NOT NULL,           -- LOCKED at signup
  billing_cycle               text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  status                      text DEFAULT 'trial' CHECK (status IN
    ('trial','active','past_due','suspended','cancelled','paused')),
  trial_ends_at               timestamptz,
  trial_extended_by           uuid REFERENCES super_admins(id),
  trial_extension_reason      text,
  current_period_start        timestamptz,
  current_period_end          timestamptz,
  -- Pause support (beyond 30d for annual plans)
  paused_at                   timestamptz,
  pause_resume_at             timestamptz,
  pause_max_days_remaining    integer,
  -- Gateway
  gateway                     text CHECK (gateway IN ('razorpay','stripe','manual_invoice')),
  gateway_subscription_id     text,
  gateway_customer_id         text,
  -- Currency-lock enforcement at gateway level
  gateway_currency_locked     varchar(3) NOT NULL,
  -- PO billing (Enterprise)
  po_number                   text,
  po_amount                   numeric(14,2),
  po_expires_at               timestamptz,
  payment_terms_days          integer DEFAULT 0,             -- 30 for NET-30
  cancelled_at                timestamptz,
  cancellation_reason         text,
  created_at                  timestamptz DEFAULT now(),
  UNIQUE (tenant_id),
  CHECK (gateway_currency_locked = billing_currency)        -- belt + braces
);

CREATE INDEX idx_tenant_subscriptions_expiring ON tenant_subscriptions (trial_ends_at) WHERE status = 'trial';
CREATE INDEX idx_tenant_subscriptions_plan ON tenant_subscriptions (plan_id);
CREATE INDEX idx_tenant_subscriptions_gw ON tenant_subscriptions (gateway, gateway_subscription_id);
CREATE INDEX idx_tenant_subscriptions_paused ON tenant_subscriptions (pause_resume_at) WHERE status = 'paused';
```

## 3.3 Plan Limit Enforcement (Hard Caps Everywhere)

| State | Threshold | Behaviour |
|-------|-----------|-----------|
| Healthy | < 80% | Normal |
| Warning | ≥ 80% | Yellow banner + email to Owner |
| At limit | 100% | Hard block on new CREATE; upgrade prompt |
| Over limit | — | Tenant continues to function, cannot CREATE |

**No auto-overage. Every overage requires explicit add-on purchase.**

### 3.3.1 Active-Event Metering
`max_active_events` counts only `status IN ('planning', 'live')`. Past events unlimited.

```sql
CREATE MATERIALIZED VIEW tenant_active_event_counts AS
SELECT tenant_id,
       COUNT(*) FILTER (WHERE status IN ('planning','live')) AS active_count
FROM events WHERE deleted_at IS NULL
GROUP BY tenant_id;
CREATE UNIQUE INDEX idx_taec_tenant ON tenant_active_event_counts (tenant_id);
```

### 3.3.2 Bulk Operation Throttles

Beyond per-resource quotas, bulk operations have separate per-event and per-tenant throttles:

```sql
CREATE TABLE bulk_operation_quota (
  tenant_id        uuid REFERENCES tenants(id) ON DELETE CASCADE,
  operation_type   text NOT NULL,                             -- 'guest_import','email_send','sms_send','export','webhook_deliver'
  scope            text NOT NULL,                             -- 'per_event','per_workspace'
  scope_id         uuid,                                      -- event_id if per_event
  date             date NOT NULL,
  count            integer DEFAULT 0,
  PRIMARY KEY (tenant_id, operation_type, scope, scope_id, date)
);
CREATE INDEX idx_bulk_quota_date ON bulk_operation_quota (date);
```

| Operation | Limit | Scope |
|-----------|-------|-------|
| Guest CSV import | 10,000 rows / event / day | per_event |
| Guest bulk delete | 1,000 records / day | per_workspace |
| Bulk email send | plan email cap / day, max 1/3 of monthly cap in single day | per_workspace |
| Bulk SMS send | tenant BYO provider; we enforce 1,000/hr soft cap | per_workspace |
| Bulk export | 10 exports / hour / user | per_user |
| Outgoing webhook deliveries | 100k / day / tenant | per_workspace |

Pre-operation check: 413 with `Retry-After` header if exceeded.

### 3.3.3 Concurrent Session Enforcement

```sql
CREATE TABLE auth_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  user_type          text NOT NULL CHECK (user_type IN ('tenant_member','super_admin','client','vendor','guest','speaker')),
  tenant_id          uuid REFERENCES tenants(id) ON DELETE CASCADE,
  portal             text NOT NULL,
  refresh_token_hash text NOT NULL,
  device_fingerprint text,                                    -- For device management UI
  device_name        text,                                    -- "John's iPhone 14"
  device_type        text,                                    -- 'desktop','mobile','tablet'
  os                 text,
  browser            text,
  ip_address         inet,
  ip_country         varchar(2),
  user_agent         text,
  last_seen_at       timestamptz DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoke_reason      text,                                    -- 'user_logout','admin_revoke','concurrent_limit','suspicious'
  created_at         timestamptz DEFAULT now(),
  CHECK (user_type = 'super_admin' OR tenant_id IS NOT NULL)
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id, user_type, revoked_at);
CREATE INDEX idx_auth_sessions_token_hash ON auth_sessions (refresh_token_hash);
CREATE INDEX idx_auth_sessions_fingerprint ON auth_sessions (device_fingerprint);
```

Transactional eviction on new login if `count >= max_concurrent_sessions`: revoke oldest, insert new.

## 3.4 Tenant Self-Service Sign-Up

### 3.4.1 Anti-Abuse (Always On)
- **Cloudflare Turnstile** captcha
- Per-IP rate limit: 3 signups/24hrs
- Disposable email blocklist
- Email hash dedup: `sha256(lower(email))`
- Optional phone verification (Super Admin toggle)
- **Device fingerprinting** (FingerprintJS Pro) — detect same device signing up repeatedly across emails

```sql
CREATE TABLE tenant_signup_attempts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash         text NOT NULL,
  email              text NOT NULL,
  ip_address         inet NOT NULL,
  ip_country         varchar(2),
  user_agent         text,
  device_fingerprint text,                                    -- Cross-attempt correlation
  outcome            text CHECK (outcome IN (
                       'verified','rejected_captcha','rejected_disposable',
                       'rejected_ip_rate_limit','rejected_device_fingerprint',
                       'rejected_behavioral_pattern','approved','rejected_manual','expired'
                     )),
  risk_score         numeric(3,2),                            -- 0.00–1.00 from DeviceFingerprintAnalyzer
  created_at         timestamptz DEFAULT now()
);
CREATE INDEX idx_signup_attempts_email_hash ON tenant_signup_attempts (email_hash);
CREATE INDEX idx_signup_attempts_ip ON tenant_signup_attempts (ip_address, created_at);
CREATE INDEX idx_signup_attempts_fingerprint ON tenant_signup_attempts (device_fingerprint, created_at);
```

### 3.4.2 Behavioral Pattern Analysis (Anti-Abuse)
`DeviceFingerprintAnalyzer` runs hourly. Flags patterns:
- Same fingerprint → 3+ signup attempts in 7d → block + Super Admin alert
- Same IP CIDR → 10+ signups in 24h → block
- VPN/Tor exit nodes → require additional phone OTP
- Suspicious user-agent (headless browsers) → block
- Risk score ≥ 0.8 → silently flag for Super Admin review, don't block (allows learning)

### 3.4.3 Flow
1. Landing page `/` — marketing
2. `/register` — captcha + email + password + device fingerprint capture → verification email (15-min link)
3. Workspace wizard: company name, slug, logo, timezone, **billing currency locked**
4. Plan selection (default: 14-day Growth trial)
5. Super Admin notified
6. Approval check: instant (default) OR manual
7. If manual: "Application Under Review" + 24h SLA + escalation
8. On approval: onboarding checklist (see Part 30)

## 3.5 Tenant Slug Rules

- 3–30 chars; lowercase alphanumeric + hyphen
- Reserved words blocked
- Globally unique
- Old slug → `tenant_slug_aliases` for 90-day redirect

```sql
CREATE TABLE tenant_slug_aliases (
  alias        text PRIMARY KEY,
  tenant_id    uuid REFERENCES tenants(id) ON DELETE CASCADE,
  redirects_to text NOT NULL,
  expires_at   timestamptz NOT NULL
);
```

## 3.6 Tenant Rename (Company Name Change)

Workspace Owner can change **company name** (legal name) without slug change. Common after acquisition / rebrand.

```sql
ALTER TABLE tenants ADD COLUMN previous_company_names jsonb DEFAULT '[]';
-- Append previous name + change_date on every UPDATE
```

Audit-logged. Doesn't break short links or custom domains.

## 3.7 Free Trial — 14-Day Growth Plan

Trial caps (anti-abuse):
- 5 events (not full 10)
- 3 users
- 10 GB storage
- 100 emails/day platform pool
- 30 SMS OTPs/month
- No outgoing webhooks
- No API access
- No public event website publishing (preview only)

### Trial Expiry Behaviour
- Status → `past_due`
- Workspace read-only; full-screen paywall
- 30-day data preservation
- Public surfaces read-only
- Email/SMS sending paused

### Live-Event Grace
±48hr window around `event.start_date`/`event.end_date` — check-ins, runsheet, F&B tokens, guest portal writes continue for that event.

### Trial Extension (Super Admin)
`POST /admin/tenants/:id/extend-trial` → sets `trial_ends_at`, `trial_extended_by`, `trial_extension_reason`.

## 3.8 Team Member Invitation

Owner can invite all roles. Managers can invite Lead/Member if Owner has "Delegate invitations" enabled (default ON). Short-link `/join/[token]`, 72hr expiry, race-protected.

```sql
CREATE TABLE team_invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  role          text NOT NULL CHECK (role IN ('event_manager','team_lead','team_member')),
  token         text UNIQUE NOT NULL,
  invited_by    uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  status        text DEFAULT 'pending' CHECK (status IN ('pending','accepting','accepted','revoked','expired')),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX idx_team_invitations_token ON team_invitations (token);
CREATE INDEX idx_team_invitations_tenant_email ON team_invitations (tenant_id, invited_email, status);
```

## 3.9 Feature Flags

```sql
CREATE TABLE feature_flags (
  code            text PRIMARY KEY,
  name            text NOT NULL,
  description     text,
  default_enabled boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
);
CREATE TABLE plan_feature_flags (
  plan_id   uuid REFERENCES subscription_plans(id) ON DELETE CASCADE,
  flag_code text REFERENCES feature_flags(code) ON DELETE CASCADE,
  enabled   boolean NOT NULL,
  PRIMARY KEY (plan_id, flag_code)
);
CREATE TABLE tenant_feature_overrides (
  tenant_id    uuid REFERENCES tenants(id) ON DELETE CASCADE,
  flag_code    text REFERENCES feature_flags(code) ON DELETE CASCADE,
  enabled      boolean NOT NULL,
  reason       text,
  set_by_admin uuid REFERENCES super_admins(id),
  created_at   timestamptz DEFAULT now(),
  PRIMARY KEY (tenant_id, flag_code)
);
```

Precedence: tenant override > plan flag > default.

## 3.10 API Key Management

```sql
CREATE TABLE tenant_api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  key_prefix    text NOT NULL,
  key_hash      text NOT NULL,
  scopes        text[] NOT NULL,
  created_by    uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  last_used_at  timestamptz,
  last_used_ip  inet,
  revoked_at    timestamptz,
  expires_at    timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '365 days'),
  created_at    timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX idx_api_key_hash ON tenant_api_keys (key_hash);
CREATE INDEX idx_api_keys_tenant ON tenant_api_keys (tenant_id) WHERE revoked_at IS NULL;
```

### Canonical Scopes
`read:guests` · `write:guests` · `delete:guests` · `export:guests` · `read:events` · `write:events` · `delete:events` · `read:vendors` · `write:vendors` · `read:runsheet` · `write:runsheet` · `read:fnb` · `write:fnb` · `read:invoices` · `write:invoices` · `export:invoices` · `read:payments` · `write:payments.refund` · `read:floorplan` · `write:floorplan` · `read:reports` · `export:reports` · `read:tickets` · `write:tickets` · `read:storage` · `write:storage` · `delete:storage` · `admin:webhooks` · `admin:members` · `admin:billing`

`admin:*` scopes are Owner-only.

## 3.11 Force-Rotate Secrets

Super Admin can force-rotate per-tenant: API keys, webhook signing secrets, payment gateway credentials reference, SMTP credentials reference. Platform-wide emergency rotation logged with `severity = 'critical'`.

## 3.12 Storage Add-Ons

```sql
CREATE TABLE storage_addons_catalog (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text UNIQUE NOT NULL,
  name              text NOT NULL,
  extra_gb          integer NOT NULL CHECK (extra_gb > 0),
  price_inr_monthly numeric(10,2),
  price_inr_yearly  numeric(10,2),
  price_usd_monthly numeric(10,2),
  price_usd_yearly  numeric(10,2),
  status            text DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at        timestamptz DEFAULT now()
);
CREATE TABLE tenant_storage_addons (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  addon_id                    uuid REFERENCES storage_addons_catalog(id),
  quantity                    integer DEFAULT 1 CHECK (quantity > 0),
  status                      text DEFAULT 'active' CHECK (status IN ('active','cancelled','past_due')),
  current_period_start        timestamptz,
  current_period_end          timestamptz,
  cancelled_at                timestamptz,
  cancellation_cooldown_until timestamptz,                    -- 30d cooldown on same-pack re-cancel
  created_at                  timestamptz DEFAULT now()
);
CREATE INDEX idx_tenant_storage_addons_tenant ON tenant_storage_addons (tenant_id) WHERE status = 'active';
```

| Pack | Extra | INR/mo | USD/mo | Margin |
|------|-------|--------|--------|--------|
| Mini | +25 GB | ₹399 | $5 | 92% |
| Small | +50 GB | ₹699 | $8 | 91% |
| Medium | +250 GB | ₹2,499 | $30 | 88% |
| Large | +1 TB | ₹8,999 | $108 | 86% |
| XL | +5 TB | ₹39,999 | $480 | 84% |

### Cancellation Grace Flow
Day 0 confirm → Day 1-30 grace (re-buy any time) → Day 30 archive overage → Day 31-60 retrievable → Day 61 purge. 30-day cooldown prevents churn dance.

## 3.13 Capacity & Feature Add-Ons

```sql
CREATE TABLE addons_catalog (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text UNIQUE NOT NULL,
  name              text NOT NULL,
  category          text NOT NULL CHECK (category IN ('capacity','feature','communication','ai','support')),
  description       text,
  price_inr_monthly numeric(10,2),
  price_inr_yearly  numeric(10,2),
  price_usd_monthly numeric(10,2),
  price_usd_yearly  numeric(10,2),
  applies_to_plans  text[],
  status            text DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at        timestamptz DEFAULT now()
);
CREATE TABLE tenant_addons (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid REFERENCES tenants(id) ON DELETE CASCADE,
  addon_id             uuid REFERENCES addons_catalog(id),
  quantity             integer DEFAULT 1 CHECK (quantity > 0),
  status               text DEFAULT 'active' CHECK (status IN ('active','cancelled','past_due')),
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz DEFAULT now()
);
CREATE INDEX idx_tenant_addons_tenant ON tenant_addons (tenant_id) WHERE status = 'active';
```

Capacity packs: +events, +users, +emails, +API calls, +concurrent sessions
Feature add-ons: white-label, custom domain, AI Vendor Recommender, AI Command Center, BYO email, vendor payouts, multi-currency dashboard, e-signature, priority support, dedicated CSM

## 3.14 Billing & Payment Processing

### 3.14.1 Gateway Currency Lock
At signup, tenant's billing currency is locked to one of INR (Razorpay) or USD (Stripe). The `tenant_subscriptions.gateway_currency_locked` field is part of every charge request. Gateway returns 400 if mismatch attempted.

```typescript
// Worker pseudo-code
async function chargeSubscription(tenantId: string, amount: number, currency: string) {
  const sub = await getSubscription(tenantId);
  if (sub.gateway_currency_locked !== currency) {
    throw new Error('Currency mismatch — refused at gateway level');
  }
  // proceed
}
```

### 3.14.2 Backup Card

```sql
CREATE TABLE tenant_payment_methods (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid REFERENCES tenants(id) ON DELETE CASCADE,
  gateway               text NOT NULL CHECK (gateway IN ('razorpay','stripe')),
  gateway_payment_method_id text NOT NULL,                    -- card token from gateway
  last4                 text,
  brand                 text,                                  -- 'visa','mastercard','amex','rupay'
  exp_month             integer,
  exp_year              integer,
  is_primary            boolean DEFAULT false,
  is_backup             boolean DEFAULT false,
  added_by              uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at            timestamptz DEFAULT now(),
  removed_at            timestamptz,
  CHECK (NOT (is_primary AND is_backup))                      -- can't be both
);
CREATE INDEX idx_payment_methods_tenant ON tenant_payment_methods (tenant_id) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX one_primary_card_per_tenant
  ON tenant_payment_methods (tenant_id) WHERE is_primary = true AND removed_at IS NULL;
CREATE UNIQUE INDEX one_backup_card_per_tenant
  ON tenant_payment_methods (tenant_id) WHERE is_backup = true AND removed_at IS NULL;
```

On primary failure: try backup. If backup also fails: enter dunning.

### 3.14.3 Invoice Email Recipients (Separate from Owner)

```sql
CREATE TABLE tenant_invoice_recipients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid REFERENCES tenants(id) ON DELETE CASCADE,
  email        text NOT NULL,
  name         text,
  role         text,                                          -- 'finance','accounts_payable','ceo'
  receive_invoices boolean DEFAULT true,
  receive_receipts boolean DEFAULT true,
  receive_dunning  boolean DEFAULT true,
  added_by     uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX idx_invoice_recipients_tenant ON tenant_invoice_recipients (tenant_id);
```

### 3.14.4 PO-Based Billing (Enterprise)

```sql
CREATE TABLE purchase_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid REFERENCES tenants(id) ON DELETE CASCADE,
  po_number         text NOT NULL,
  po_amount         numeric(14,2) NOT NULL,
  po_currency       varchar(3) NOT NULL,
  po_issued_date    date,
  po_expires_date   date,
  po_document_url   text,                                     -- R2 link to scanned PO
  approved_by_admin uuid REFERENCES super_admins(id),
  approved_at       timestamptz,
  status            text DEFAULT 'pending_review' CHECK (status IN
    ('pending_review','approved','active','exhausted','expired','cancelled')),
  amount_consumed   numeric(14,2) DEFAULT 0,
  notes             text,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (tenant_id, po_number)
);
CREATE INDEX idx_po_tenant ON purchase_orders (tenant_id, status);
```

Flow: Enterprise tenant uploads PO → Finance role reviews → approves → status='active'. Invoices charge against PO amount until exhausted. On exhaustion: Owner notified; new PO required.

### 3.14.5 NET-30 Payment Terms (Enterprise)

`tenant_subscriptions.payment_terms_days` (default 0 = charge immediately; 30 = NET-30). On NET-30:
- Invoice issued on `current_period_start`
- Payment due `+30 days`
- Day 31: status → `past_due`
- Day 38 / 45 / 52 / 60: dunning emails (see 3.14.6)
- Day 60: status → `suspended`

### 3.14.6 Dunning Email Sequence

```sql
CREATE TABLE dunning_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id      uuid REFERENCES invoices(id) ON DELETE SET NULL,
  attempt_number  integer NOT NULL,                           -- 1-5
  sent_at         timestamptz DEFAULT now(),
  channel         text CHECK (channel IN ('email','sms','in_app','phone_call_scheduled')),
  outcome         text CHECK (outcome IN ('sent','delivered','opened','clicked','paid','no_response')),
  recipient_email text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_dunning_tenant ON dunning_events (tenant_id, sent_at);
```

**`DunningEmailWorker` schedule (5-touchpoint sequence over 14 days):**

| Day | Channel | Tone | Action |
|-----|---------|------|--------|
| 1 | Email | Soft reminder | "Your payment didn't go through" + update card link |
| 3 | Email | Reminder | "Try a different payment method" + backup card prompt |
| 5 | Email + In-app banner | Firm | "Your account will be suspended in 9 days" |
| 9 | SMS + Email | Urgent | "Account suspension imminent — pay now to avoid disruption" |
| 14 | Email | Final notice | "Account suspended. 30-day grace before data purge." |

Sales role gets notified at Day 9 for high-value tenants (Pro+/Enterprise).

### 3.14.7 Proration Logic (Mid-Cycle Add-On / Plan Changes)

**Prorate algorithm** (charged in tenant's billing currency):

```
remaining_days = (period_end - now) / 86400
total_days = (period_end - period_start) / 86400
prorated_amount = (new_price - old_price) × (remaining_days / total_days)
```

Examples:
- **Plan upgrade** mid-cycle: refund `old_plan × remaining_ratio` → charge `new_plan × remaining_ratio`
- **Add-on purchase** mid-cycle: charge `addon_monthly × remaining_ratio` (rounded to 2 decimals)
- **Add-on cancellation** mid-cycle: no refund; runs to period end (except storage with grace flow)
- **Downgrade** mid-cycle: takes effect next period (no refund)

Computed by `ProrationCalculator` service, audit-logged with `before/after` math.

### 3.14.8 Subscription Pause (Beyond 30 Days)

Pause available on annual plans (monthly plans: cancel instead). Allows tenants taking off-season breaks (wedding planners, seasonal events).

| Plan | Max pause / year | Min pause | Max pause continuous |
|------|------------------|-----------|----------------------|
| Starter | — (cancel only) | — | — |
| Growth | 60 days | 7 days | 30 days |
| Pro | 90 days | 7 days | 60 days |
| Enterprise | 180 days | 7 days | 120 days |

```sql
CREATE TABLE subscription_pauses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  paused_at       timestamptz DEFAULT now(),
  pause_resume_at timestamptz NOT NULL,
  reason          text,
  initiated_by    uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  resumed_at      timestamptz,
  cancelled_during_pause boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_subscription_pauses_resume ON subscription_pauses (pause_resume_at)
  WHERE resumed_at IS NULL;
```

During pause:
- Workspace read-only
- No billing charges
- Subscription period frozen — extended by pause duration on resume
- Realtime + portals continue serving (read-only)
- Email/SMS sending paused
- Auto-resume at `pause_resume_at` OR earlier on tenant request

### 3.14.9 Chargeback Handling Workflow

```sql
CREATE TABLE chargebacks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id          uuid REFERENCES payments(id) ON DELETE SET NULL,
  gateway             text NOT NULL CHECK (gateway IN ('razorpay','stripe')),
  gateway_dispute_id  text NOT NULL,
  amount              numeric(14,2) NOT NULL,
  currency_code       varchar(3) NOT NULL,
  reason_code         text,                                   -- gateway reason
  reason_description  text,
  status              text DEFAULT 'received' CHECK (status IN
    ('received','evidence_required','evidence_submitted','won','lost','accepted')),
  evidence_due_by     timestamptz,
  evidence_submitted_at timestamptz,
  evidence_files      jsonb,                                  -- R2 file references
  resolution_at       timestamptz,
  account_action      text CHECK (account_action IN ('none','warning','frozen','suspended','terminated')),
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX idx_chargebacks_tenant ON chargebacks (tenant_id);
CREATE INDEX idx_chargebacks_gateway ON chargebacks (gateway, gateway_dispute_id);
```

**Automatic chargeback response:**
1. Webhook from Razorpay/Stripe arrives → `chargebacks` row created
2. `ChargebackProcessor` worker runs:
   - Auto-collect evidence: invoice PDF, audit-log usage proof, IP records, login timestamps
   - Upload to R2; reference in `evidence_files`
   - Notify Finance role + Workspace Owner
3. Finance role reviews + submits evidence (or accepts loss)
4. On 3rd chargeback in 90 days → account frozen pending review (anti-fraud)
5. Won → no action; Lost → tenant balance debited; Accepted → tenant balance debited + warning

### 3.14.10 Failed Payment Retry Cascade

3 smart retries (1d, 3d, 7d) → past_due → 14d → suspended → 30d → 30d data hold → purge. Combined with dunning sequence (3.14.6).

### 3.14.11 Razorpay & Stripe Integration

- Razorpay (India): subscriptions, recurring, UPI/cards/netbanking
- Stripe (international): subscriptions, recurring, cards
- All card data via gateway-hosted iframe (PCI SAQ-A)
- Stored: only `gateway_payment_method_id`, `gateway_subscription_id`, `gateway_customer_id`

## 3.15 Revenue Recognition (Accrual Accounting)

For annual prepay, revenue is **earned over the period**, not on collection.

```sql
CREATE TABLE revenue_recognition_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id      uuid REFERENCES invoices(id) ON DELETE SET NULL,
  amount_total    numeric(14,2) NOT NULL,
  amount_recognized numeric(14,2) DEFAULT 0,
  amount_deferred numeric(14,2) NOT NULL,
  currency_code   varchar(3) NOT NULL,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  recognition_method text DEFAULT 'straight_line' CHECK (recognition_method IN ('straight_line','milestone','immediate')),
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_revrec_tenant ON revenue_recognition_entries (tenant_id);
CREATE INDEX idx_revrec_period ON revenue_recognition_entries (period_start, period_end);

CREATE TABLE revenue_recognition_monthly (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id            uuid REFERENCES revenue_recognition_entries(id) ON DELETE CASCADE,
  recognition_month   date NOT NULL,
  amount_recognized   numeric(14,2) NOT NULL,
  recognized_at       timestamptz DEFAULT now(),
  UNIQUE (entry_id, recognition_month)
);
CREATE INDEX idx_revrec_monthly_month ON revenue_recognition_monthly (recognition_month);
```

`RevenueRecognitionWorker` runs monthly:
- For each `revenue_recognition_entries` row where `period_end > NOW()`:
  - Compute month's portion: `amount_total × (days_in_month / total_period_days)`
  - Insert into `revenue_recognition_monthly`
  - Update `amount_recognized` and `amount_deferred`
- Outputs feed into Finance role's monthly P&L dashboard

## 3.16 Tenant Data Portability

### 3.16.1 Full Data Export Before Downgrade
Before any plan downgrade that reduces capacity (storage, users, events) **below current usage**, the tenant MUST:
1. Click "Download all my data first" button → generates ZIP via `DataExportWorker`
2. Receive email with R2 link (expires 7 days, encrypted)
3. Confirm "I have downloaded my data" checkbox before proceeding

```sql
CREATE TABLE tenant_data_exports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by    uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  export_type     text CHECK (export_type IN ('full','pre_downgrade','pre_cancellation','dsar')),
  status          text DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','expired')),
  zip_url         text,                                       -- R2 signed URL
  zip_size_bytes  bigint,
  zip_expires_at  timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  error_message   text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_data_exports_tenant ON tenant_data_exports (tenant_id, created_at DESC);
```

### 3.16.2 Tenant-to-Tenant Data Transfer (M&A)

When an agency is acquired or merged, Workspace Owner can request transfer of all events/guests/files to another tenant on the platform.

```sql
CREATE TABLE tenant_transfer_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  target_tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  initiated_by         uuid REFERENCES tenant_members(id),
  target_confirmed_by  uuid REFERENCES tenant_members(id),
  scope                jsonb NOT NULL,                        -- {'events': [...], 'vendors': true, 'clients': true, ...}
  legal_documents_url  text,                                  -- M&A documents (R2 link)
  approved_by_admin    uuid REFERENCES super_admins(id),
  status               text DEFAULT 'requested' CHECK (status IN
    ('requested','target_confirmed','admin_approved','running','completed','rejected','failed','cancelled')),
  started_at           timestamptz,
  completed_at         timestamptz,
  error_message        text,
  created_at           timestamptz DEFAULT now(),
  CHECK (source_tenant_id <> target_tenant_id)
);
CREATE INDEX idx_transfer_source ON tenant_transfer_requests (source_tenant_id);
CREATE INDEX idx_transfer_target ON tenant_transfer_requests (target_tenant_id);
```

Flow:
1. Source Owner initiates → request created
2. Target Owner confirms acceptance
3. Super Admin (Admin or Owner role) approves with M&A legal documentation
4. Two-person approval (in non-Sole-Operator-Mode)
5. `TenantTransferWorker` (Inngest function, 4-hour limit):
   - Streams events, guests, vendors, files (R2 copy), invoices, audit-log shadows
   - Updates all `tenant_id` references
   - Updates audit log with merge metadata
   - Source tenant: data archived (kept 90 days post-merge for dispute), then purged
6. Both Owners notified; activity logged in both audit trails

## 3.17 GST & Tax Handling (India)

- India tenants: 18% GST on invoice; HSN 998314
- Tenant GSTIN captured at signup (optional but required for input credit)
- Invoice fields: tenant GSTIN, OccasionPro GSTIN, HSN, place of supply
- International tenants: no VAT collected; tenant handles reverse charge in their country

```sql
ALTER TABLE tenants ADD COLUMN business_country text;
ALTER TABLE tenants ADD COLUMN gstin text;
ALTER TABLE tenants ADD COLUMN vat_number text;
ALTER TABLE tenants ADD COLUMN tax_exempt_certificate text;
```

## 3.18 Refund & Cancellation Policy

| Scenario | Refund |
|----------|--------|
| Monthly cancel | None; runs to period end |
| Annual within 30d | Full refund |
| Annual after 30d | Pro-rata of unused months minus 17% discount portion |
| SLA breach | Service credits per contract |
| Chargeback | Per 3.14.9 |
| Enterprise early termination | Per contract; usually 50% of remaining |
| Storage add-on cancel | Grace flow per 3.12 |
| Currency change | Not supported; requires account closure |
| Subscription pause | Per 3.14.8 |
| Tenant-to-tenant transfer | No refund on source; source data archived |

---

# PART 4 — EVENT FOUNDATION & LIFECYCLE

## 4.1 Event Types

15 built-in: Wedding · Corporate · Birthday · Conference · Concert · Exhibition · Product Launch · Award Ceremony · Funeral · Engagement · Baby Shower · Religious Ceremony · Sports Event · Social Gathering · Gala/Fundraiser. Plus tenant-custom types.

```sql
CREATE TABLE event_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,    -- NULL for system
  code          text NOT NULL,
  name          text NOT NULL,
  icon          text,
  description   text,
  is_system     boolean DEFAULT false,
  tone          text DEFAULT 'celebratory' CHECK (tone IN ('celebratory','solemn','formal','playful')),
  default_fnb_style text,
  default_session_duration interval,
  created_at    timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX idx_event_types_system_code ON event_types (code) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX idx_event_types_tenant_code ON event_types (tenant_id, code) WHERE tenant_id IS NOT NULL;

CREATE TABLE event_type_readiness_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type_id uuid REFERENCES event_types(id) ON DELETE CASCADE,
  label         text NOT NULL,
  module        text,
  check_query   text,
  weight        integer DEFAULT 1,
  sort_order    integer DEFAULT 0
);
CREATE INDEX idx_readiness_items_type ON event_type_readiness_items (event_type_id);

CREATE TABLE event_readiness_state (
  event_id     uuid REFERENCES events(id) ON DELETE CASCADE,
  item_id      uuid REFERENCES event_type_readiness_items(id) ON DELETE CASCADE,
  is_complete  boolean DEFAULT false,
  completed_at timestamptz,
  completed_by uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  PRIMARY KEY (event_id, item_id)
);
CREATE INDEX idx_readiness_state_item ON event_readiness_state (item_id);
```

## 4.2 Pre-Built Event Templates (Kits)

Reduces empty-state friction; tenants start from a complete scaffold.

```sql
CREATE TABLE event_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid REFERENCES tenants(id) ON DELETE CASCADE,   -- NULL = platform-built-in
  code           text NOT NULL,
  name           text NOT NULL,
  description    text,
  cover_image_url text,
  event_type_id  uuid REFERENCES event_types(id) ON DELETE CASCADE,
  scaffold       jsonb NOT NULL,                                  -- includes: runsheet template, vendor categories, F&B style, guest categories, budget template, invitation template
  is_system      boolean DEFAULT false,
  is_published   boolean DEFAULT true,
  use_count      integer DEFAULT 0,
  created_by     uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT scaffold_size_limit CHECK (octet_length(scaffold::text) < 524288)  -- 512KB
);
CREATE INDEX idx_templates_type ON event_templates (event_type_id);
CREATE INDEX idx_templates_system ON event_templates (is_system) WHERE is_system = true;
```

**Platform-built-in kits** (seeded at install):
1. **Indian Wedding Kit** — sangeet, mehendi, baraat, ceremony, reception sub-events + full vendor list (caterer, decorator, photographer, makeup, mehendi artist, etc.)
2. **Corporate Annual Conference Kit** — multi-day sessions, speakers, sponsors, networking, registration
3. **Product Launch Kit** — venue, press, RSVP, demo stations, post-launch report
4. **Trade Exhibition Kit** — booths, exhibitor portal, foot traffic tracking
5. **Concert / Music Event Kit** — artist coordination, tickets, sound check, runsheet
6. **Birthday / Private Party Kit** — small-scale, single-day, F&B-focused
7. **Award Ceremony / Gala Kit** — VIP seating, awards list, hospitality
8. **Religious Ceremony Kit** — solemn tone defaults; ritual schedule; family-segmented guest list
9. **Funeral / Memorial Kit** — solemn defaults; condolence guest book; no festive elements
10. **Sports Tournament Kit** — multi-round bracket; team management; venue rotation

When a tenant creates an event from a kit, the scaffold copies into the new event (events, runsheet_tasks, vendor categories, F&B style, etc.) — fully editable.

## 4.3 Currency Per Event

```sql
CREATE TABLE currency_rates (
  rate_date   date NOT NULL,
  base_code   varchar(3) NOT NULL,
  target_code varchar(3) NOT NULL,
  rate        numeric(18,8) NOT NULL,
  source      text NOT NULL,
  PRIMARY KEY (rate_date, base_code, target_code)
);
```

`CurrencyRateRefresher` daily; exchangerate.host primary, open.er-api.com fallback.

## 4.4 Timezone Per Event
IANA string per event. Workspace default set by Owner; user toggle "event vs local" stored in `tenant_members.timezone_display_pref`.

## 4.5 Event Lifecycle (Full State Machine)

```
PLANNING → LIVE (auto on start_date) → COMPLETED (auto end_date + 7d)
                                          ↓
                                       ARCHIVED (manual)
                                          ↓
                            OFFLOADED / DELETED-MEDIA / DELETED
```

Reactivation: completed → planning only within 30d; after that must clone.

```sql
ALTER TABLE events ADD COLUMN completed_at timestamptz;
ALTER TABLE events ADD COLUMN cancelled_at timestamptz;
ALTER TABLE events ADD COLUMN archived_at timestamptz;
ALTER TABLE events ADD COLUMN offloaded_at timestamptz;
ALTER TABLE events ADD COLUMN offload_destination text;
ALTER TABLE events ADD COLUMN offload_location_url text;
ALTER TABLE events ADD COLUMN offload_size_bytes bigint;
ALTER TABLE events ADD COLUMN guests_anonymized_at timestamptz;
```

## 4.6 Concurrent Edit Conflict Resolution (Beyond LWW)

When two Managers edit the same event simultaneously, **LWW silently dropping changes** is unacceptable. The platform now uses:

```sql
CREATE TABLE event_edit_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid REFERENCES events(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES tenant_members(id) ON DELETE CASCADE,
  field_path      text NOT NULL,                                -- 'name','venue','start_date','runsheet.task.123.title'
  locked_at       timestamptz DEFAULT now(),
  expires_at      timestamptz DEFAULT (NOW() + INTERVAL '60 seconds'),
  released_at     timestamptz,
  UNIQUE (event_id, field_path) WHERE released_at IS NULL
);
CREATE INDEX idx_edit_sessions_event ON event_edit_sessions (event_id) WHERE released_at IS NULL;
CREATE INDEX idx_edit_sessions_expires ON event_edit_sessions (expires_at) WHERE released_at IS NULL;
```

### Mechanism
1. User clicks into a field → frontend acquires soft lock via Supabase Broadcast + DB row insert
2. Other users see "John is editing this field" indicator (Part 13)
3. Lock auto-expires after 60s of inactivity (heartbeat extends)
4. If another user attempts to edit a locked field:
   - **Soft block**: dialog "John is currently editing this. Wait, or take over?"
   - "Take over" → revokes other user's lock, notifies them
5. On save with **field-level OCC**:
   - Compare `updated_at` of each changed field vs server
   - If divergent: **Conflict Resolution Modal** shows side-by-side diff with [Keep mine] [Keep theirs] [Merge] options
   - Audit-log every conflict resolution

`ConflictResolver` Inngest function runs cleanup of stale locks (>5 min unreferenced).

## 4.7 Cloud Offload Integration (Pro+)

```sql
CREATE TABLE tenant_external_storage (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid REFERENCES tenants(id) ON DELETE CASCADE,
  provider                 text NOT NULL CHECK (provider IN ('google_drive','dropbox','onedrive','s3','r2','b2','wasabi')),
  access_token_encrypted   bytea NOT NULL,
  refresh_token_encrypted  bytea,
  token_expires_at         timestamptz,
  root_folder_id           text,
  display_name             text,
  is_default               boolean DEFAULT false,
  connected_by             uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  status                   text DEFAULT 'active' CHECK (status IN ('active','expired','disconnected')),
  created_at               timestamptz DEFAULT now()
);
CREATE INDEX idx_tenant_ext_storage_tenant ON tenant_external_storage (tenant_id) WHERE status = 'active';

CREATE TABLE event_offload_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES events(id) ON DELETE CASCADE,
  storage_id      uuid REFERENCES tenant_external_storage(id) ON DELETE SET NULL,
  status          text DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  bytes_offloaded bigint,
  files_count     integer,
  started_at      timestamptz,
  completed_at    timestamptz,
  error_message   text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_offload_jobs_event ON event_offload_jobs (event_id);
CREATE INDEX idx_offload_jobs_pending ON event_offload_jobs (status, created_at) WHERE status IN ('queued','running');
```

Storage action choices for past events: Keep · Lite Archive · Offload to tenant's cloud · Delete media · Delete event entirely.

## 4.8 Smart Cleanup

```sql
CREATE TABLE storage_cleanup_suggestions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid REFERENCES tenants(id) ON DELETE CASCADE,
  suggestion_type  text CHECK (suggestion_type IN ('lite_archive_old','delete_duplicates','delete_old_exports','delete_old_pdfs','offload_old')),
  target_event_ids uuid[],
  bytes_to_free    bigint,
  description      text,
  generated_at     timestamptz DEFAULT now(),
  dismissed_at     timestamptz,
  applied_at       timestamptz
);
```

`SmartCleanupSuggester` runs at 80% storage.

## 4.9 Event Deletion — 30-Day Soft Delete

Cascade soft-delete via `soft_delete_event(event_id)`. All child tables include `deleted_at` and `purge_after`. Restore by Workspace Owner within 30 days. After 30d: `EventPurgeScheduler` hard-deletes.

Super Admin powers: force-purge early; extend window. Both audit-logged.

## 4.10 Bulk Operation Limits Per Event

Beyond the workspace-level throttles in Part 3.3.2, per-event limits:

| Operation | Per-Event Limit |
|-----------|-----------------|
| Guest CSV import | 10,000 rows per import call; max 50,000/day/event |
| Guest bulk update | 5,000 rows per call |
| Bulk RSVP reminder | up to `max_guests_per_event` (plan cap) |
| Bulk seating assignment | 5,000 per call (chunked) |
| Bulk check-in | unlimited (real-time, throttled by API rate limits) |

If import file exceeds limits: tenant prompted to "split into multiple files."

---

# PART 5 — COMMUNICATION INFRASTRUCTURE

## 5.1 Email System

**Default**: Resend. **Pattern**: pluggable `IEmailProvider`.

```typescript
interface IEmailProvider {
  sendEmail(to: string, subject: string, html: string, from?: string): Promise<void>
  sendBulk(emails: EmailPayload[]): Promise<BulkEmailResult>
}
```

Providers: `ResendProvider` (default) · `SendGridProvider` · `SMTPProvider` · `MailgunProvider` · `AmazonSESProvider`

### Provider Selection (Strict Priority)
1. Tenant-configured provider (Enterprise with `byo_email_provider = true`)
2. Platform default (all platform + tenant emails on lower plans)
3. `EMAIL_PROVIDER` env var (dev fallback)

### Sender Categories

| Category | From | Sender |
|----------|------|--------|
| Platform | `noreply@occasionpro.in` | OccasionPro |
| Tenant default | `[slug]@notify.occasionpro.in` (reply-to tenant) | Tenant via platform |
| Tenant verified domain (Pro+) | `[anything]@[tenant-domain]` | Tenant via DKIM verified domain |
| Tenant custom provider (Enterprise) | Tenant's config | Tenant's own account |

### Domain Verification
SPF (TXT) + DKIM (CNAME) + DMARC (TXT). Re-checked weekly.

### Trial Pool Protection
Platform Resend cap: 50,000 emails/day across all trial tenants. Per-trial-tenant slice: 100/day.

```sql
CREATE TABLE email_daily_quota (
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  date        date NOT NULL,
  sent_count  integer DEFAULT 0,
  limit_value integer NOT NULL,
  PRIMARY KEY (tenant_id, date)
);
```

### Transactional Emails
Welcome · Email verification · Password reset (15-min) · RSVP confirmation · Event reminders · Guest thank-you · Invoice delivery · Payment receipt · Team invite · Vendor invite · Trial welcome/expiring/expired · Tenant approval status · Emergency transfer notice · Storage warnings · Add-on receipts · GST invoice · Dunning sequence (Day 1/3/5/9/14) · Onboarding sequence (Day 1/3/7) · Subscription pause confirmation · Chargeback notification · Data export ready · Tenant-to-tenant transfer notice

## 5.2 SMS / OTP & WhatsApp

```typescript
interface ISMSProvider {
  sendOTP(mobile: string, otp: string, eventName?: string): Promise<void>
  sendTemplate(mobile: string, templateName: string, vars: Record<string,string>): Promise<void>
}
```

Providers: `Fast2SMSProvider` (India default) · `MSG91Provider` · `TwilioProvider` · `TextLocalProvider` · `PlivoProvider`

### India DLT Registration (TRAI Compliance — Mandatory)
- All Indian SMS templates must be registered on DLT before use
- `whatsapp_templates` table extended (see 5.2.1)
- OccasionPro registers platform OTP/RSVP/reminder templates; tenants register their own custom templates via Super Admin assistance

### Phone Format
E.164 (`+919876543210`) validated server-side.

### WhatsApp Templates (Meta Approval + DLT)

```sql
CREATE TABLE whatsapp_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name    text NOT NULL,
  category         text CHECK (category IN ('authentication','transactional','marketing','utility')),
  language_code    text DEFAULT 'en',
  body_text        text NOT NULL,
  variables        text[],
  meta_status      text DEFAULT 'pending' CHECK (meta_status IN ('pending','approved','rejected','paused')),
  meta_template_id text,
  dlt_template_id  text,                                    -- India TRAI DLT registration
  dlt_entity_id    text,
  approved_at      timestamptz,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (template_name, language_code)
);
```

### Trial Pool (Platform-Paid Pool)
- Trial + Starter: 50 OTPs/day shared Fast2SMS pool
- Paid plans: tenant BYO credentials

## 5.3 Short Links Module

### Cloudflare Worker Routing

```
[domain]/[path]:
  /^[A-Za-z0-9]{6,8}$/             → short_links.code → 302 redirect
  /^([a-z0-9-]+)\/portal\/?$/      → Slug → Guest Portal
  /^([a-z0-9-]+)\/g\/([A-Za-z0-9]+)\/?$/ → Slug + guest code → Guest Portal prefill
  /^e\/([a-z0-9-]+)\/?$/           → Public Event Website
  /^i\/([A-Za-z0-9]+)\/?$/         → Invitation viewer
  /^speaker\/([A-Za-z0-9]+)\/?$/   → Speaker magic-link
  else                              → 404
```

### Custom Domain Provisioning (Pro+)
1. Owner adds domain
2. System generates CNAME (`events.tenant.com → cf-link-router.occasionpro.in`)
3. DNS poller every 5min
4. On verified → Super Admin approval queue (15-min SLA)
5. Cloudflare for SaaS API provisions SSL + Worker route

```sql
CREATE TABLE tenant_custom_domains (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid REFERENCES tenants(id) ON DELETE CASCADE,
  domain             text UNIQUE NOT NULL,
  purpose            text NOT NULL CHECK (purpose IN ('shortlinks','website','both')),
  cname_target       text NOT NULL,
  dns_verified_at    timestamptz,
  approved_by        uuid REFERENCES super_admins(id) ON DELETE SET NULL,
  approved_at        timestamptz,
  ssl_provisioned_at timestamptz,
  status             text DEFAULT 'pending_dns' CHECK (status IN ('pending_dns','dns_verified','pending_approval','active','revoked')),
  created_at         timestamptz DEFAULT now()
);

CREATE TABLE short_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE NOT NULL,
  destination_url text NOT NULL,
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES events(id) ON DELETE CASCADE,
  link_type       text NOT NULL,
  guest_id        uuid REFERENCES guests(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  expires_at      timestamptz,
  password_hash   text,
  click_count     integer DEFAULT 0,
  custom_alias    text UNIQUE,
  is_active       boolean DEFAULT true,
  deleted_at      timestamptz,
  purge_after     timestamptz,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_short_links_tenant ON short_links (tenant_id);
CREATE INDEX idx_short_links_event ON short_links (event_id);

CREATE TABLE short_link_clicks (
  id           bigserial PRIMARY KEY,
  link_id      uuid REFERENCES short_links(id) ON DELETE CASCADE,
  clicked_at   timestamptz DEFAULT now(),
  ip_address   inet,
  user_agent   text,
  device_type  text,
  referrer     text,
  country_code varchar(2)
);
CREATE INDEX idx_short_link_clicks_link ON short_link_clicks (link_id, clicked_at);
```

## 5.4 Cookie & Session Architecture

| Cookie | Domain | Purpose |
|--------|--------|---------|
| `op_admin_session` | `admin.occasionpro.in` | Super Admin |
| `op_app_session` | `app.occasionpro.in` | Tenant staff |
| `op_client_session` | `client.occasionpro.in` | Client portal |
| `op_vendor_session` | `vendor.occasionpro.in` | Vendor portal |
| `op_guest_session` | portal URL | Guest portal |

All: `httpOnly`, `Secure`, `SameSite=Lax`, HMAC-signed. No cross-subdomain sharing.

Access: 1hr · Refresh: 7 days (rotated). Guest portal: configurable (event-day / 7d / 30d).

---

# PART 6 — GUEST-FACING MODULES

## 6.1 Digital Animated Invitations

10 templates · static / animated web / video · drag-drop builder · unique guest short link · WhatsApp/Email/QR share · PDF/PNG export.

```sql
CREATE TABLE invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id      uuid REFERENCES events(id) ON DELETE CASCADE,
  template_code text NOT NULL,
  config        jsonb NOT NULL,
  is_published  boolean DEFAULT false,
  published_at  timestamptz,
  created_by    uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT config_size_limit CHECK (octet_length(config::text) < 1048576)
);
CREATE INDEX idx_invitations_event ON invitations (event_id);
```

## 6.2 Guest Portal

### Default: OFF (link-only access).

### Toggle Authority

| Setting | Who can change |
|---------|----------------|
| Workspace default | Workspace Owner only |
| Per-event toggle | Owner · Manager · Lead/Member with Guest write · Event creator |

### Multi-Channel OTP Authentication (Mobile + Email Fallback)

- **Primary**: Mobile OTP via WhatsApp/SMS (6-digit, 10-min validity)
- **Fallback**: Email OTP if mobile not on file OR mobile delivery fails
- **Email OTP**: 6-digit, 10-min validity, sent via platform email
- **Resend OTP**: at most 3 per channel per 15min
- **Verify rate limit**: 5 attempts per OTP; failure invalidates

```sql
CREATE TABLE guest_otps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid REFERENCES events(id) ON DELETE CASCADE,
  guest_id      uuid REFERENCES guests(id) ON DELETE CASCADE,
  channel       text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  recipient     text NOT NULL,                              -- mobile or email
  otp_hash      text NOT NULL,
  attempts      integer DEFAULT 0,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX idx_guest_otps_recipient ON guest_otps (recipient, event_id, expires_at);
CREATE INDEX idx_guest_otps_guest ON guest_otps (guest_id);
```

### Refresh Token Strategy

```sql
CREATE TABLE guest_refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id   uuid REFERENCES guests(id) ON DELETE CASCADE,
  event_id   uuid REFERENCES events(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  family_id  uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_guest_refresh_tokens_hash ON guest_refresh_tokens (token_hash);
CREATE INDEX idx_guest_refresh_tokens_family ON guest_refresh_tokens (family_id) WHERE revoked_at IS NULL;
```

Reuse detection: revoked-token reuse → entire family revoked.

### Sections (Toggleable Per Event)
My Invitation · RSVP Status · Event Details · My Accommodation · Transport · Meal Preference · My QR Code · My Seating · Event Schedule · Photo Gallery · Contact Organiser · Feedback/Survey · Gift Registry · Conference Sessions · **My Plus-Ones** · **Manage My RSVP**

### Plus-One (+1) Flow

Per-event toggle: `events.allow_plus_ones boolean`. If enabled, guest can add up to `events.max_plus_ones_per_guest` (default 1) plus-ones during RSVP.

```sql
CREATE TABLE guest_plus_ones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_guest_id uuid REFERENCES guests(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES events(id) ON DELETE CASCADE,
  name            text,
  dietary_requirement text,
  age_category    text CHECK (age_category IN ('adult','child','infant')),
  rsvp_status     text DEFAULT 'attending' CHECK (rsvp_status IN ('attending','not_attending')),
  check_in_status text DEFAULT 'not_checked_in',
  check_in_at     timestamptz,
  added_at        timestamptz DEFAULT now()
);
CREATE INDEX idx_plus_ones_primary ON guest_plus_ones (primary_guest_id);
CREATE INDEX idx_plus_ones_event ON guest_plus_ones (event_id);

ALTER TABLE events ADD COLUMN allow_plus_ones boolean DEFAULT false;
ALTER TABLE events ADD COLUMN max_plus_ones_per_guest integer DEFAULT 1;
ALTER TABLE events ADD COLUMN plus_one_deadline_at timestamptz;
```

UI: guest sees "Add +1" button if enabled and before deadline. Each +1 counts against `max_guests_per_event` capacity. Tenant sees primary + plus-ones in guest list with relationship.

### "I Changed My Mind" RSVP Flow

Tenant configures per event:
- `events.rsvp_change_deadline_at` — date after which RSVP locked (e.g., 7 days before event)
- Before deadline: guest can change RSVP freely (attending → not_attending → attending → tentative)
- After deadline: guest sees "RSVP change requires organiser approval" — sends request via `rsvp_change_requests`
- After event start: change disabled

```sql
CREATE TABLE rsvp_change_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id        uuid REFERENCES guests(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES events(id) ON DELETE CASCADE,
  old_rsvp_status text,
  new_rsvp_status text,
  reason          text,
  status          text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by     uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  rejection_reason text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_rsvp_changes_event ON rsvp_change_requests (event_id, status);

ALTER TABLE events ADD COLUMN rsvp_change_deadline_at timestamptz;
```

Audit-logged. Notifications to Event Manager + guest at every state change.

### Tenant Customisation
Title · hero image · brand color · welcome message · footer · "Powered by OccasionPro" toggle (white-label)

### Self-Registration
Per-event toggle. Pre-register view shows event name/date/venue. Default `pending_approval` unless `auto_approve_guests = true`.

## 6.3 Badge Printing

PDF sheets: A4-6 · A4-8 · Avery 5395. Fields: Guest Name · Event Name · Category/Table · QR. Tenant customisation: colors, logo, fields. Server-side via `BadgesService.generatePdf(eventId, options)`.

## 6.4 Public Event Website

Pro+ feature (Growth via add-on). URLs: `links.occasionpro.in/e/[event-slug]` or custom domain.

13 section types: Hero · Countdown · About · Schedule · Speakers · Sponsors · FAQ · Register · Map · Gallery · Contact · Text · Divider

Theming: `theme_config` (primary/background/text color, font_family, custom_css). SEO meta + OG tags + Schema.org Event markup.

```sql
CREATE TABLE event_websites (
  event_id     uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  tenant_id    uuid REFERENCES tenants(id) ON DELETE CASCADE,
  is_published boolean DEFAULT false,
  sections     jsonb NOT NULL,
  theme_config jsonb,
  seo_config   jsonb,
  published_at timestamptz,
  deleted_at   timestamptz,
  purge_after  timestamptz,
  updated_at   timestamptz DEFAULT now(),
  CONSTRAINT sections_size_limit CHECK (octet_length(sections::text) < 2097152),
  CONSTRAINT theme_size_limit    CHECK (theme_config IS NULL OR octet_length(theme_config::text) < 262144)
);
CREATE INDEX idx_event_websites_tenant ON event_websites (tenant_id);
```

Custom CSS sanitisation: server-side allowlist parser (no `@import`, `javascript:`, `expression()`) on store + render.

---

# PART 7 — CROSS-TENANT PORTALS (CLIENT, VENDOR, SPEAKER)

> Global accounts spanning tenants. RLS enforces per-event access. Same email can be tenant_members (multiple), client_account (1), vendor_account (1), speaker_account (1) — separate auth tables, separate cookies.

## 7.1 Client Portal

### Schema

```sql
CREATE TABLE client_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  full_name     text,
  phone         text,
  password_hash text NOT NULL,
  mfa_secret    bytea,
  mfa_enabled   boolean DEFAULT false,
  last_login_at timestamptz,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE client_event_access (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_account_id uuid REFERENCES client_accounts(id) ON DELETE CASCADE,
  tenant_id         uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id          uuid REFERENCES events(id) ON DELETE CASCADE,
  permissions       jsonb DEFAULT '{}',
  invited_by        uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  invited_at        timestamptz DEFAULT now(),
  accepted_at       timestamptz,
  revoked_at        timestamptz,
  UNIQUE (client_account_id, event_id)
);
CREATE INDEX idx_client_event_access_client ON client_event_access (client_account_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_client_event_access_event ON client_event_access (event_id);
CREATE INDEX idx_client_event_access_tenant ON client_event_access (tenant_id);
CREATE INDEX idx_client_event_access_invited_by ON client_event_access (invited_by);
```

### Multi-Event View ("My Events")

Client login lands on **My Events** dashboard listing ALL events they have access to across all tenants. Grouped by:
- Tenant (the event company)
- Status (upcoming, completed, archived)
- Date range

UI shows: event card per access row with thumbnail, date, tenant logo, status badge, total budget, RSVP %.

### Client Expense Tracking

```sql
CREATE TABLE client_expense_view (
  -- Materialized view per (client_account_id, event_id)
  client_account_id uuid,
  event_id          uuid,
  total_budgeted    numeric(14,2),
  total_invoiced    numeric(14,2),
  total_paid        numeric(14,2),
  total_outstanding numeric(14,2),
  upcoming_due      numeric(14,2),
  currency_code     varchar(3),
  last_updated      timestamptz,
  PRIMARY KEY (client_account_id, event_id)
);
```

Refreshed on `payments` and `invoices` updates. Client dashboard shows:
- Budget vs. actual chart
- Payment timeline
- Outstanding invoices
- Upcoming dues
- Per-category breakdown (venue, F&B, vendors, etc.)
- Export to PDF / Excel

### Inline E-Signature (Pro+)

```sql
CREATE TABLE client_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id            uuid REFERENCES events(id) ON DELETE CASCADE,
  client_account_id   uuid REFERENCES client_accounts(id) ON DELETE SET NULL,
  document_type       text CHECK (document_type IN ('contract','invoice','quote','agreement','consent_form','release')),
  document_name       text NOT NULL,
  r2_key              text NOT NULL,
  signature_provider  text CHECK (signature_provider IN ('docusign','signwell','internal')),
  signature_envelope_id text,                            -- gateway envelope ID
  signature_status    text DEFAULT 'draft' CHECK (signature_status IN ('draft','sent','viewed','signed','declined','expired','voided')),
  sent_at             timestamptz,
  signed_at           timestamptz,
  declined_reason     text,
  signature_audit_trail jsonb,                           -- e-signature provider's audit cert
  created_by          uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX idx_client_docs_client ON client_documents (client_account_id);
CREATE INDEX idx_client_docs_event ON client_documents (event_id);
CREATE INDEX idx_client_docs_status ON client_documents (signature_status);
```

Workflow:
1. Event Manager uploads contract → assigns to client
2. Platform calls DocuSign/Signwell API → creates envelope
3. Client receives email; signs inline in client portal (iframe + redirect)
4. On signed: webhook updates `signature_status`; signed PDF stored back in R2; tenant notified; client receives copy
5. Audit trail JSON includes IP, timestamps, geolocation, signing cert — legally admissible

### Realtime Updates (per Part 13)
Event progress · Budget approvals · Document uploads · Payment status · RSVP live count · Messages · Expense tracker

## 7.2 Vendor Portal

### Schema

```sql
CREATE TABLE vendor_accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  text UNIQUE NOT NULL,
  company_name           text,
  contact_name           text,
  phone                  text,
  password_hash          text NOT NULL,
  mfa_secret             bytea,
  mfa_enabled            boolean DEFAULT false,
  bank_account_encrypted bytea,
  last_login_at          timestamptz,
  created_at             timestamptz DEFAULT now()
);

CREATE TABLE vendor_event_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_account_id   uuid REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  tenant_id           uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id            uuid REFERENCES events(id) ON DELETE CASCADE,
  service_category    text NOT NULL,
  status              text DEFAULT 'invited' CHECK (status IN ('invited','accepted','declined','completed','cancelled')),
  contract_value      numeric(14,2),
  currency_code       varchar(3),
  assigned_by         uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  assigned_at         timestamptz DEFAULT now(),
  responded_at        timestamptz,
  declined_reason     text,
  performance_rating  numeric(2,1) CHECK (performance_rating >= 1.0 AND performance_rating <= 5.0),
  deleted_at          timestamptz,
  purge_after         timestamptz,
  UNIQUE (vendor_account_id, event_id, service_category)
);
CREATE INDEX idx_vendor_assignments_vendor ON vendor_event_assignments (vendor_account_id);
CREATE INDEX idx_vendor_assignments_event ON vendor_event_assignments (event_id);
```

### Vendor Calendar Sync

```sql
CREATE TABLE vendor_external_calendars (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_account_id   uuid REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  provider            text NOT NULL CHECK (provider IN ('google_calendar','outlook','apple_calendar','ical_url')),
  access_token_encrypted bytea,
  refresh_token_encrypted bytea,
  ical_url            text,                                  -- for read-only iCal subscriptions
  calendar_id         text,
  display_name        text,
  is_primary          boolean DEFAULT false,
  status              text DEFAULT 'active' CHECK (status IN ('active','expired','disconnected')),
  last_synced_at      timestamptz,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX idx_vendor_calendars_vendor ON vendor_external_calendars (vendor_account_id) WHERE status = 'active';

CREATE TABLE vendor_calendar_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_calendar_id  uuid REFERENCES vendor_external_calendars(id) ON DELETE CASCADE,
  external_event_id   text NOT NULL,
  title               text,
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  busy                boolean DEFAULT true,
  synced_at           timestamptz DEFAULT now(),
  UNIQUE (vendor_calendar_id, external_event_id)
);
CREATE INDEX idx_vendor_cal_events_time ON vendor_calendar_events (vendor_calendar_id, starts_at, ends_at);
```

`VendorCalendarSyncWorker` runs hourly: pulls external calendars via OAuth, populates `vendor_calendar_events`. Vendor dashboard shows unified calendar: OccasionPro assignments + their other commitments. **Conflict warnings** when a tenant tries to assign a vendor for a date they're already booked.

### Vendor Crew Management

```sql
CREATE TABLE vendor_crew_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_account_id   uuid REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  full_name           text NOT NULL,
  role                text,                                   -- 'head_chef','server','photographer','assistant'
  phone               text,
  email               text,
  status              text DEFAULT 'active' CHECK (status IN ('active','inactive')),
  added_at            timestamptz DEFAULT now()
);
CREATE INDEX idx_vendor_crew ON vendor_crew_members (vendor_account_id);

CREATE TABLE vendor_crew_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_assignment_id uuid REFERENCES vendor_event_assignments(id) ON DELETE CASCADE,
  crew_member_id      uuid REFERENCES vendor_crew_members(id) ON DELETE CASCADE,
  role_on_event       text,
  shift_start         timestamptz,
  shift_end           timestamptz,
  notes               text,
  UNIQUE (vendor_assignment_id, crew_member_id)
);
CREATE INDEX idx_vendor_crew_assign_event ON vendor_crew_assignments (vendor_assignment_id);
```

Vendor portal section: "Crew" — add crew, assign to events, manage shifts. Tenant sees crew roster on event detail (read-only).

### Vendor's Own Invoice Template

Vendor can upload their custom invoice template (PDF or HTML) used when generating invoices to the tenant.

```sql
CREATE TABLE vendor_invoice_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_account_id uuid REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  name              text NOT NULL,
  template_type     text CHECK (template_type IN ('html','pdf_overlay','docx')),
  template_file_r2_key text,
  template_html     text,                                   -- if HTML
  default_logo_url  text,
  default_terms     text,
  is_default        boolean DEFAULT false,
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX idx_vendor_templates ON vendor_invoice_templates (vendor_account_id);
```

When vendor generates an invoice via Vendor Portal, system uses their template (or platform default). PDF rendered server-side, attached to invoice record.

### Vendor Portfolio

Vendors maintain a public-style profile shown to tenants during vendor selection.

```sql
CREATE TABLE vendor_portfolios (
  vendor_account_id   uuid PRIMARY KEY REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  about_text          text,
  service_categories  text[],
  service_regions     text[],
  starting_price      numeric(14,2),
  starting_currency   varchar(3),
  years_in_business   integer,
  total_events_served integer DEFAULT 0,
  avg_performance_rating numeric(3,2),
  total_ratings_count integer DEFAULT 0,
  cover_image_url     text,
  gallery_image_urls  text[],                                -- up to 20
  social_links        jsonb,
  awards              jsonb,
  certifications      jsonb,
  visibility          text DEFAULT 'private' CHECK (visibility IN ('private','tenants_only','public')),
  updated_at          timestamptz DEFAULT now()
);

CREATE TABLE vendor_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_account_id   uuid REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  reviewer_tenant_id  uuid REFERENCES tenants(id) ON DELETE SET NULL,
  event_id            uuid REFERENCES events(id) ON DELETE SET NULL,
  rating              numeric(2,1) CHECK (rating >= 1.0 AND rating <= 5.0),
  review_text         text,
  reviewer_name       text,                                  -- denormalized at write
  is_verified         boolean DEFAULT true,                  -- always true for in-platform reviews
  is_published        boolean DEFAULT true,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX idx_vendor_reviews ON vendor_reviews (vendor_account_id, created_at DESC);
```

Tenants browsing vendors see: portfolio + verified reviews from other tenants + performance rating. Vendor performance score is aggregate of all `vendor_event_assignments.performance_rating`.

### Bank Details (Encrypted)

Encrypted JSON via pgcrypto with key in Vault. Visible only to vendor on re-auth (5-min token TTL). Tenants see payout status only.

### Vendor Portal Sections
Dashboard · Assignments · Calendar · Crew · Messages · Payments · Performance · Portfolio · Profile · Invoice Templates

## 7.3 Speaker Portal

```sql
CREATE TABLE speaker_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  full_name     text,
  password_hash text,                                       -- nullable; magic-link default
  bio           text,
  photo_url     text,
  socials       jsonb,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE speaker_event_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  speaker_account_id uuid REFERENCES speaker_accounts(id) ON DELETE CASCADE,
  tenant_id          uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id           uuid REFERENCES events(id) ON DELETE CASCADE,
  session_id         uuid REFERENCES sessions(id) ON DELETE CASCADE,
  status             text DEFAULT 'invited',
  invited_at         timestamptz DEFAULT now(),
  confirmed_at       timestamptz,
  UNIQUE (speaker_account_id, session_id)
);
```

Magic link 15-min → 30-day session on click. Speakers may set password later.

---

# PART 8 — OPERATIONS MODULES

## 8.1 Floor Plan

```sql
CREATE TABLE floor_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id     uuid REFERENCES events(id) ON DELETE CASCADE,
  name         text NOT NULL,
  canvas       jsonb NOT NULL,
  is_published boolean DEFAULT false,
  published_at timestamptz,
  published_by uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  deleted_at   timestamptz,
  purge_after  timestamptz,
  updated_at   timestamptz DEFAULT now(),
  created_at   timestamptz DEFAULT now(),
  CONSTRAINT canvas_size_limit CHECK (octet_length(canvas::text) < 5242880)
);
CREATE INDEX idx_floor_plans_event ON floor_plans (event_id);
CREATE INDEX idx_floor_plans_tenant ON floor_plans (tenant_id);

CREATE TABLE floor_plan_tables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_plan_id uuid REFERENCES floor_plans(id) ON DELETE CASCADE,
  table_number  text NOT NULL,
  table_shape   text CHECK (table_shape IN ('round','rectangular','cocktail','banquet_row')),
  seat_count    integer NOT NULL,
  position_x    numeric(10,2),
  position_y    numeric(10,2),
  rotation_deg  numeric(5,2) DEFAULT 0,
  zone          text,
  UNIQUE (floor_plan_id, table_number)
);

CREATE TABLE floor_plan_table_guests (
  table_id    uuid REFERENCES floor_plan_tables(id) ON DELETE CASCADE,
  guest_id    uuid REFERENCES guests(id) ON DELETE CASCADE,
  seat_number integer,
  assigned_by uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  assigned_at timestamptz DEFAULT now(),
  PRIMARY KEY (table_id, guest_id)
);
CREATE INDEX idx_fp_table_guests_guest ON floor_plan_table_guests (guest_id);
```

Konva.js infinite canvas · 3 layers · grid snap · auto-suggest seating by event type · publish state.

## 8.2 Runsheet (Real-Time Collaborative)

```sql
CREATE TABLE runsheet_tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id         uuid REFERENCES events(id) ON DELETE CASCADE,
  parent_task_id   uuid REFERENCES runsheet_tasks(id) ON DELETE SET NULL,
  depends_on_id    uuid REFERENCES runsheet_tasks(id) ON DELETE SET NULL,
  title            text NOT NULL,
  description      text,
  scheduled_start  timestamptz,
  scheduled_end    timestamptz,
  actual_start     timestamptz,
  actual_end       timestamptz,
  assigned_to      uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  subteam_id       uuid REFERENCES event_subteams(id) ON DELETE SET NULL,
  status           text DEFAULT 'pending' CHECK (status IN ('pending','blocked','in_progress','completed','cancelled')),
  priority         text DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  sort_order       integer DEFAULT 0,
  deleted_at       timestamptz,
  purge_after      timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  CONSTRAINT no_self_dependency CHECK (id <> depends_on_id),
  CONSTRAINT no_self_parent CHECK (id <> parent_task_id)
);
CREATE INDEX idx_runsheet_tasks_event_time ON runsheet_tasks (event_id, scheduled_start);
CREATE INDEX idx_runsheet_tasks_assignee ON runsheet_tasks (assigned_to) WHERE status NOT IN ('completed','cancelled');
CREATE INDEX idx_runsheet_tasks_parent ON runsheet_tasks (parent_task_id);
CREATE INDEX idx_runsheet_tasks_depends ON runsheet_tasks (depends_on_id);

-- Cycle prevention
CREATE OR REPLACE FUNCTION prevent_runsheet_task_cycle() RETURNS trigger AS $$
BEGIN
  IF NEW.depends_on_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    WITH RECURSIVE chain AS (
      SELECT id, depends_on_id FROM runsheet_tasks WHERE id = NEW.depends_on_id
      UNION ALL
      SELECT t.id, t.depends_on_id FROM runsheet_tasks t JOIN chain c ON t.id = c.depends_on_id
    ) SELECT 1 FROM chain WHERE id = NEW.id
  ) THEN RAISE EXCEPTION 'Dependency cycle detected'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_runsheet_task_cycle_check
  BEFORE INSERT OR UPDATE OF depends_on_id ON runsheet_tasks
  FOR EACH ROW EXECUTE FUNCTION prevent_runsheet_task_cycle();

CREATE TABLE runsheet_locks (
  event_id  uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  locked_by uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  locked_at timestamptz DEFAULT now()
);

CREATE TABLE runsheet_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid REFERENCES events(id) ON DELETE CASCADE,
  is_full         boolean DEFAULT false,
  snapshot        jsonb,
  diff            jsonb,
  base_version_id uuid REFERENCES runsheet_versions(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT full_or_diff CHECK (
    (is_full AND snapshot IS NOT NULL AND diff IS NULL)
    OR (NOT is_full AND diff IS NOT NULL AND base_version_id IS NOT NULL)
  )
);
CREATE INDEX idx_runsheet_versions_event_time ON runsheet_versions (event_id, created_at DESC);
```

## 8.3 F&B Module — 15 Serving Styles

(Sit-Down / Plated, Buffet, Live Cooking, Cocktail/Finger Food, High Tea, Family Style, Food Stalls, Thali, Token/Coupon, Bar/Beverage, Midnight Snack, Welcome Drinks, Cake/Dessert, Kids Menu, Special Dietary)

Portion units standardised: grams for solid, ml for liquid, pieces for items.

Smart F&B Engine: auto-quantity formulas, coverage checks, allergen cross-check, budget per head, vendor capacity, token reconciliation (24hr sync window, fraud vs wastage detection).

## 8.4 Equipment & Inventory Module (NEW)

For tenants managing physical inventory: tables, chairs, decor, AV gear, lighting, kitchen equipment.

```sql
CREATE TABLE inventory_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid REFERENCES tenants(id) ON DELETE CASCADE,
  name              text NOT NULL,
  category          text,                                  -- 'tables','chairs','decor','av','lighting','kitchen'
  sku               text,
  description       text,
  unit_cost         numeric(10,2),
  unit_replacement_cost numeric(10,2),
  quantity_total    integer NOT NULL DEFAULT 0,
  quantity_in_stock integer NOT NULL DEFAULT 0,
  quantity_in_use   integer NOT NULL DEFAULT 0,
  quantity_damaged  integer NOT NULL DEFAULT 0,
  storage_location  text,
  image_url         text,
  status            text DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at        timestamptz DEFAULT now(),
  CHECK (quantity_in_stock + quantity_in_use + quantity_damaged <= quantity_total)
);
CREATE INDEX idx_inventory_tenant ON inventory_items (tenant_id, status);
CREATE INDEX idx_inventory_category ON inventory_items (tenant_id, category);

CREATE TABLE inventory_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES events(id) ON DELETE CASCADE,
  quantity        integer NOT NULL CHECK (quantity > 0),
  status          text DEFAULT 'allocated' CHECK (status IN ('allocated','dispatched','returned','damaged','lost')),
  allocated_at    timestamptz DEFAULT now(),
  dispatched_at   timestamptz,
  returned_at     timestamptz,
  damage_notes    text,
  damage_cost     numeric(10,2),
  allocated_by    uuid REFERENCES tenant_members(id) ON DELETE SET NULL
);
CREATE INDEX idx_inv_alloc_item ON inventory_allocations (inventory_item_id);
CREATE INDEX idx_inv_alloc_event ON inventory_allocations (event_id);

CREATE TABLE inventory_audits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  audited_at      timestamptz DEFAULT now(),
  audited_by      uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  snapshot        jsonb,                                   -- counts per item
  discrepancies   jsonb
);
```

Allocations auto-update `quantity_in_use` and `quantity_in_stock`. Damage tracking feeds replacement budget. Quarterly inventory audit via UI.

## 8.5 Crew & Staffing Module (NEW)

For tenants with field staff, freelance crew, or per-event hires (separate from `tenant_members`).

```sql
CREATE TABLE crew_pool (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  full_name       text NOT NULL,
  phone           text,
  email           text,
  role            text,                                    -- 'supervisor','runner','greeter','technical','security'
  hourly_rate     numeric(10,2),
  daily_rate      numeric(10,2),
  currency_code   varchar(3),
  skills          text[],
  languages       text[],
  is_freelance    boolean DEFAULT true,
  is_active       boolean DEFAULT true,
  notes           text,
  rating          numeric(2,1) CHECK (rating >= 1.0 AND rating <= 5.0),
  total_events_worked integer DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_crew_pool_tenant ON crew_pool (tenant_id) WHERE is_active = true;

CREATE TABLE event_crew_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES events(id) ON DELETE CASCADE,
  crew_id         uuid REFERENCES crew_pool(id) ON DELETE CASCADE,
  role_on_event   text,
  shift_start     timestamptz NOT NULL,
  shift_end       timestamptz NOT NULL,
  hourly_rate_override numeric(10,2),
  hours_worked    numeric(5,2),
  status          text DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','checked_in','checked_out','no_show','cancelled')),
  total_payable   numeric(14,2),
  paid_at         timestamptz,
  payment_method  text,
  notes           text,
  assigned_by     uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_crew_assign_event ON event_crew_assignments (event_id);
CREATE INDEX idx_crew_assign_crew ON event_crew_assignments (crew_id);
CREATE INDEX idx_crew_assign_shift ON event_crew_assignments (shift_start, shift_end);
```

Conflict detection: when assigning crew to overlapping shifts, system warns.
Payment integration: crew payouts go through `vendor_payouts` flow (Razorpay X).

## 8.6 Tenant Shared Inbox (NEW)

Triages support emails from clients to the tenant team.

```sql
CREATE TABLE shared_inbox_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES events(id) ON DELETE SET NULL,
  inbox_email     text NOT NULL,                           -- 'support@[tenant-domain]' or per-event inbox
  from_email      text NOT NULL,
  from_name       text,
  subject         text,
  body_html       text,
  body_text       text,
  message_id      text,                                    -- email Message-ID header
  in_reply_to     text,                                    -- threading
  attachments     jsonb,                                   -- R2 keys
  status          text DEFAULT 'unread' CHECK (status IN ('unread','read','assigned','replied','closed','spam')),
  assigned_to     uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  assigned_at     timestamptz,
  labels          text[],
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_shared_inbox_tenant ON shared_inbox_messages (tenant_id, status);
CREATE INDEX idx_shared_inbox_assigned ON shared_inbox_messages (assigned_to) WHERE status NOT IN ('closed','spam');
CREATE INDEX idx_shared_inbox_thread ON shared_inbox_messages (in_reply_to);
```

Inbound email parsed via dedicated subdomain (`support@[tenant_slug].notify.occasionpro.in` or tenant verified domain). Replies thread to original message and outgo via tenant's branded email sender.

## 8.7 Vendor Approval Workflow (NEW)

When a vendor submits a quote, tenant approves before showing to client.

```sql
CREATE TABLE vendor_quotes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_assignment_id uuid REFERENCES vendor_event_assignments(id) ON DELETE CASCADE,
  amount              numeric(14,2) NOT NULL,
  currency_code       varchar(3),
  line_items          jsonb,
  notes               text,
  document_url        text,
  status              text DEFAULT 'submitted' CHECK (status IN ('draft','submitted','tenant_approved','tenant_rejected','client_approved','client_rejected','expired','superseded')),
  submitted_at        timestamptz,
  tenant_reviewed_at  timestamptz,
  tenant_reviewed_by  uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  tenant_review_notes text,
  shared_with_client_at timestamptz,
  client_responded_at timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX idx_vendor_quotes_assignment ON vendor_quotes (vendor_assignment_id);
CREATE INDEX idx_vendor_quotes_status ON vendor_quotes (status, created_at);
```

Flow:
1. Vendor submits quote → status='submitted'
2. Event Manager reviews → approves/rejects with notes
3. On approval: optionally share with client via client portal (status='client_approved' on acceptance)
4. Approved quote becomes the basis for `vendor_event_assignments.contract_value`

---

# PART 9 — CONFERENCE MODULE

Activated for `event_type = 'Conference'`. Growth+ plan.

```sql
CREATE TABLE sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES events(id) ON DELETE CASCADE,
  track           text,
  session_type    text CHECK (session_type IN ('keynote','panel','workshop','breakout','networking','exhibition')),
  title           text NOT NULL,
  description     text,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  room            text,
  is_cpd_eligible boolean DEFAULT false,
  cpd_credits     numeric(4,2),
  is_published    boolean DEFAULT false,
  streaming_url   text,
  deleted_at      timestamptz,
  purge_after     timestamptz,
  created_at      timestamptz DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX idx_sessions_event_time ON sessions (event_id, starts_at);

CREATE TABLE event_tickets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id            uuid REFERENCES events(id) ON DELETE CASCADE,
  ticket_type         text NOT NULL,
  name                text NOT NULL,
  description         text,
  price               numeric(10,2) NOT NULL DEFAULT 0,
  currency_code       varchar(3) NOT NULL,
  quantity_total      integer,
  quantity_sold       integer DEFAULT 0,
  sale_starts_at      timestamptz,
  sale_ends_at        timestamptz,
  late_fee            numeric(10,2),
  late_window_ends_at timestamptz,
  deleted_at          timestamptz,
  purge_after         timestamptz,
  created_at          timestamptz DEFAULT now(),
  CHECK (quantity_total IS NULL OR quantity_sold <= quantity_total),
  CHECK (price >= 0),
  CHECK (late_fee IS NULL OR late_fee >= 0)
);
CREATE INDEX idx_event_tickets_event ON event_tickets (event_id);
```

Atomic ticket purchase via conditional UPDATE. Late fee window logic.

Sub-modules: 9.1 Registration & Ticketing · 9.2 Speaker Management (magic-link auth) · 9.3 Session & Agenda · 9.4 Sponsor Management · 9.5 Exhibition & Booth · 9.6 Networking · 9.7 Live Session (Q&A, polling, feedback) · 9.8 CPD/CEU Credits · 9.9 Conference Exports

---

# PART 10 — POST-EVENT MODULE

Triggers when `events.status = 'completed'`. 11 sub-modules:

10.1 Wrap-Up Checklist · 10.2 Final Headcount Reconciliation · 10.3 Final Budget Reconciliation · 10.4 Vendor Settlement · 10.5 Guest Thank-You · 10.6 Feedback & Survey Results · 10.7 Post-Event Report (Branded PDF) · 10.8 Client Final Report & Invoice · 10.9 Testimonial & Review Request · 10.10 Event Archiving · 10.11 Smart Post-Event Alerts (day +1/+3/+2/+7)

---

# PART 11 — MOBILE APP & PWA

## 11.1 Strategy
- **React Native + Expo** for staff (Android Phase 1 → iOS Phase 2)
- **PWA** for tablet/door check-in stations

## 11.2–11.5 (Android Phase 1, iOS Phase 2, PWA Check-in Station, Mobile-First Modules)
- Modules: task manager, runsheet, check-in QR scanner, notifications, offline sync (Zustand + AsyncStorage)
- PWA: Dexie.js IndexedDB, ZXing QR scanner, sync queue with LWW, service worker
- Mobile-first: check-in scanner · runsheet live · guest management · quick notifications

---

# PART 12 — DATA EXPORTS

All exports use tenant logo, company name, brand color. Excel/PDF/CSV. Bulk export >1000 records triggers Super Admin alert.

| Module | Formats |
|--------|---------|
| Guests | Excel |
| Budget | Excel + PDF |
| Vendors | Excel |
| Runsheet | PDF + Excel |
| F&B | Excel |
| Accommodation | Excel |
| Check-in | Excel |
| Finance / Invoices | PDF (GST-compliant) + Excel |
| Gifts | Excel |
| Communication logs | Excel |
| Surveys | Excel + PDF |
| Post-event report | PDF |
| Inventory | Excel |
| Crew | Excel |
| Full event | ZIP of all |

---

# PART 13 — REAL-TIME ARCHITECTURE

## 13.1 Core Engine
Supabase Realtime (postgres_changes + presence + broadcast). <500ms p95.

## 13.2 RLS Interaction
Supabase Realtime respects RLS. Never client-side filter for security.

## 13.3 Cross-Module Data Flow Map

| Trigger | Effect |
|---------|--------|
| Guest checks in | Dashboard counter · F&B tokens decrement · Floor plan seated · Check-in task progresses |
| Guest RSVP | Health score · Headcount prediction · F&B recalc · Comm log |
| Guest +1 added | Headcount adjusted · F&B recalc · Floor plan seat needed |
| Vendor confirmed | Timeline task auto-completes · Budget committed |
| Vendor declines | Notify Event Manager + reassignment prompt |
| Vendor quote submitted | Notify Event Manager for approval |
| Vendor quote approved by tenant | Optionally notify Client |
| Vendor invoice paid | Budget actuals · Finance · Vendor portal "Paid" |
| Vendor payout disbursed | Vendor portal balance · Finance reconciliation |
| Budget category overspent | Real-time alert to Event Manager |
| F&B quantities change | Budget F&B line item |
| Task completed in runsheet | Dependent tasks unlock · Mobile push to assignee |
| Floor plan published | Guest portal "My Seating" enabled per guest |
| Room assigned | Guest profile · Voucher generated · Short link created |
| Speaker uploads presentation | Notify session chair |
| Payment received (client) | Client portal balance · Expense tracker |
| Custom domain DNS verified | Tenant notification + Super Admin approval queue |
| Trial 7/3 days from expiry | Tenant email + dashboard banner |
| Trial expired | All sessions paywall · Email/SMS paused |
| Storage 80% / 100% | Smart cleanup suggester · Hard block uploads |
| Tenant suspended by Super Admin | All sessions revoked · Read-only · Owner email |
| New tenant signup | Super Admin dashboard realtime |
| Add-on purchased | Quota recomputed · Banner clears · Receipt emailed |
| Cloud offload completed | Storage freed · Event marked offloaded · Owner notified |
| Inventory allocated | Stock decremented · Conflict alert if over-allocated |
| Crew shift conflict | Realtime warning on assignment |
| Comment @mention | Push notification to mentioned user |
| Event field locked by editor | Other editors see lock indicator |
| Chargeback received | Finance role alert · Owner email · Tenant frozen pending review |
| Dunning email sent | In-app banner · Owner email · Sales role alert at Day 9 |
| Tenant-to-tenant transfer accepted | Both Owners notified |
| Data export ready | Owner email with R2 link |
| Vendor calendar conflict detected | Tenant warning during assignment |
| Subscription paused/resumed | Owner email + banner |

## 13.4 Implementation Pattern

```typescript
const channel = supabase
  .channel(`${moduleName}-${eventId}`)
  .on('postgres_changes',
    { event: '*', schema: 'public', table: 'guests', filter: `event_id=eq.${eventId}` },
    (payload) => queryClient.invalidateQueries(['guests', eventId])
  )
  .subscribe()
```

## 13.5 Key PostgreSQL Triggers

```sql
CREATE TRIGGER on_guest_checkin
  AFTER UPDATE ON guests
  FOR EACH ROW
  WHEN (NEW.check_in_status = 'checked_in' AND OLD.check_in_status IS DISTINCT FROM NEW.check_in_status)
  EXECUTE FUNCTION handle_guest_checkin();

CREATE TRIGGER on_payment_made
  AFTER INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_budget_actuals();

CREATE TRIGGER on_rsvp_update
  AFTER UPDATE ON guests
  FOR EACH ROW
  WHEN (OLD.rsvp_status IS DISTINCT FROM NEW.rsvp_status)
  EXECUTE FUNCTION recalculate_event_health();

CREATE TRIGGER on_task_complete
  AFTER UPDATE ON runsheet_tasks
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION unlock_dependent_tasks();

CREATE TRIGGER on_storage_addon_change
  AFTER INSERT OR UPDATE OR DELETE ON tenant_storage_addons
  FOR EACH ROW EXECUTE FUNCTION recompute_storage_quota();

CREATE TRIGGER on_event_status_change
  AFTER UPDATE ON events
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION refresh_active_event_count();

CREATE TRIGGER on_inventory_allocation
  AFTER INSERT OR UPDATE OR DELETE ON inventory_allocations
  FOR EACH ROW EXECUTE FUNCTION update_inventory_counts();
```

## 13.6 Activity Feed (NEW — Per Event)

```sql
CREATE TABLE event_activity_feed (
  id              bigserial PRIMARY KEY,
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES events(id) ON DELETE CASCADE,
  actor_id        uuid,
  actor_type      text NOT NULL CHECK (actor_type IN ('tenant_member','client','vendor','guest','speaker','system','super_admin')),
  actor_name_cached text,
  activity_type   text NOT NULL,                          -- 'event_created','guest_added','rsvp_changed','vendor_assigned','task_completed','file_uploaded','comment_added','quote_submitted','payment_received', ...
  entity_type     text,
  entity_id       uuid,
  description     text NOT NULL,                          -- human-readable
  data            jsonb,
  is_internal     boolean DEFAULT false,                  -- true = not visible to client/vendor/guest portals
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_activity_event_time ON event_activity_feed (event_id, created_at DESC);
CREATE INDEX idx_activity_actor ON event_activity_feed (actor_type, actor_id);
```

Populated by triggers on every state-changing operation. Rendered as chronological feed on event detail page. Filterable by actor type, activity type. Each entry shows: who · what · when · with optional "view details" diff.

## 13.7 Diff Viewer (NEW)

Stored on `event_activity_feed.data` as `{ before: {}, after: {} }`. UI renders side-by-side with field highlighting. Available for: event detail edits, vendor assignments, runsheet tasks, floor plan changes.

## 13.8 @Mentions in Comments (NEW)

```sql
CREATE TABLE comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES events(id) ON DELETE CASCADE,
  entity_type     text NOT NULL,                          -- 'event','runsheet_task','vendor_assignment','floor_plan','guest', etc.
  entity_id       uuid NOT NULL,
  author_id       uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  parent_comment_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  body            text NOT NULL,
  mentions        uuid[],                                 -- tenant_member IDs mentioned
  attachments     jsonb,
  is_internal     boolean DEFAULT true,                   -- true = not visible to client/vendor/guest portals
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_comments_entity ON comments (entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_mentions ON comments USING gin (mentions);
CREATE INDEX idx_comments_unresolved ON comments (event_id) WHERE resolved_at IS NULL AND deleted_at IS NULL;
```

@mention parsing on POST: extract `@john.doe` → resolve to `tenant_members.id` → push to `mentions[]` → fire notification (in-app + email + push) to mentioned user.

## 13.9 Presence on Every Event Detail (NEW)

Beyond runsheet, every event detail page now shows live presence (who's viewing) via Supabase Realtime presence. Avatars stack in top-right with "John, Sarah, +2 others viewing". Hovering shows last activity ("editing venue field", "viewing").

## 13.10 Concurrent Edit Soft Locking
See Part 4.6 — `event_edit_sessions` with field-level locks and conflict resolution modal.

## 13.11 Lead/Member "My Assigned Tasks" Filter (NEW)

Materialized view per user:

```sql
CREATE VIEW my_assigned_tasks AS
SELECT
  rt.id, rt.event_id, rt.title, rt.scheduled_start, rt.scheduled_end, rt.status, rt.priority,
  e.name AS event_name, e.start_date AS event_start_date,
  rt.assigned_to AS user_id
FROM runsheet_tasks rt
JOIN events e ON e.id = rt.event_id
WHERE rt.deleted_at IS NULL
  AND rt.status IN ('pending','blocked','in_progress')
ORDER BY rt.scheduled_start ASC NULLS LAST;
```

Lead/Member dashboard shows "My Tasks" widget: tasks due today, this week, blocked. Also surfaces as a top-nav badge.

## 13.12 Personal Calendar (NEW — Lead/Member)

```sql
CREATE TABLE personal_calendar_events (
  -- Virtual; constructed from runsheet_tasks + crew_assignments + event_subteam_members + event dates
  -- Plus tenant_members can sync their Google/Outlook calendars (bidirectional)
);

CREATE TABLE tenant_member_external_calendars (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id                uuid REFERENCES tenant_members(id) ON DELETE CASCADE,
  provider                 text NOT NULL CHECK (provider IN ('google_calendar','outlook','apple_calendar')),
  access_token_encrypted   bytea NOT NULL,
  refresh_token_encrypted  bytea,
  token_expires_at         timestamptz,
  calendar_id              text,
  sync_direction           text DEFAULT 'two_way' CHECK (sync_direction IN ('read_only','two_way')),
  status                   text DEFAULT 'active' CHECK (status IN ('active','expired','disconnected')),
  last_synced_at           timestamptz,
  created_at               timestamptz DEFAULT now()
);
CREATE INDEX idx_member_calendars ON tenant_member_external_calendars (member_id) WHERE status = 'active';
```

Lead/Member dashboard "My Calendar" tab shows:
- Events they're assigned to (via subteams)
- Tasks scheduled (runsheet_tasks where assigned_to = self)
- Crew shifts (event_crew_assignments where crew matches member email)
- External calendar overlay (Google/Outlook) — toggleable

Push to external calendar (bidirectional): when assigned to a task, an event auto-created in their Google Calendar.

## 13.13 Presence System
Supabase Broadcast for cursors, typing, "X is editing". Soft locks via `event_edit_sessions`.

## 13.14 No-Stale-Data Policy
Active events: data ≤5s. Optimistic updates with revert. Mobile/PWA sync on reconnect with LWW per field.

## 13.15 Client Portal Realtime
Event progress · Budget approvals · Document uploads · Payment status · RSVP count · Messages · Expense tracker

## 13.16 Vendor Portal Realtime
Task assignments · Payment status · Messages · Document requests · Calendar conflicts

---

# PART 14 — NOTIFICATIONS SYSTEM

## 14.1 Unified Architecture

```sql
CREATE TABLE notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid REFERENCES tenants(id) ON DELETE CASCADE,
  recipient_type text NOT NULL CHECK (recipient_type IN ('tenant_member','client','vendor','guest','speaker','super_admin')),
  recipient_id   uuid NOT NULL,
  category       text NOT NULL,
  priority       text DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  title          text NOT NULL,
  body           text NOT NULL,
  action_url     text,
  data           jsonb,
  is_read        boolean DEFAULT false,
  read_at        timestamptz,
  expires_at     timestamptz DEFAULT (NOW() + INTERVAL '30 days'),
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX idx_notifications_recipient ON notifications (recipient_type, recipient_id, is_read);
CREATE INDEX idx_notifications_tenant_priority ON notifications (tenant_id, priority) WHERE is_read = false;

CREATE TABLE notification_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid REFERENCES notifications(id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('in_app','email','push','sms','whatsapp','slack','teams')),
  status          text DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','bounced')),
  attempted_at    timestamptz,
  delivered_at    timestamptz,
  error_message   text
);
CREATE INDEX idx_notification_deliveries_notification ON notification_deliveries (notification_id);
CREATE INDEX idx_notification_deliveries_status ON notification_deliveries (status) WHERE status = 'queued';

CREATE TABLE notification_preferences (
  user_id           uuid NOT NULL,
  user_type         text NOT NULL CHECK (user_type IN ('tenant_member','client','vendor','guest')),
  category          text NOT NULL,
  in_app_enabled    boolean DEFAULT true,
  email_enabled     boolean DEFAULT true,
  push_enabled      boolean DEFAULT true,
  sms_enabled       boolean DEFAULT false,
  whatsapp_enabled  boolean DEFAULT false,
  slack_enabled     boolean DEFAULT false,
  teams_enabled     boolean DEFAULT false,
  quiet_hours_start time,
  quiet_hours_end   time,
  PRIMARY KEY (user_id, user_type, category)
);
```

Polymorphic FK integrity via app-layer `PolymorphicFKValidator`. `OrphanCleanupWorker` on parent-delete.

## 14.2 Channel Logic

| Channel | Tech |
|---------|------|
| In-app | Supabase Realtime push to bell icon |
| Email | IEmailProvider |
| Push | Expo Push + Web Push (PWA) |
| SMS | ISMSProvider |
| WhatsApp | Approved templates |
| Slack | Webhook to tenant's Slack channel |
| MS Teams | Webhook to tenant's Teams channel |

Dispatch rules:
- Critical: ignores quiet hours, all enabled channels
- High: respects quiet hours; in-app immediate; email/push within 5min
- Normal: in-app immediate; email batched hourly
- Low: in-app only; weekly digest

## 14.3 Dashboard Banner
Top-3 active critical/high notifications. Auto-dismiss on read or expiry.

---

# PART 15 — WEBHOOKS

## 15.1 Incoming Webhooks

| Source | Events |
|--------|--------|
| Razorpay | payment.captured, payment.failed, refund.processed, subscription.*, payment.dispute.* |
| Stripe | payment_intent.succeeded, charge.refunded, invoice.payment_failed, customer.subscription.*, charge.dispute.* |
| Cashfree | ORDER_PAID, ORDER_FAILED |
| WhatsApp Business API | message status, template approval |
| Resend | email.sent, email.delivered, email.bounced, email.complained |
| Meta (DMARC) | aggregate reports |
| DocuSign / Signwell | envelope.completed, envelope.declined, envelope.voided |
| Google Calendar | event.created, event.updated, event.deleted (via push channel) |
| Outlook | calendar event changes (via subscription) |

Security: HMAC-SHA256 + `X-Timestamp` (reject if >5min old) + idempotency via external `event_id` for 24hr cache.

```sql
CREATE TABLE incoming_webhook_log (
  id              bigserial PRIMARY KEY,
  source          text NOT NULL,
  external_id     text,
  payload         jsonb NOT NULL,
  signature_valid boolean,
  processed_at    timestamptz,
  error           text,
  received_at     timestamptz DEFAULT now(),
  UNIQUE (source, external_id)
);
CREATE INDEX idx_incoming_webhook_received ON incoming_webhook_log (received_at);
CREATE INDEX idx_incoming_webhook_unprocessed ON incoming_webhook_log (source, received_at) WHERE processed_at IS NULL;
```

## 15.2 Outgoing Webhooks (Growth+ Tenants)

```sql
CREATE TABLE outgoing_webhook_subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid REFERENCES tenants(id) ON DELETE CASCADE,
  url                      text NOT NULL,
  events                   text[] NOT NULL,
  signing_secret_encrypted bytea NOT NULL,
  is_active                boolean DEFAULT true,
  allowed_ips              inet[],                          -- IP allowlist for outgoing destination
  custom_headers           jsonb,                            -- e.g. {'Authorization': 'Bearer xxx'}
  created_by               uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  last_delivered_at        timestamptz,
  last_status_code         integer,
  consecutive_failures     integer DEFAULT 0,
  created_at               timestamptz DEFAULT now()
);

CREATE TABLE outgoing_webhook_deliveries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id    uuid REFERENCES outgoing_webhook_subscriptions(id) ON DELETE CASCADE,
  event_type         text NOT NULL,
  payload            jsonb NOT NULL,
  attempt_count      integer DEFAULT 0,
  next_attempt_at    timestamptz,
  delivered_at       timestamptz,
  last_status_code   integer,
  last_response_body text,
  failed_permanently boolean DEFAULT false,
  created_at         timestamptz DEFAULT now()
);
CREATE INDEX idx_webhook_deliveries_pending ON outgoing_webhook_deliveries (next_attempt_at)
  WHERE delivered_at IS NULL AND failed_permanently = false;
```

**IP Allowlist** (NEW): When `allowed_ips` is set, outgoing HTTP request includes a check that the resolved IP is in the allowlist. Protects against DNS rebinding to internal/private addresses (SSRF prevention).

### Delivery
- Cloudflare Queues consumer
- HTTP POST with `X-OccasionPro-Signature: sha256=...`, `X-OccasionPro-Timestamp`, `X-OccasionPro-Event`
- Retry exponential: 1m, 5m, 30m, 2h, 6h, 24h (6 attempts)
- After 6 failures → `failed_permanently = true`, Owner notified
- After 10 consecutive failures across all deliveries → subscription auto-disabled, Owner alerted

### Subscribable Events
`guest.created` · `guest.rsvp_changed` · `guest.checked_in` · `guest.plus_one_added` · `payment.received` · `payment.refunded` · `vendor.confirmed` · `vendor.declined` · `vendor.quote_submitted` · `task.completed` · `event.created` · `event.deleted` · `event.completed` · `event.offloaded` · `invoice.issued` · `invoice.paid` · `addon.purchased` · `addon.cancelled` · `storage.over_quota` · `subscription.upgraded` · `subscription.downgraded` · `subscription.paused` · `subscription.resumed` · `chargeback.received` · `client.document_signed` · `inventory.allocated` · `crew.shift_conflict`

---

# PART 16 — SUPPORT SYSTEM

```sql
CREATE TABLE support_faqs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_pattern text NOT NULL,
  answer           text NOT NULL,
  category         text,
  sort_order       integer DEFAULT 0,
  is_active        boolean DEFAULT true,
  created_at       timestamptz DEFAULT now()
);

CREATE TABLE support_tickets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL,
  user_type           text NOT NULL CHECK (user_type IN ('tenant_member','client','vendor','guest')),
  subject             text NOT NULL,
  messages            jsonb DEFAULT '[]',
  status              text DEFAULT 'open' CHECK (status IN ('open','bot_handled','escalated','resolved','closed')),
  escalated_at        timestamptz,
  resolved_at         timestamptz,
  resolved_by         uuid REFERENCES super_admins(id) ON DELETE SET NULL,
  satisfaction_rating integer CHECK (satisfaction_rating BETWEEN 1 AND 5),
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX idx_support_tickets_tenant_status ON support_tickets (tenant_id, status);
CREATE INDEX idx_support_tickets_user ON support_tickets (user_type, user_id);
```

Visibility: Ticket creator (own) · Workspace Owner (all in workspace) · Manager (own + events they manage) · Super Admin (all).

---

# PART 17 — FINANCE MODULE

## 17.1 Payments

```sql
CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id           uuid REFERENCES events(id) ON DELETE CASCADE,
  invoice_id         uuid REFERENCES invoices(id) ON DELETE SET NULL,
  payer_type         text NOT NULL CHECK (payer_type IN ('client','guest','sponsor','exhibitor','tenant_subscription','other')),
  payer_id           uuid,
  payer_name         text,
  amount             numeric(14,2) NOT NULL,
  currency_code      varchar(3) NOT NULL,
  status             text DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded','partially_refunded')),
  gateway            text NOT NULL,
  gateway_payment_id text,
  gateway_order_id   text,
  refunded_amount    numeric(14,2) DEFAULT 0,
  paid_at            timestamptz,
  deleted_at         timestamptz,
  purge_after        timestamptz,
  created_at         timestamptz DEFAULT now()
);
CREATE INDEX idx_payments_event ON payments (event_id);
CREATE INDEX idx_payments_invoice ON payments (invoice_id);
CREATE INDEX idx_payments_gateway_payment ON payments (gateway, gateway_payment_id);
CREATE INDEX idx_payments_gateway_order ON payments (gateway, gateway_order_id);
CREATE INDEX idx_payments_payer ON payments (payer_type, payer_id);
```

## 17.2 Invoices (GST-Compliant)

```sql
CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES events(id) ON DELETE CASCADE,
  invoice_number  text NOT NULL,
  bill_to_name    text NOT NULL,
  bill_to_email   text,
  bill_to_address text,
  bill_to_gstin   text,
  line_items      jsonb NOT NULL,
  subtotal        numeric(14,2) NOT NULL,
  tax_total       numeric(14,2) NOT NULL,
  grand_total     numeric(14,2) NOT NULL,
  currency_code   varchar(3) NOT NULL,
  status          text DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','partially_paid','overdue','cancelled')),
  issued_at       timestamptz,
  due_at          timestamptz,
  paid_at         timestamptz,
  pdf_url         text,
  deleted_at      timestamptz,
  purge_after     timestamptz,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (tenant_id, invoice_number)
);
CREATE INDEX idx_invoices_event ON invoices (event_id);
CREATE INDEX idx_invoices_due ON invoices (due_at) WHERE status IN ('sent','partially_paid','overdue');
```

## 17.3 Vendor Payouts

```sql
CREATE TABLE vendor_payouts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id          uuid REFERENCES events(id) ON DELETE CASCADE,
  vendor_account_id uuid REFERENCES vendor_accounts(id) ON DELETE SET NULL,
  assignment_id     uuid REFERENCES vendor_event_assignments(id) ON DELETE SET NULL,
  milestone         text NOT NULL,
  amount            numeric(14,2) NOT NULL CHECK (amount > 0),
  currency_code     varchar(3) NOT NULL,
  scheduled_for     timestamptz,
  status            text DEFAULT 'scheduled' CHECK (status IN ('scheduled','approved','disbursing','disbursed','failed','cancelled')),
  gateway           text CHECK (gateway IN ('razorpay_x','stripe_connect','cashfree_payout','manual')),
  gateway_payout_id text,
  approved_by       uuid REFERENCES tenant_members(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  disbursed_at      timestamptz,
  failure_reason    text,
  deleted_at        timestamptz,
  purge_after       timestamptz,
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX idx_payouts_event ON vendor_payouts (event_id);
CREATE INDEX idx_payouts_vendor ON vendor_payouts (vendor_account_id);
CREATE INDEX idx_payouts_gateway ON vendor_payouts (gateway, gateway_payout_id);
CREATE INDEX idx_payouts_status_scheduled ON vendor_payouts (status, scheduled_for) WHERE status IN ('scheduled','approved');
```

## 17.4 Card Data Policy
Never stored. All card data via gateway-hosted iframes (Razorpay Checkout, Stripe Elements). PCI-DSS scope limited to SAQ-A.

---

# PART 18 — STORAGE MODULE

## 18.1 Schema

```sql
CREATE TABLE storage_objects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES events(id) ON DELETE SET NULL,
  category        text NOT NULL CHECK (category IN (
                    'logo','tenant_avatar','user_avatar','event_cover',
                    'event_photo','event_video','document','export',
                    'vendor_doc','client_doc','invitation_media','speaker_photo','speaker_presentation',
                    'crew_doc','inventory_image','signed_contract'
                  )),
  r2_key          text UNIQUE NOT NULL,
  r2_bucket       text NOT NULL DEFAULT 'occasionpro-tenant-storage',
  filename        text NOT NULL,
  mime_type       text NOT NULL,
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
  uploaded_by     uuid,
  uploaded_by_type text CHECK (uploaded_by_type IN ('tenant_member','client','vendor','guest','speaker','system')),
  archived_at     timestamptz,
  archive_expires_at timestamptz,
  deleted_at      timestamptz,
  purge_after     timestamptz,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_storage_objects_tenant ON storage_objects (tenant_id, created_at DESC);
CREATE INDEX idx_storage_objects_event ON storage_objects (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX idx_storage_objects_category ON storage_objects (tenant_id, category);
CREATE INDEX idx_storage_objects_size ON storage_objects (tenant_id) INCLUDE (size_bytes) WHERE deleted_at IS NULL;
CREATE INDEX idx_storage_archive_pending ON storage_objects (archive_expires_at) WHERE archived_at IS NOT NULL AND deleted_at IS NULL;

CREATE POLICY storage_tenant_isolation ON storage_objects
  FOR ALL TO authenticated
  USING (tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid);

CREATE TABLE storage_archive_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid REFERENCES tenants(id) ON DELETE CASCADE,
  bytes_archived         bigint NOT NULL,
  file_count             integer NOT NULL,
  archived_at            timestamptz DEFAULT now(),
  restore_window_ends_at timestamptz NOT NULL,
  restored_at            timestamptz,
  purged_at              timestamptz
);
```

## 18.2 Upload / Download / Delete Flows
Path-based isolation `tenants/[tenant_id]/[category]/[uuid].[ext]`. Worker validates JWT + quota → pre-signed R2 URL (5min PUT / 15min GET). Cross-tenant attempts return 404 (no leakage).

## 18.3 Storage Add-On Cancellation Grace Flow
30-day grace → cold archive → 60-day total recovery → purge. 30-day cooldown on same-pack re-cancel.

## 18.4 Smart Cleanup
Triggered at 80% storage. Suggestion table tracks dismissed/applied actions.

## 18.5 Quota Recompute Function

```sql
CREATE OR REPLACE FUNCTION recompute_storage_quota(_tenant uuid) RETURNS void AS $$
DECLARE
  base_bytes bigint;
  addon_bytes bigint;
BEGIN
  SELECT (p.max_storage_gb * 1073741824)::bigint INTO base_bytes
    FROM tenant_subscriptions ts JOIN subscription_plans p ON p.id = ts.plan_id
   WHERE ts.tenant_id = _tenant;
  SELECT COALESCE(SUM(sac.extra_gb * tsa.quantity * 1073741824), 0)::bigint INTO addon_bytes
    FROM tenant_storage_addons tsa JOIN storage_addons_catalog sac ON sac.id = tsa.addon_id
   WHERE tsa.tenant_id = _tenant AND tsa.status = 'active';
  UPDATE tenants SET storage_quota_bytes = base_bytes + addon_bytes WHERE id = _tenant;
END;
$$ LANGUAGE plpgsql;
```

---

# PART 19 — SECURITY ARCHITECTURE

## 19.1 Authentication

### 19.1.1 Password Authentication
- Supabase Auth + bcrypt (cost factor 12)
- **Constant-time password comparison** — all comparison via `bcrypt.compare()` which is constant-time; never use string `===`
- Password policy: min 8 chars, uppercase + number + special
- HaveIBeenPwned check via k-anonymity (no plaintext sent)
- Password reset rate limit: 3 requests per email per hour
- Account enumeration protection: generic "If account exists, you'll receive email"
- No passwords in URLs, logs, error messages

### 19.1.2 Social Login (OAuth Providers)

Tenant staff can sign in/up via:
- **Google** (most common India)
- **Microsoft** (Microsoft 365 customers)
- **Apple** (iOS preference + privacy)
- **LinkedIn** (professional networks)

```sql
CREATE TABLE oauth_provider_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    uuid NOT NULL,                              -- references auth.users
  provider        text NOT NULL CHECK (provider IN ('google','microsoft','apple','linkedin')),
  provider_user_id text NOT NULL,
  provider_email  text,
  linked_at       timestamptz DEFAULT now(),
  last_used_at    timestamptz,
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX idx_oauth_user ON oauth_provider_links (auth_user_id);
```

Implementation via Supabase Auth's OAuth providers. On first OAuth sign-in:
- If email exists with password account → prompt to link
- If new → create account with no password (passwordless)
- Multiple providers per user supported

### 19.1.3 Passwordless / Magic Link Login

Available for all portals (Super Admin, Tenant, Client, Vendor, Speaker, Guest).

```sql
CREATE TABLE magic_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  user_type     text NOT NULL CHECK (user_type IN ('tenant_member','super_admin','client','vendor','speaker')),
  email         text NOT NULL,
  token_hash    text UNIQUE NOT NULL,
  ip_address    inet,
  user_agent    text,
  device_fingerprint text,
  expires_at    timestamptz NOT NULL,                         -- 15 min default
  consumed_at   timestamptz,
  consumed_ip   inet,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX idx_magic_links_hash ON magic_links (token_hash) WHERE consumed_at IS NULL;
CREATE INDEX idx_magic_links_user ON magic_links (user_id, user_type);
```

Flow: user enters email → magic link email sent (15-min expiry) → click → consumed_at set → session created. Rate limit: 3 requests per email per hour.

### 19.1.4 WebAuthn / Passkeys (Year 2)
Schema reserved. Cross-device, biometric-only. Roadmap.

### 19.1.5 Account Recovery (Beyond Email + Phone)

```sql
CREATE TABLE account_recovery_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  user_type     text NOT NULL,
  code_hash     text NOT NULL,                                -- sha256 of full code
  consumed_at   timestamptz,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX idx_recovery_codes ON account_recovery_codes (user_id, user_type) WHERE consumed_at IS NULL;
```

On MFA setup: 10 single-use recovery codes generated, shown ONCE for user to save. Used to bypass MFA if device lost. Each code single-use.

Beyond recovery codes:
- **Recovery email** + **recovery phone** stored on `tenant_members`, `super_admins`, etc.
- **Trusted contact** — Workspace Owner can name another team member as recovery contact who can request unlock (with cooldown)
- **Hardware security key** — WebAuthn-compatible (FIDO2) registration as recovery factor

### 19.1.6 Device Management UI

```sql
-- auth_sessions already has device fingerprint, name, type fields
-- UI surfaces:
SELECT id, device_name, device_type, os, browser, ip_country, last_seen_at, created_at,
       (id = current_setting('app.current_session_id')::uuid) AS is_current
FROM auth_sessions
WHERE user_id = $1 AND user_type = $2 AND revoked_at IS NULL
ORDER BY last_seen_at DESC;
```

User dashboard "Active Devices" tab shows all sessions with:
- Device name (auto-detected, user-renameable)
- Last active time
- IP country (geolocated)
- One-click "Sign out this device"
- "Sign out everywhere except this device"
- Suspicious-login flag if from new country

### 19.1.7 MFA (TOTP)

Three enforcement layers:
- Platform-wide (Super Admin kill switch)
- Workspace-wide (Workspace Owner)
- Individual (opt-in)

TOTP secrets stored as pgcrypto-encrypted bytea with key in Supabase Vault.

### 19.1.8 OTP Expiry & Limits
- Magic link: 15 min
- Mobile OTP (guest): 10 min
- Email OTP (guest fallback): 10 min
- OTP verification: 5 attempts → invalidate
- Access tokens: 1hr · Refresh: 7 days (rotated)

### 19.1.9 Account Lockout
- 5 failed login attempts → 15min lockout → alert
- Suspicious login alert (new device/location)

## 19.2 Authorisation
RLS on every table. JWT validation per request. Double enforcement (API + DB). Module-level perms. Rate limiting per endpoint.

### Canonical RLS Policies (see Part 7, 18 for tenant + storage + portal-specific RLS)

```sql
CREATE POLICY tenant_isolation ON events
  FOR ALL TO authenticated
  USING (tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid);

CREATE POLICY audit_log_no_modify ON audit_log
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
```

## 19.3 Data Encryption
- At rest: Supabase + R2 server-side encryption
- In transit: TLS 1.3 minimum
- Application column encryption (pgcrypto): MFA secrets, vendor bank details, OAuth tokens, webhook signing secrets
- Supabase Vault for all keys
- Quarterly key rotation procedure in runbook

## 19.4 API Security
- HTTPS only (HTTP → 301)
- CORS strict whitelist
- Helmet equivalent for Workers: HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy
- CSRF: double-submit cookie + SameSite=Lax
- Input validation: Zod on every request
- Rate limits: Auth 5/min/IP · Read 60/min/user · Write 30/min/user · Export 10/hour/user
- Webhook HMAC-SHA256 + 5-min timestamp window
- Request size: 1MB body / 50MB multipart
- No stack traces in prod

## 19.5 Application-Layer DDoS Protection (NEW)

Beyond Cloudflare's L3/L4 protection:

```sql
CREATE TABLE app_ddos_signals (
  id              bigserial PRIMARY KEY,
  signal_type     text CHECK (signal_type IN ('rate_burst','pattern_attack','enumeration_attack','slow_loris','credential_stuffing','api_abuse')),
  ip_address      inet,
  tenant_id       uuid REFERENCES tenants(id),
  endpoint        text,
  count           integer,
  detected_at     timestamptz DEFAULT now(),
  blocked         boolean DEFAULT false,
  block_duration_seconds integer,
  notes           text
);
CREATE INDEX idx_ddos_signals_ip ON app_ddos_signals (ip_address, detected_at);
CREATE INDEX idx_ddos_signals_tenant ON app_ddos_signals (tenant_id, detected_at);
```

Detection patterns (in Workers):
- **Rate burst**: >100 requests from single IP in <10s → temporary block (5min escalating to 1hr)
- **Pattern attack**: requests to many sequential IDs → block + alert (enumeration)
- **Slow loris**: many concurrent slow connections from same IP → block
- **Credential stuffing**: failed logins across many usernames from same IP → block + Super Admin alert
- **API abuse**: API key making requests at unusual times/locations → freeze key + Owner alert

Combined with Cloudflare WAF rules (managed challenge for suspicious traffic, JS challenge for bots).

## 19.6 Tenant Data Isolation
DB-level RLS + `tenant_id` on every table. Super Admin impersonation 30-min token + restricted action set + audit-visible to Owner.

## 19.7 Secrets Management
Zero in code/git. Cloudflare Workers Secrets + Supabase Vault. `.env` in `.gitignore` + git-secrets. npm audit + Snyk on every PR. API key auto-expire 365d; signing secrets rotated 90d.

## 19.8 Audit Trail

```sql
CREATE TABLE audit_log (
  id              bigserial,
  tenant_id       uuid,
  actor_id        uuid,
  actor_type      text NOT NULL CHECK (actor_type IN ('tenant_member','super_admin','system','client','vendor','guest','speaker')),
  actor_role      text,                                       -- 'owner','admin','engineering', etc.
  action          text NOT NULL,
  entity          text NOT NULL,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  ip_address      inet,
  user_agent      text,
  request_id      text,
  approval_id     uuid REFERENCES super_admin_approvals(id),
  severity        text DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_audit_log_tenant_time ON audit_log (tenant_id, created_at);
CREATE INDEX idx_audit_log_actor ON audit_log (actor_id, created_at);
CREATE INDEX idx_audit_log_entity ON audit_log (entity, entity_id, created_at);
```

Immutability: `REVOKE INSERT, UPDATE, DELETE ON audit_log FROM PUBLIC, authenticated, service_role`. Only `audit_writer` role can INSERT. RLS append-only. App writes via `AuditService` only. UPDATE/DELETE attempt fires Super Admin alert.

Visibility per role (see Part 2.9 matrix). Retention: min 90d; Enterprise indefinite. Old partitions archived to R2 cold storage.

## 19.9 Data Privacy & Compliance

### 19.9.1 Right to Erasure — Anonymize
```sql
UPDATE guests SET
  name = '[Erased Guest]', email = NULL, phone = NULL,
  dietary_requirement = NULL, notes = NULL,
  erased_at = NOW(), erased_reason = 'gdpr_request'
WHERE id = $1;
```

### 19.9.2 24-Month PII Auto-Anonymization
`tenants.guest_pii_retention_months DEFAULT 24`. `GuestPIIAnonymizer` monthly job sends one-click consent email to Owner.

### 19.9.3 DSAR Endpoint
Tenant Owner can request "all data we hold about [email]" → automated export via `DataExportWorker`. Required by GDPR Art. 15 and DPDP Sec. 11.

### 19.9.4 Other Provisions
Data minimisation · Data portability · Privacy policy + T&C acceptance with timestamp+IP · No data sold · India IT Act 2000 + DPDP Act 2023 · WhatsApp/email body 30-day retention

### 19.9.5 Data Residency
Indian tenants `ap-south-1`. Others choose at signup. Enterprise: region pinning + DPA.

## 19.10 Brand Impersonation Monitoring (NEW)

```sql
CREATE TABLE brand_impersonation_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_domain text NOT NULL,
  similarity_score numeric(3,2),                              -- against 'occasionpro.in'
  detected_via    text CHECK (detected_via IN ('certificate_transparency','domain_registration','search_crawl','user_report')),
  status          text DEFAULT 'new' CHECK (status IN ('new','investigating','confirmed_malicious','false_positive','taken_down')),
  takedown_filed_at timestamptz,
  takedown_provider text,
  taken_down_at   timestamptz,
  notes           text,
  detected_at     timestamptz DEFAULT now()
);
CREATE INDEX idx_brand_impersonation_status ON brand_impersonation_alerts (status);
```

`BrandImpersonationScanner` weekly:
- Queries Certificate Transparency logs (crt.sh) for `*occasionpro*` certs
- Domain typo-squatting check (`occasionpr0.in`, `occasionspro.in`, `occasionpro.com.example.com`)
- Levenshtein distance against `occasionpro.in` <3 → flag

On confirmed malicious: Super Admin files takedown via Cloudflare abuse, registrar abuse, hosting provider abuse. Templates pre-canned.

## 19.11 Subdomain Takeover Prevention (NEW)

When a tenant adds a custom domain and later abandons it (cancellation), the CNAME may still point to OccasionPro. An attacker who registers a similar Worker route on Cloudflare could serve content under tenant's old subdomain → phishing.

```sql
CREATE TABLE custom_domain_health_checks (
  id              bigserial PRIMARY KEY,
  domain          text NOT NULL,
  tenant_id       uuid REFERENCES tenants(id) ON DELETE SET NULL,
  check_type      text CHECK (check_type IN ('cname_intact','ssl_valid','content_served','orphaned')),
  status          text CHECK (status IN ('healthy','warning','critical','orphaned')),
  checked_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_domain_health_domain ON custom_domain_health_checks (domain, checked_at DESC);
```

`SubdomainTakeoverScanner` daily:
- For each `tenant_custom_domains.domain` (active OR revoked):
  - DNS lookup → does CNAME still point to our routing target?
  - If tenant is cancelled but CNAME still points to us → we still serve the domain (with cancelled tenant's read-only data) BUT block any registration of routes by other tenants pointing to that domain
  - Notify the original tenant: "Your custom domain still points to OccasionPro — please update DNS or risk impersonation"
- After 90 days of orphaned CNAME with no response → forcibly de-provision the Worker route on our side (returns to default 404)
- Domains never re-assignable to a different tenant for 1 year after de-provision (prevents takeover)

## 19.12 Sub-Processor Breach Response (NEW)

If a sub-processor (Resend, Supabase, Cloudflare, Stripe, Razorpay) discloses a breach:

```sql
CREATE TABLE sub_processor_incidents (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_processor                   text NOT NULL,
  incident_date                   date NOT NULL,
  disclosed_at                    timestamptz NOT NULL,
  affected_data                   text[],
  affected_period_start           timestamptz,
  affected_period_end             timestamptz,
  estimated_tenants_affected      integer,
  remediation_actions             jsonb,
  customer_notification_sent_at   timestamptz,
  regulator_notification_sent_at  timestamptz,
  status                          text DEFAULT 'investigating' CHECK (status IN ('investigating','contained','resolved')),
  notes                           text,
  created_at                      timestamptz DEFAULT now()
);
```

**Runbook (executed on disclosure):**
1. Hour 0: Internal Slack alert; Super Admin Owner mobilises
2. Hour 1: Assess scope; identify affected data classes
3. Hour 4: Execute remediation actions (force-rotate ALL platform secrets if API provider; force logout ALL sessions if auth provider; trigger password reset if password store affected)
4. Hour 24: Send tenant disclosure email
5. Hour 72: Send GDPR/DPDP regulator notification per Art. 33
6. Day 7: Public status page incident report
7. Day 30: Post-mortem published

## 19.13 Phishing-via-Our-Domain Protection (NEW)

- **SPF**: `v=spf1 include:resend.com include:_spf.google.com -all` (hard fail)
- **DKIM**: enforced on all outgoing sends
- **DMARC**: `v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@occasionpro.in; ruf=mailto:dmarc-forensic@occasionpro.in; aspf=s; adkim=s`
- DMARC aggregate reports parsed weekly
- Suspicious volume from unauthorized IPs → immediate alert + investigation

## 19.14–19.19 Infrastructure, File, Frontend, Logging, IR, Smart Alerts
- Cloudflare DDoS + WAF + bot detection
- R2 signed URLs (1hr), MIME validation, size limits per category, ClamAV virus scan >1MB
- No localStorage for sensitive data, httpOnly cookies, strict CSP
- PII redaction at log layer, audit log 90d minimum
- Smart Security Alerts always-on: failed-login spikes, new-country logins, bulk exports, mass deletion, audit-log tamper, hard-cap approach, brand impersonation, sub-processor breach, subdomain takeover, DMARC failure spike

---

# PART 20 — ENVIRONMENTS, CI/CD, DEPLOYMENT

## 20.1 Environments
- `local` → `dev.occasionpro.in` → `staging.occasionpro.in` → `app.occasionpro.in`
- Per-env Supabase project, Cloudflare zone, R2 bucket

## 20.2 CI/CD Pipeline (GitHub Actions)
- Branch protection on `main`: 1 approval + green CI + up-to-date + squash-only
- PR checks: ESLint + Prettier + SQLFluff · `tsc --noEmit` · unit + integration + RLS policy tests · npm audit + Snyk + Trivy · migration dry-run vs staging
- Deploy on merge: dev → auto E2E → staging (manual approval) → production (manual approval)
- Workers: atomic versioned deploys; instant rollback
- Pages: per-PR preview deploys
- Canary 5% → 25% → 100% for risky changes
- Auto-rollback on error-rate spike (>2% over 5min)

## 20.3 Database Migrations
- Supabase CLI timestamped SQL files: `[YYYYMMDDHHMMSS]_[desc].sql`
- All forward-compatible · reversible where possible · long migrations use online schema-change pattern
- Migration order strictly per Part 34.0

## 20.4 Rollback
Workers/Pages revert version (~10s). DB forward-fix preferred. Queues drained before code change.

---

# PART 21 — OBSERVABILITY & SLAs

## 21.1 Stack
Sentry · PostHog · Cloudflare Web Analytics · BetterStack · Grafana Cloud

## 21.2 Key Metrics
**Platform**: API p50/p95/p99 latency · error rate · active tenants/users/sessions · Realtime connections · Inngest queue depth · DB pool utilisation · storage per tenant
**Business**: signups · conversions · churn · MRR/ARR/ARPU · per-plan count · storage trend · add-on attach rate · DSO · failed-payment rate · chargeback rate
**Per-Tenant Health Score**: see Part 32

## 21.3 SLA Targets

### Single-Region (default)
| Service | SLO |
|---------|-----|
| API uptime | 99.5% (~3.6h/mo) |
| API p95 latency | <500ms |
| Realtime propagation | <500ms p95 |
| Webhook delivery | 99% within retry budget |
| Email delivery | 99% within 5 min |
| SMS OTP | 95% within 30s |

### Multi-Region (Enterprise add-on)
| Service | SLO |
|---------|-----|
| API uptime | 99.9% (~43m/mo) |
| API p95 latency | <300ms |
| RPO / RTO | 5 min / 1hr |

## 21.4 Alerting
PagerDuty critical: API error >2% · latency >1s · storage >85% · audit-log tamper
PagerDuty warning: DB CPU >85% · queue depth >10k · Realtime >80% capacity
Slack: business + security signals

## 21.5 On-Call Runbooks
DB failover · Tenant suspension · Emergency ownership transfer · Force secret rotation · Storage cleanup · Webhook backlog · Realtime restart · Cache purge · R2 outage · Add-on billing recon · Sub-processor breach · Subdomain takeover · Chargeback storm

## 21.6 Public Status Page
`status.occasionpro.in` via BetterStack. Auto-updates on infrastructure incidents.

---

# PART 22 — BACKUP & DISASTER RECOVERY

## 22.1 Backup Strategy
| Asset | Method | Frequency | Retention |
|-------|--------|-----------|-----------|
| Postgres | PITR + daily pg_dump → R2 | Continuous + daily | 30d PITR · 90d dumps |
| R2 | Cross-region replication | Continuous | Unlimited |
| Secrets (Vault) | Encrypted to separate AWS account | Weekly | 1yr |
| Config | Git-tracked + Wrangler export | On change | Indefinite |

## 22.2 RPO / RTO
| Tier | RPO | RTO |
|------|-----|-----|
| Pro+/Enterprise | 5 min | 1hr |
| Starter/Growth | 1hr | 4hr |

## 22.3 Disaster Scenarios
Supabase region outage → DNS swap + read-replica promote (30-min RTO) · Cloudflare outage → DNS direct to origin · R2 outage → read-only mode · Total infra loss → rebuild from R2 (24hr) · Tenant accidentally bulk-deletes → soft-delete restore within 30d · Sub-processor breach → Part 19.12

## 22.4 DR Drills
Quarterly tabletop · Annual live failover in staging · Monthly restore validation

---

# PART 23 — TESTING STRATEGY

## 23.1 Test Pyramid
| Layer | Tool | Coverage |
|-------|------|----------|
| Unit | Vitest | 80%+ services/utilities |
| Integration | Vitest + supertest + test DB | All API endpoints + RLS policies |
| E2E (web) | Playwright | Critical user journeys |
| E2E (mobile) | Detox | Login, check-in, runsheet sync |
| Load | k6 | Pre-release major features |
| Security | OWASP ZAP + manual quarterly | Top 10 |
| Accessibility | axe-core in Playwright | WCAG 2.2 AA |
| Chaos | Manual / Litmus | Network partition, pod kill, DB failover |

## 23.2 Mandatory Tests
- Every RLS policy: authorized-success + unauthorized-empty test pair (runs every PR)
- Every migration: forward + backward + data integrity vs staging snapshot
- Theme changes: visual regression test on 12 representative screens (per Part 33)

## 23.3 Critical Journeys
Signup → workspace → trial → event → invite team → import guests → invites → RSVP → check-in → post-event report · Vendor invite/accept/quote · Client invite/budget/sign contract · Guest OTP (mobile+email fallback) / RSVP / +1 / change-mind · Storage add-on purchase + cancellation grace · Cloud offload + restore · Subscription pause+resume · Chargeback flow · Tenant-to-tenant transfer · Theme change + rollback

---

# PART 24 — COMPLIANCE & LEGAL

## 24.1 Roadmap
| Standard | Target |
|----------|--------|
| GDPR · DPDP 2023 · IT Act 2000 | Day 1 |
| PCI-DSS SAQ-A | Day 1 |
| SOC 2 Type I | Year 1 |
| SOC 2 Type II | Year 1.5 |
| ISO 27001 | Year 2 |
| HIPAA · CCPA · COPPA | On demand |

## 24.2 Sub-Processors (Public)
Supabase · Cloudflare · AWS · Resend · Razorpay · Stripe · Cashfree · Twilio · Fast2SMS · MSG91 · Meta · Anthropic · OpenAI · Sentry · PostHog · BetterStack · Grafana · DocuSign/Signwell · Google/Microsoft/Dropbox (tenant-opt-in)

Tenant-facing DPA at signup. List public at `occasionpro.in/sub-processors`.

## 24.3 Legal Documents
ToS · Privacy Policy · AUP · DPA · Cookie Policy · Sub-processors List · Refund Policy · GST/Tax Policy · DMCA Policy. All versioned. Acceptance recorded with timestamp + IP.

## 24.4 PII Inventory
| Field | Class | Encrypted | Retention |
|-------|-------|-----------|-----------|
| `tenant_members.email` | PII | TLS + bcrypt | Account lifetime |
| `guests.name/email/phone` | PII | TLS | Event + 24mo then anonymize prompt |
| `vendor_accounts.bank_account_encrypted` | Sensitive | pgcrypto | Account lifetime |
| MFA secrets | Sensitive | pgcrypto | Account lifetime |
| API key full value | Sensitive | sha256 hash only | Until revoked |
| Card data | Out of scope | Never stored | N/A |

## 24.5 DPO + VDP
Founder → transitions by Year 1. Contact in Privacy Policy. Quarterly compliance review. `/.well-known/security.txt` + Vulnerability Disclosure Program at `occasionpro.in/security`.

---

# PART 25 — API VERSIONING & PUBLIC API

`/api/v1/...` URL-versioned. Breaking changes → new version, previous supported 12+ months. Deprecation via `Sunset`/`Deprecation` headers. Public changelog. REST for all entities (Pro+). GraphQL endpoint (Enterprise). Webhook subscriptions. Rate-limited per API key. OpenAPI 3.1 auto-generated + Postman/Bruno + Node/Python SDKs + sandbox env. All POSTs accept `Idempotency-Key` header (24hr KV cache).

---

# PART 26 — INTERNATIONALISATION

Translation keys via `next-intl` (web) and `react-i18next` (RN). Default `en`. Day-1: English, Hindi, Tamil. Tenant custom translations for guest-facing surfaces. `tenant_members.locale` + `guests.locale`. RTL via Tailwind logical properties (Arabic/Urdu Day-2). `Intl.DateTimeFormat`/`Intl.NumberFormat` per locale with Indian lakhs/crores option. Currency follows event currency.

---

# PART 27 — ACCESSIBILITY

WCAG 2.2 AA on all portals. Automated axe-core in Playwright E2E. Manual quarterly screen-reader review. Keyboard nav everywhere. Visible focus. 4.5:1 text contrast / 3:1 UI contrast. Explicit form labels. ARIA where semantic HTML insufficient. Skip-to-content. Reduced motion preference. Dark mode (system + manual toggle). All portals work down to 320px. Touch targets ≥44×44px on mobile.

---

# PART 28 — PERFORMANCE BUDGETS

**Web Vitals p75**: LCP <2.5s · INP <200ms · CLS <0.1 · TTFB <600ms
**Bundle sizes (gzipped)**: Company Admin <250KB · Guest Portal <100KB · Public Event Website <80KB. Code-split per route. Lazy-load Konva, ZXing, Framer Motion.
**Database**: Query p95 <100ms. N+1 prohibited (PR review). All FK joins indexed.
**Monitoring**: Lighthouse CI on every PR (regression budget +10%). Sentry performance alerts.

---

# PART 29 — COST MODEL & PROVIDER ALTERNATIVES

| Stage | Tenants | Revenue/mo | Infra/mo | Margin |
|-------|---------|------------|----------|--------|
| Launch | 1–10 | $30–300 | $1 | 97–99% |
| Validation | 10–50 | $300–3,000 | $50 | 95–98% |
| Growth | 50–200 | $3k–15k | $500 | 90–97% |
| Scale | 200–1,000 | $15k–80k | $3k | 85–95% |
| Enterprise | 1,000+ | $80k+ | $10k+ | 80–90% |

**Escape hatches**: Cloudflare Workers ↔ Fly.io · Supabase ↔ AWS RDS · R2 ↔ S3/B2 · Supabase Realtime ↔ Pusher/Ably · Resend ↔ SES · Sentry ↔ Glitchtip · PostHog Cloud ↔ self-host · DocuSign ↔ Signwell. All via pluggable `IFooProvider` interfaces.

---

# PART 30 — ONBOARDING & USER EXPERIENCE

## 30.1 In-App Product Tour
```sql
CREATE TABLE onboarding_state (
  tenant_id              uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  signup_completed_at    timestamptz,
  workspace_setup_at     timestamptz,
  first_event_created_at timestamptz,
  first_member_invited_at timestamptz,
  payment_setup_at       timestamptz,
  tour_completed_at      timestamptz,
  tour_skipped_at        timestamptz,
  current_tour_step      text,
  total_tour_steps       integer,
  template_used          text,
  demo_data_loaded       boolean DEFAULT false,
  updated_at             timestamptz DEFAULT now()
);
```
Shepherd.js or Driver.js. 7 step tour: welcome → branding → first event → portal tour → invite team → payment → next steps.

## 30.2 Demo Data Sample Event
One-click `create_demo_event()` factory: 50 demo guests, 5 vendors, runsheet, floor plan, budget — all prefixed `[DEMO]`. One-click delete.

## 30.3 Pre-Built Event Templates (Kits)
10 platform-built kits: Indian Wedding · Corporate Conference · Product Launch · Trade Exhibition · Concert · Birthday · Award Gala · Religious Ceremony · Funeral/Memorial · Sports Tournament. Copies scaffold runsheet, vendor categories, F&B style, guest categories, budget template, invitation template.

## 30.4 Onboarding Email Sequence (`OnboardingEmailWorker`)
| Day | Trigger | Subject |
|-----|---------|---------|
| 1 | Signup +24h | "Welcome — let's create your first event" |
| 3 | No event yet | "Try our Wedding Kit (or 9 other templates)" |
| 7 | No team invite | "Invite your team — first 3 seats free on trial" |
| 10 | Trial day 10 | "4 days left — your data, no commitment" |
| 12 | Trial day 12 | "2 days left — keep your data with Starter ₹999" |
| 14 | Trial expired | "Your data is safe for 30 days — pay to continue" |

## 30.5 Contextual Help
```sql
CREATE TABLE help_content (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_key     text UNIQUE NOT NULL,
  title           text NOT NULL,
  body_markdown   text,
  video_url       text,
  learn_more_url  text,
  locale          text DEFAULT 'en',
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_help_context ON help_content (context_key, locale);
```
`?` icon on every field/action/region opens tooltip with help_content row. Super Admin edits live.

## 30.6 Empty State CTAs
Every list view: rich empty state with brand-coloured CTA + 10-second demo video link + sample CSV download where applicable.

## 30.7 Per-Role Personalised Dashboard
Workspace Owner → revenue + events + team + storage
Manager → upcoming events + tasks + workload + vendor responses
Lead → sub-team tasks + schedule + members
Member → assigned tasks + schedule + notifications + quick actions
Client → my events + invoices + recent activity + docs-to-sign
Vendor → assignments + today's events + pending quotes + calendar
Guest → current event + QR + seating + notifications

---

# PART 31 — INTEGRATIONS & ECOSYSTEM

## 31.1 SSO
SMB (Growth+): Google Workspace + Microsoft 365 (OAuth). Enterprise: WorkOS SAML 2.0 / OIDC / Okta / OneLogin / Azure AD.
```sql
CREATE TABLE tenant_sso_config (
  tenant_id           uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider            text NOT NULL CHECK (provider IN ('google_workspace','microsoft_365','okta','onelogin','azure_ad','custom_saml','custom_oidc')),
  config_encrypted    bytea NOT NULL,
  domain_restriction  text[],
  enforce_sso         boolean DEFAULT false,
  auto_provision      boolean DEFAULT true,
  default_role        text DEFAULT 'team_member',
  configured_by       uuid REFERENCES tenant_members(id),
  configured_at       timestamptz DEFAULT now(),
  last_used_at        timestamptz
);
```

## 31.2 Calendar Sync (Bidirectional)
`CalendarSyncWorker` (Inngest) — push events to tenants' Google/Outlook on create/update/delete; pull busy slots for vendor conflict detection; webhook subscriptions for instant updates.

## 31.3 CRM Sync
```sql
CREATE TABLE tenant_crm_integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('salesforce','hubspot','zoho_crm','pipedrive','freshsales')),
  access_token_encrypted bytea NOT NULL,
  refresh_token_encrypted bytea,
  token_expires_at timestamptz,
  workspace_id    text,
  sync_direction  text DEFAULT 'two_way' CHECK (sync_direction IN ('to_crm','from_crm','two_way')),
  field_mapping   jsonb NOT NULL,
  last_synced_at  timestamptz,
  status          text DEFAULT 'active' CHECK (status IN ('active','expired','disconnected','error')),
  created_at      timestamptz DEFAULT now()
);
```
Tenant clients ↔ CRM contacts/accounts. Event status → deal stage. Quote → opportunity.

## 31.4 Accounting Sync
Same pattern for QuickBooks · Tally · Zoho Books · Xero · Wave. Invoices, payments, refunds, vendor bills auto-flow to tenant's accounting system.

## 31.5 Google Sheets Sync
Per-event sync of guests, vendors, runsheet, budget, payments. Two-way support via OAuth.

## 31.6 Slack / MS Teams
```sql
CREATE TABLE tenant_messaging_integrations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid REFERENCES tenants(id) ON DELETE CASCADE,
  provider           text NOT NULL CHECK (provider IN ('slack','microsoft_teams')),
  webhook_url_encrypted bytea NOT NULL,
  channel_name       text,
  workspace_name     text,
  subscribed_events  text[] NOT NULL,
  per_event_routing  jsonb,
  configured_by      uuid REFERENCES tenant_members(id),
  status             text DEFAULT 'active' CHECK (status IN ('active','error','disconnected')),
  created_at         timestamptz DEFAULT now()
);
```

## 31.7 Zapier / Make / n8n via OAuth App
```sql
CREATE TABLE tenant_oauth_apps (...);     -- public OAuth app
CREATE TABLE oauth_authorization_codes (...);
CREATE TABLE oauth_access_tokens (...);
```
Published Zapier app marketplace-level. Tenants authorize via OAuth.

## 31.8 Webhook IP Allowlist (Outgoing — SSRF Guard)
`outgoing_webhook_subscriptions.allowed_ips inet[]`. Worker resolves destination DNS and validates IP before POST. Blocks DNS rebinding to internal/private addresses.

---

# PART 32 — SUPER ADMIN ANALYTICS

## 32.1 Tenant Health Score
```sql
CREATE TABLE tenant_health_scores (
  tenant_id                uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  overall_score            numeric(5,2) CHECK (overall_score BETWEEN 0 AND 100),
  product_engagement_score numeric(5,2),
  team_engagement_score    numeric(5,2),
  financial_health_score   numeric(5,2),
  support_health_score     numeric(5,2),
  growth_score             numeric(5,2),
  churn_risk_level         text CHECK (churn_risk_level IN ('low','medium','high','critical')),
  churn_risk_reasons       text[],
  last_login_at            timestamptz,
  days_since_last_event    integer,
  ticket_count_30d         integer,
  failed_payment_count     integer,
  trial_extension_count    integer,
  computed_at              timestamptz DEFAULT now()
);
CREATE INDEX idx_tenant_health_risk ON tenant_health_scores (churn_risk_level, overall_score);
```
Weighted formula `0.3 × product + 0.2 × team + 0.25 × financial + 0.15 × support + 0.1 × growth`. Risk levels: low ≥70, medium 50–69, high 30–49, critical <30 or 30d-no-login.

## 32.2 Cohort Analysis
```sql
CREATE TABLE tenant_cohort_metrics (
  cohort_month        date NOT NULL,
  measurement_month   date NOT NULL,
  tenants_signed_up   integer,
  tenants_converted   integer,
  tenants_still_active integer,
  tenants_churned     integer,
  total_mrr           numeric(14,2),
  total_arr           numeric(14,2),
  net_revenue_retention numeric(5,2),
  gross_revenue_retention numeric(5,2),
  PRIMARY KEY (cohort_month, measurement_month)
);
```
Weekly `CohortAnalyzer`. Heat-map retention + NRR/GRR trends.

## 32.3 Churn Prediction (Year 2)
ML model on tenant_health_scores time series + churn/retention labels. Surfaces to Sales for proactive outreach.

## 32.4 Revenue Analytics
13 metrics: MRR · ARR · ARPU · New MRR · Expansion MRR · Contraction MRR · Churned MRR · Net New MRR · LTV · CAC · CAC Payback · DSO · failed-payment + chargeback rates.

---

# PART 33 — UI/UX DESIGN SYSTEM & THEME CONTROL

## 33.1 Design Principles
- **Professional, not prototype** — every screen ships production-grade
- **Strong layer contrast** — page canvas always visibly distinct from card surfaces
- **Brand colours are accents, not fills** — coral/amber for actions, neutrals for surfaces
- **Consistent** — design system applied uniformly across all 6 portals
- **Accessible** — WCAG 2.2 AA on Day 1
- **Performant** — every interaction <100ms perceived
- **Dark mode** — first-class, not afterthought

## 33.2 Confirmed Brand Palette

| Token | Hex | Use |
|-------|-----|-----|
| `brand_primary` | `#CA4B32` | Primary CTAs, links, focus rings |
| `brand_primary_dark` | `#DD6850` | Primary CTAs in dark mode |
| `brand_secondary` | `#E2A528` | Premium-tier badges, highlights |
| `brand_gradient` | `135° #E2A528 → #CA4B32` | Logo, splash, hero only |
| `success` | `#10B981` | Confirmed states |
| `warning` | `#EAB308` | Warning states (shifted yellow to avoid brand collision) |
| `danger` | `#DC2626` | Destructive states (shifted red to avoid brand collision) |
| `info` | `#3B82F6` | Informational states |

## 33.3 Light-Mode Surfaces (Confirmed)
| Token | Hex | Role |
|-------|-----|------|
| `page_bg` | `#EDF0F4` | Outermost canvas |
| `sidebar_bg` | `#F7F9FB` | Persistent nav |
| `card_bg` | `#FFFFFF` | Cards, panels |
| `hover_bg` | `#F1F4F8` | Hover state on rows |
| `border` | `#D5DAE0` | Default divider |
| `text_primary` | `#0F1115` | Main text |
| `text_secondary` | `#4A5260` | Supporting text |
| `text_tertiary` | `#6C7380` | Hint text |

## 33.4 Dark-Mode Surfaces (Confirmed)
| Token | Hex | Role |
|-------|-----|------|
| `page_bg` | `#04050A` | Outermost canvas |
| `sidebar_bg` | `#0E1015` | Persistent nav |
| `card_bg` | `#1B1E25` | Cards, panels |
| `hover_bg` | `#252932` | Hover state |
| `border` | `#2D3138` | Default divider |
| `text_primary` | `#F4F5F8` | Main text |
| `text_secondary` | `#A0A6B0` | Supporting text |
| `text_tertiary` | `#6C7380` | Hint text |

Lightness gap page→card: ~6% light · ~10% dark — ensures cards visibly sit on canvas.

## 33.5 Component Library
ShadCN UI + Radix primitives. Custom components: empty-state cards · activity-feed cards · status pills (semantic) · skeleton loaders · toast notifications (Sonner) · dialog/modal · data tables (resize/sort/filter/multi-select) · timezone-aware date pickers · currency input · E.164 phone input · rich-text editor (Tiptap).

## 33.6 Icon System
**Phosphor Icons** (primary) + **Lucide React** (fallback). Outline weights only. No emojis. No prototype icons.

## 33.7 Typography
- Sans: **Inter** (Latin) + **Noto Sans** (Indic)
- Serif: **Fraunces** (display, invitations only)
- Mono: **JetBrains Mono**
- Scale (1.25 ratio): 12 · 14 · 16 · 18 · 20 · 24 · 30 · 36 · 48 · 60 px
- Weights: 400 regular · 500 medium · 600 semibold (sparingly)

## 33.8 Spacing & Motion
4px base. Tailwind scale. Transitions: 150ms (small) / 250ms (medium) / 400ms (large), all `ease-out`. Focus ring: 2px brand_primary at 2px offset. `prefers-reduced-motion` disables all motion.

## 33.9 Layout Templates Per Portal
- Super Admin → top nav + collapsed sidebar + content + right rail (audit/preview)
- Company Admin / Event Manager → sidebar + breadcrumb + content + right rail (presence/activity)
- Client → tab nav per event + minimal chrome
- Vendor → sidebar + assignment-centric view
- Guest → mobile-first single-column + bottom nav
- Public Event Website → tenant-themed, no portal chrome

## 33.10 Platform Theme Control System (NEW)

### 33.10.1 Schemas

```sql
CREATE TABLE platform_theme_config (
  id                          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Brand
  brand_primary               text NOT NULL DEFAULT '#CA4B32',
  brand_primary_dark          text NOT NULL DEFAULT '#DD6850',
  brand_secondary             text NOT NULL DEFAULT '#E2A528',
  brand_gradient_start        text NOT NULL DEFAULT '#E2A528',
  brand_gradient_end          text NOT NULL DEFAULT '#CA4B32',
  brand_gradient_angle        integer NOT NULL DEFAULT 135,
  -- Semantic
  color_success               text NOT NULL DEFAULT '#10B981',
  color_warning               text NOT NULL DEFAULT '#EAB308',
  color_danger                text NOT NULL DEFAULT '#DC2626',
  color_info                  text NOT NULL DEFAULT '#3B82F6',
  -- Light surfaces
  light_page_bg               text NOT NULL DEFAULT '#EDF0F4',
  light_sidebar_bg            text NOT NULL DEFAULT '#F7F9FB',
  light_card_bg               text NOT NULL DEFAULT '#FFFFFF',
  light_hover_bg              text NOT NULL DEFAULT '#F1F4F8',
  light_border_default        text NOT NULL DEFAULT '#D5DAE0',
  light_text_primary          text NOT NULL DEFAULT '#0F1115',
  light_text_secondary        text NOT NULL DEFAULT '#4A5260',
  light_text_tertiary         text NOT NULL DEFAULT '#6C7380',
  -- Dark surfaces
  dark_page_bg                text NOT NULL DEFAULT '#04050A',
  dark_sidebar_bg             text NOT NULL DEFAULT '#0E1015',
  dark_card_bg                text NOT NULL DEFAULT '#1B1E25',
  dark_hover_bg               text NOT NULL DEFAULT '#252932',
  dark_border_default         text NOT NULL DEFAULT '#2D3138',
  dark_text_primary           text NOT NULL DEFAULT '#F4F5F8',
  dark_text_secondary         text NOT NULL DEFAULT '#A0A6B0',
  dark_text_tertiary          text NOT NULL DEFAULT '#6C7380',
  -- Typography
  font_family_sans            text NOT NULL DEFAULT 'Inter, Noto Sans, system-ui, sans-serif',
  font_family_serif           text NOT NULL DEFAULT 'Fraunces, Georgia, serif',
  font_family_mono            text NOT NULL DEFAULT 'JetBrains Mono, ui-monospace, monospace',
  -- Radius scale
  radius_sm                   integer NOT NULL DEFAULT 6,
  radius_md                   integer NOT NULL DEFAULT 8,
  radius_lg                   integer NOT NULL DEFAULT 12,
  radius_xl                   integer NOT NULL DEFAULT 16,
  -- Default mode
  default_theme_mode          text NOT NULL DEFAULT 'auto' CHECK (default_theme_mode IN ('light','dark','auto')),
  -- Lifecycle
  version                     integer NOT NULL DEFAULT 1,
  status                      text NOT NULL DEFAULT 'live' CHECK (status IN ('draft','staged','live','rollback')),
  draft_started_at            timestamptz,
  staged_at                   timestamptz,
  published_at                timestamptz,
  rolled_back_at              timestamptz,
  draft_by                    uuid REFERENCES super_admins(id),
  approved_by                 uuid REFERENCES super_admins(id),
  updated_at                  timestamptz DEFAULT now()
);

CREATE TABLE platform_theme_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version         integer NOT NULL,
  snapshot        jsonb NOT NULL,
  changed_by      uuid REFERENCES super_admins(id),
  reason          text,
  published_at    timestamptz DEFAULT now()
);
CREATE INDEX idx_theme_history_version ON platform_theme_history (version DESC);
```

### 33.10.2 Tenant White-Label Override Schemas

```sql
ALTER TABLE tenants
  ADD COLUMN brand_primary_override text,
  ADD COLUMN brand_secondary_override text,
  ADD COLUMN brand_gradient_start_override text,
  ADD COLUMN brand_gradient_end_override text,
  ADD COLUMN guest_portal_theme_override jsonb,
  ADD COLUMN public_website_theme_override jsonb,
  ADD COLUMN invitation_default_theme_override jsonb,
  ADD CONSTRAINT brand_primary_hex_override
    CHECK (brand_primary_override IS NULL OR brand_primary_override ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT brand_secondary_hex_override
    CHECK (brand_secondary_override IS NULL OR brand_secondary_override ~ '^#[0-9A-Fa-f]{6}$');
```

**Override scope (tenant white-label, Pro+ only):**
- ✓ Guest Portal (hero gradient, CTAs, accent)
- ✓ Public Event Website (custom theme)
- ✓ Invitation builder default theme
- ✓ Branded email sender colours
- ✓ Branded PDF exports (invoice, badges, reports)
- ✗ Tenant staff sees platform theme (Company Admin, Event Manager)
- ✗ Client and Vendor portals show platform theme

### 33.10.3 State Machine

```
[ live ] ──edit──▶ [ draft ] ──promote──▶ [ staged ] ──promote*──▶ [ live (new version) ]
   ▲                  │                       │                          │
   │                  ▼                       ▼                          │
   │             [ discard ]              [ discard ]                    │
   └────────── rollback ─────────────────────────────────────────────────┘
                                                                          │
* requires 2-person approval (Sole Operator Mode bypasses)               │
  AND `auto_disable_sole_operator_mode` not active                       │
                                                                          │
  Auto-rollback if FE error rate >5% within 30 min of publish ───────────┘
```

### 33.10.4 Distribution to Clients

- Theme config served via `GET /api/v1/theme` — cached at Cloudflare edge with `Cache-Control: public, max-age=60, s-maxage=60`
- Frontend reads on app boot + every 5 min refresh
- Live updates via Supabase Realtime channel `platform_theme:changes`
- CSS custom properties hot-swap without page reload via `theme-change` event listener
- All ramps (50/100/.../900) auto-derived from base hex via Culori; cached client-side

### 33.10.5 Safeguards

- Edits saved to `draft` first; preview pane renders Workspace Owner dashboard + Guest Portal + Invoice PDF in proposed colours
- Promote to `staged` applies dev + staging only
- Promote `staged → live` requires **2-person Super Admin approval** (per Part 2.9.4 dual-control)
- Sole Operator Mode bypasses 2-person requirement
- Every change writes a row in `platform_theme_history` — instant revert via `POST /admin/theme/rollback`
- Auto-rollback if frontend error rate spikes >5% within 30 min of publish (telemetry-driven via Sentry)
- All changes audit-logged with `severity = 'critical'` and `actor_role` recorded
- Visual regression tests run on staging promotion (12 representative screens × light/dark = 24 image diffs)

### 33.10.6 Tenant White-Label Editor (Workspace Owner)
- Available on Pro+ with `white_label_eligible = true`
- Settings → Branding → tenant edits `brand_primary_override` + `guest_portal_theme_override`
- Live preview of Guest Portal + Public Event Website + Invitation
- Saves immediately (no staging — tenant-scoped, blast radius limited to their workspace)
- Audit-logged in tenant's audit_log
- Reset to platform default via "Reset" button

## 33.11 UI Quality Gates (Production Standards)

Every screen ships only after passing:
- **Layout integrity** — no overlapping elements, all components fit in their containers, sticky elements never block content
- **Contrast ratios** — text ≥4.5:1, UI ≥3:1 (axe-core enforces)
- **State coverage** — empty, loading, error, hover, active, focus, disabled all designed
- **Responsive** — works from 320px → 2560px without horizontal scroll
- **Touch targets** — ≥44×44px on mobile, ≥32×32px on desktop
- **Lighthouse score** — Perf/A11y/Best-practices ≥95
- **Visual regression** — Playwright screenshots compared to baseline
- **Real device** — tested on actual iPhone SE, Pixel 5, iPad, MacBook, 27" desktop

## 33.12 Sample UI Library

Mockups produced for every portal (light + dark): Login · Workspace Owner Dashboard · Event Detail (presence + activity feed) · Floor Plan editor · Guest Portal mobile · Client Portal (events + expenses + e-sig) · Vendor Portal (assignments + calendar + crew) · Super Admin (tenant list + health scores + theme editor).

---

# PART 34 — CORE SCHEMA REFERENCE & MIGRATION ORDER

## 34.0 Migration Order (12 Dependency-Sorted Phases)

### Phase 1 — Foundational (no tenant deps)
```
super_admins
super_admin_role_permissions
platform_settings
platform_theme_config          ← NEW
platform_theme_history         ← NEW
super_admin_approvals
feature_flags
subscription_plans
plan_feature_flags
storage_addons_catalog
addons_catalog
event_types (system rows)
event_type_readiness_items (system rows)
event_templates (system kits)
currency_rates
whatsapp_templates (platform-owned)
help_content
brand_impersonation_alerts
sub_processor_incidents
```
Triggers: `auto_disable_sole_operator_mode()` on `super_admins`.

### Phase 2 — Tenancy
```
tenants                         (incl. white_label override cols ← NEW)
tenant_members
tenant_subscriptions
tenant_signup_attempts
tenant_slug_aliases
tenant_feature_overrides
tenant_api_keys
tenant_custom_domains
tenant_external_storage
tenant_storage_addons
tenant_addons
tenant_payment_methods
tenant_invoice_recipients
tenant_data_exports
tenant_transfer_requests
tenant_sso_config
tenant_crm_integrations
tenant_accounting_integrations
tenant_sheets_syncs
tenant_messaging_integrations
tenant_oauth_apps
tenant_member_external_calendars
module_permissions
member_permission_overrides
team_invitations
super_admin_impersonation
pending_emergency_transfers
auth_sessions
email_daily_quota
oauth_provider_links
magic_links
account_recovery_codes
purchase_orders
revenue_recognition_entries
revenue_recognition_monthly
dunning_events
subscription_pauses
chargebacks
tenant_health_scores
tenant_cohort_metrics
app_ddos_signals
oauth_authorization_codes
oauth_access_tokens
custom_domain_health_checks
bulk_operation_quota
```

### Phase 3 — Events
```
events
event_subteams
event_subteam_members
event_readiness_state
event_websites
event_tickets
sessions
event_offload_jobs
event_edit_sessions
event_activity_feed
comments
inventory_items
inventory_allocations
inventory_audits
crew_pool
event_crew_assignments
shared_inbox_messages
vendor_quotes
guest_plus_ones
rsvp_change_requests
```

### Phase 4 — Cross-Tenant Accounts
```
client_accounts
vendor_accounts
speaker_accounts
client_event_access
client_documents
vendor_event_assignments
speaker_event_assignments
vendor_external_calendars
vendor_calendar_events
vendor_crew_members
vendor_crew_assignments
vendor_invoice_templates
vendor_portfolios
vendor_reviews
```

### Phase 5 — Operations & Guests
```
guests
guest_otps
guest_refresh_tokens
floor_plans
floor_plan_tables
floor_plan_table_guests
runsheet_tasks
runsheet_locks
runsheet_versions
invitations
```

### Phase 6 — Finance
```
invoices
payments
vendor_payouts
```

### Phase 7 — Storage
```
storage_objects
storage_archive_events
storage_cleanup_suggestions
```

### Phase 8 — Communications & Links
```
short_links
short_link_clicks
whatsapp_messages
notifications
notification_deliveries
notification_preferences
onboarding_state
```

### Phase 9 — Integrations
```
outgoing_webhook_subscriptions
outgoing_webhook_deliveries
incoming_webhook_log
```

### Phase 10 — Support & Audit
```
support_faqs
support_tickets
audit_log (partitioned; monthly partitions auto-created)
```

### Phase 11 — Triggers & Functions
After all tables exist, install all triggers and SQL functions including theme distribution hooks, cycle prevention, audit writers, soft-delete cascades.

### Phase 12 — Materialized Views, RLS, Seed Data
- Materialized views: `tenant_active_event_counts`, `client_expense_view`
- Views: `tenant_effective_quotas`, `my_assigned_tasks`
- All RLS policies (Part 19.2)
- Seeds: 15 system event types · 10 event templates · default plans · feature flags · 5 storage add-ons · capacity/feature add-ons · WhatsApp templates · help_content · **default `platform_theme_config` row with confirmed v2 palette** · first Super Admin via secure bootstrap

---

# DOCUMENT SUMMARY

OccasionPro Master Plan v2 — Production-Ready Specification

**34 Parts** covering every layer: vision · tech stack · power model (Super Admin 7 roles + Sole Operator Mode + tenant + members) · tenant lifecycle with full billing (PO, NET-30, dunning, revenue recognition, currency lock, chargeback, pause, proration, backup card, invoice email) · events with lifecycle + templates + bulk-op throttles · communication (email/SMS DLT/WhatsApp/short links/cookie/session) · guest portal (mobile OTP + email fallback + +1 + RSVP change) · cross-tenant portals (client multi-event + expenses + e-sig; vendor calendar + crew + portfolio + invoice; speaker) · operations (floor plan + runsheet + F&B + inventory + crew + shared inbox + vendor approval) · conference · post-event · mobile · exports · realtime (postgres_changes + presence + broadcast + activity feed + diff + @mentions + concurrent edit conflict UI) · notifications · webhooks (incoming + outgoing with IP allowlist) · support · finance · storage with isolation + grace flow + cloud offload · security (social login + magic link + recovery codes + device mgmt + constant-time + brand impersonation + subdomain takeover + app-layer DDoS + sub-processor breach + DMARC) · CI/CD · observability · DR · testing · compliance · public API · i18n · accessibility · performance · cost model · onboarding (tour + demo data + templates + email sequence + contextual help + empty states) · integrations (SSO + calendar sync + CRM + accounting + Sheets + Slack/Teams + Zapier + webhook IP allowlist) · Super Admin analytics (tenant health + cohort + churn prediction + revenue) · **UI/UX design system & platform theme control (confirmed amber→coral brand palette · `platform_theme_config` · `platform_theme_history` · tenant white-label overrides · UI quality gates)** · core schema reference & migration order (12 phases, dependency-sorted, includes theme tables in Phase 1).

Every variable cost has 3–10× markup. Every metered resource has hard cap requiring explicit purchase. Trial limits prevent abuse without insulting users. Currency and tax locked at signup. No plan ever costs >20% of revenue in worst case. Every table has FK indexes, CHECK constraints, soft-delete columns, partitioning where needed. Migration order strictly defined. RLS policies + immutable audit log + per-tenant isolation + polymorphic FK guards.

**Production-ready. Buildable. Deployable. Zero issues during build and deployment.**

*End of OccasionPro Master Plan v2.*
