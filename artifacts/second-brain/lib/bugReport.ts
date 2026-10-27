import type { RuntimeMetric } from "@/lib/runtimeDiagnostics";

export const MAX_BUG_REPORT_EVENTS = 20;
export const MAX_BUG_REPORT_BYTES = 8 * 1024;

const EVENT_CATEGORIES: Record<string, string> = {
  "inference.load": "model_load",
  "inference.completion": "inference_complete",
  "inference.failure": "inference_failure",
};

const ENGINE_STATUSES = new Set([
  "ready",
  "no-model",
  "loading",
  "error",
  "unsupported",
]);

export type PrivacySafeBugReport = {
  formatVersion: 1;
  createdAt: string;
  app: {
    name: "Demi";
    version: string | null;
    build: string | null;
  };
  device: {
    platform: "android" | "ios" | "web" | "other";
    osVersion: string | null;
  };
  diagnostics: {
    modelStatus: string;
    events: {
      category: string;
      durationMs: number | null;
      ageMinutes: number | null;
    }[];
  };
};

export type BugReportInput = {
  appVersion?: unknown;
  appBuild?: unknown;
  platform?: unknown;
  osVersion?: unknown;
  modelStatus?: unknown;
  metrics?: RuntimeMetric[];
  now?: number;
};

function safeVersion(value: unknown) {
  if (typeof value !== "string" || value.length > 48) return null;
  return /^[A-Za-z0-9][A-Za-z0-9.+_-]*$/.test(value) ? value : null;
}

function safeBuild(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "string" && /^\d{1,16}$/.test(value)) return value;
  return null;
}

function safePlatform(value: unknown): PrivacySafeBugReport["device"]["platform"] {
  if (value === "android" || value === "ios" || value === "web") return value;
  return "other";
}

function safeOsVersion(value: unknown) {
  if (
    (typeof value === "string" || typeof value === "number") &&
    String(value).length <= 32 &&
    /^\d+(?:\.\d+){0,3}$/.test(String(value))
  ) {
    return String(value);
  }
  return null;
}

function safeModelStatus(value: unknown) {
  return typeof value === "string" && ENGINE_STATUSES.has(value)
    ? value
    : "unknown";
}

function safeDuration(metric: RuntimeMetric) {
  const candidate =
    metric.name === "inference.failure"
      ? metric.details?.durationMs
      : metric.durationMs;
  return typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate >= 0 &&
    candidate <= 30 * 60 * 1000
    ? Math.round(candidate)
    : null;
}

export function createPrivacySafeBugReport(
  input: BugReportInput,
): PrivacySafeBugReport {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const events = (input.metrics ?? [])
    .filter(
      (metric) =>
        Object.prototype.hasOwnProperty.call(EVENT_CATEGORIES, metric.name),
    )
    .slice(-MAX_BUG_REPORT_EVENTS)
    .map((metric) => {
      const recordedAt = metric.recordedAt;
      const ageMinutes =
        Number.isFinite(recordedAt) && recordedAt <= now
          ? Math.min(7 * 24 * 60, Math.floor((now - recordedAt) / 60_000))
          : null;
      return {
        category: EVENT_CATEGORIES[metric.name],
        durationMs: safeDuration(metric),
        ageMinutes,
      };
    });

  return {
    formatVersion: 1,
    createdAt: new Date(now).toISOString(),
    app: {
      name: "Demi",
      version: safeVersion(input.appVersion),
      build: safeBuild(input.appBuild),
    },
    device: {
      platform: safePlatform(input.platform),
      osVersion: safeOsVersion(input.osVersion),
    },
    diagnostics: {
      modelStatus: safeModelStatus(input.modelStatus),
      events,
    },
  };
}

export function serializePrivacySafeBugReport(report: PrivacySafeBugReport) {
  const content = `${JSON.stringify(report, null, 2)}\n`;
  if (content.length > MAX_BUG_REPORT_BYTES) {
    throw new Error("Bug report exceeded its size limit.");
  }
  return content;
}
