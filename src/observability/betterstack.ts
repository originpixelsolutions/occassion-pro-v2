/**
 * BetterStack heartbeat stub. The Phase-1 stub records the URL; the
 * actual fetch goes out from a Cloudflare cron worker in Phase 2.
 */
let heartbeatUrl: string | undefined;

export function initBetterStack(env: NodeJS.ProcessEnv): void {
  heartbeatUrl = env.BETTERSTACK_HEARTBEAT_URL;
}

export async function heartbeat(): Promise<void> {
  if (!heartbeatUrl) return;
  // TODO(phase-2): await fetch(heartbeatUrl, { method: 'POST' })
}
