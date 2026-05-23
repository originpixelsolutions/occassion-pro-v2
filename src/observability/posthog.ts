/**
 * PostHog init stub. Real `posthog-node` wires server-side product
 * events; `posthog-js` lands in the Next.js shell.
 */
let key: string | undefined;

export function initPosthog(env: NodeJS.ProcessEnv): void {
  key = env.POSTHOG_API_KEY;
  if (!key) return;
  // TODO(phase-2): new PostHog(key, { host: env.POSTHOG_HOST })
}

export function track(event: string, props: Record<string, unknown> = {}): void {
  if (!key) return;
  void event;
  void props;
}
