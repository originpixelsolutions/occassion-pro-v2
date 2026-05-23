/**
 * Observability hooks (Part 21.1 of the master plan).
 *
 * Sentry + PostHog + BetterStack + Grafana Cloud are wired here as
 * lazy initialisers. When their env vars are missing, the stubs are
 * silent no-ops — production gets real telemetry, dev / CI run quietly.
 *
 * Spec refs: 21.1, 21.2 (key metrics), 21.3 (SLAs).
 */
import { initSentry } from './sentry.js';
import { initPosthog } from './posthog.js';
import { initBetterStack } from './betterstack.js';
import { initGrafana } from './grafana.js';

let initialised = false;

export function initObservability(env: NodeJS.ProcessEnv = process.env): void {
  if (initialised) return;
  initSentry(env);
  initPosthog(env);
  initBetterStack(env);
  initGrafana(env);
  initialised = true;
}

export * from './sentry.js';
export * from './posthog.js';
export * from './betterstack.js';
export * from './grafana.js';
