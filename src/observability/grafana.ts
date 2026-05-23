/**
 * Grafana Cloud OTLP exporter stub. The Phase-1 stub records the
 * endpoint + token; OpenTelemetry SDK wiring lands in Phase 2 next to
 * the Workers + Next.js bootstraps.
 */
let endpoint: string | undefined;

export function initGrafana(env: NodeJS.ProcessEnv): void {
  endpoint = env.GRAFANA_OTLP_ENDPOINT;
  if (!endpoint) return;
  // TODO(phase-2): new OTLPTraceExporter({ url: endpoint, headers: { Authorization: `Basic ${env.GRAFANA_OTLP_TOKEN}` } })
}

export function recordMetric(
  name: string,
  value: number,
  attrs: Record<string, string> = {},
): void {
  if (!endpoint) return;
  void name;
  void value;
  void attrs;
}
