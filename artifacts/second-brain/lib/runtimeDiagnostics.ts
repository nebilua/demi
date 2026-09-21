export type RuntimeMetric = {
  name: string;
  durationMs: number | null;
  count?: number;
  details?: Record<string, string | number | boolean>;
  recordedAt: number;
};

const MAX_RUNTIME_METRICS = 100;
const metrics: RuntimeMetric[] = [];

function now() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function isDevelopment() {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

export function recordRuntimeMetric(
  name: string,
  durationMs: number | null,
  details?: RuntimeMetric["details"],
) {
  const metric: RuntimeMetric = {
    name,
    durationMs:
      durationMs === null ? null : Math.max(0, Number(durationMs.toFixed(2))),
    details,
    recordedAt: Date.now(),
  };
  metrics.push(metric);
  if (metrics.length > MAX_RUNTIME_METRICS) metrics.shift();
  if (isDevelopment()) {
    console.info(`[runtime] ${name}`, {
      durationMs: metric.durationMs,
      ...details,
    });
  }
}

export function recordRuntimeEvent(
  name: string,
  details?: RuntimeMetric["details"],
) {
  recordRuntimeMetric(name, null, details);
}

export function startRuntimeMetric(
  name: string,
  details?: RuntimeMetric["details"],
) {
  const startedAt = now();
  return (completionDetails?: RuntimeMetric["details"]) => {
    recordRuntimeMetric(name, now() - startedAt, {
      ...details,
      ...completionDetails,
    });
  };
}

export function getRuntimeDiagnostics() {
  return metrics.slice();
}

export function resetRuntimeDiagnostics() {
  metrics.length = 0;
}