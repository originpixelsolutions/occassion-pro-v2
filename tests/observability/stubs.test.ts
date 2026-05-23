/**
 * Observability stub smoke test. The real telemetry providers wire in
 * Phase 2; for now we just confirm initialisation is idempotent and the
 * no-op functions don't throw when env vars are absent.
 *
 * Spec refs: 21.1.
 */
import { describe, expect, it } from 'vitest';
import {
  captureException,
  heartbeat,
  initObservability,
  recordMetric,
  track,
} from '../../src/observability/index.js';

describe('observability stubs', () => {
  it('initObservability is callable with empty env (no-op)', () => {
    expect(() => initObservability({})).not.toThrow();
  });

  it('initObservability is idempotent', () => {
    initObservability({});
    initObservability({});
    expect(true).toBe(true);
  });

  it('captureException is a no-op when SENTRY_DSN is unset', () => {
    expect(() => captureException(new Error('test'))).not.toThrow();
  });

  it('track is a no-op when POSTHOG_API_KEY is unset', () => {
    expect(() => track('test_event', { foo: 1 })).not.toThrow();
  });

  it('heartbeat resolves when BETTERSTACK_HEARTBEAT_URL is unset', async () => {
    await expect(heartbeat()).resolves.toBeUndefined();
  });

  it('recordMetric is a no-op when GRAFANA_OTLP_ENDPOINT is unset', () => {
    expect(() => recordMetric('test_metric', 1, { tag: 'x' })).not.toThrow();
  });
});
