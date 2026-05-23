# OccasionPro v2

Multi-tenant event-management SaaS. Built strictly to
[`OCCASIONPRO_MASTER_PLAN_V2.md`](./OCCASIONPRO_MASTER_PLAN_V2.md) — the
document is the contract.

## Stack

Next.js 14 App Router + TypeScript + Tailwind + ShadCN on Cloudflare Pages ·
Cloudflare Workers + Hono · Supabase Postgres / Auth / Realtime · Drizzle ORM
(RLS-aware) · Inngest + Cloudflare Queues · Cloudflare R2 · Razorpay + Stripe ·
Resend · Sentry · PostHog · BetterStack · Grafana Cloud · WorkOS · DocuSign /
Signwell.

## Local dev

```bash
npm install
cp .env.example .env.local   # fill in what you have
npm run test                 # all DB + observability tests on pglite
npm run gate                 # full deploy gate locally
```

## Deploy gate (Part 20.2)

`npm run gate` runs the same checks as CI:

- ESLint (`npm run lint`)
- Prettier (`npm run format:check`)
- SQLFluff Postgres dialect (`npm run lint:sql`) — requires
  `pip install sqlfluff`
- `tsc --noEmit` (`npm run typecheck`)
- Vitest unit + RLS pair (`npm run test`)
- `npm audit --audit-level=high`

CI also runs Trivy filesystem scan + migration dry-run vs pglite. Branch
protection on `main`: 1 approval, green CI, up-to-date, squash-only.

## Build progress

The autonomous build appends to [`build-log.jsonl`](./build-log.jsonl) at the
end of every unit. The mission-control dashboard
([`build-dashboard.html`](./build-dashboard.html)) polls this file every 4 s.

## Credentials still needed

These environments need real values; until you fill them in, observability and
deploys are no-ops:

| Env var                                        | Where it comes from             |
| ---------------------------------------------- | ------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`                    | Supabase dashboard → API        |
| `NEXT_PUBLIC_SUPABASE_URL`                     | Supabase dashboard → API        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                | Supabase dashboard → API        |
| `SENTRY_DSN`                                   | Sentry project → settings       |
| `POSTHOG_API_KEY`                              | PostHog → project API keys      |
| `BETTERSTACK_HEARTBEAT_URL`                    | BetterStack Uptime → heartbeats |
| `GRAFANA_OTLP_ENDPOINT` + `GRAFANA_OTLP_TOKEN` | Grafana Cloud → OTLP            |
| `RAZORPAY_KEY_ID/SECRET`, `STRIPE_SECRET_KEY`  | Payment dashboards              |
| `RESEND_API_KEY`                               | Resend                          |
| `R2_*`                                         | Cloudflare R2                   |
| `WORKOS_*`, `DOCUSIGN_*`, `SIGNWELL_*`         | Respective dashboards           |

Also needed (one-time):

- **GitHub repo** + `/mcp` OAuth for the github plugin so I can push commits.
- **Supabase projects** for `dev`, `staging`, `production` — fill the
  `project_ref` in `supabase/environments/*.toml`.
- **Cloudflare zone** for `occasionpro.in` — referenced by `wrangler.toml`.

## File map

```
supabase/migrations/   timestamped SQL migrations (Part 20.3)
supabase/config.toml   Supabase CLI base config
supabase/environments/ per-env overrides (dev / staging / production)
src/db/                Drizzle schema (1:1 mirror of migrations)
src/observability/     Sentry / PostHog / BetterStack / Grafana stubs
tests/db/              constraint + RLS pair coverage per table
tests/observability/   stub smoke tests
.github/workflows/     CI deploy gate
eslint.config.js       lint rules
.prettierrc.json       formatter
.sqlfluff              SQL lint config (Postgres dialect)
wrangler.toml          Cloudflare Workers config
```
