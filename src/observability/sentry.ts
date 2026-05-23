/**
 * Sentry init stub. Real `@sentry/nextjs` and `@sentry/cloudflare`
 * wires land in Phase 2 once the app shell exists. For now the stub
 * records the DSN so `initObservability()` is callable from day one.
 */
let dsn: string | undefined;

export function initSentry(env: NodeJS.ProcessEnv): void {
  dsn = env.SENTRY_DSN;
  if (!dsn) return;
  // TODO(phase-2): Sentry.init({ dsn, tracesSampleRate: ..., environment: env.APP_ENV });
}

export function captureException(err: unknown, ctx: Record<string, unknown> = {}): void {
  if (!dsn) return;
  // TODO(phase-2): Sentry.captureException(err, { extra: ctx });
  void err;
  void ctx;
}
