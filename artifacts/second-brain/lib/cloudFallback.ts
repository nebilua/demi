import {
  isCapabilityActive,
  redactPrivacyText,
  type PrivacyState,
} from "@/lib/privacyCapabilities";

export type CloudTask = "chat" | "research";

export type CloudFallbackReason =
  | "local-engine-unavailable"
  | "device-budget-exceeded"
  | "local-runtime-failure";

export type CloudProgress =
  | "checking-provider"
  | "provider-unavailable"
  | "sending-minimized-request"
  | "receiving-response"
  | "completed"
  | "cancelled"
  | "timed-out"
  | "quota"
  | "failed"
  | "blocked";

export type CloudFallbackActivity = {
  task: CloudTask;
  status: CloudProgress;
  message: string;
};

export const CLOUD_FALLBACK_LIMITS = {
  maxInputChars: 1_800,
  maxOutputChars: 6_000,
  timeoutMs: 25_000,
} as const;

export type CloudRequest = {
  task: CloudTask;
  reason: CloudFallbackReason;
  input: string;
};

export type InferenceRoute =
  | { kind: "local" }
  | { kind: "cloud"; reason: CloudFallbackReason }
  | { kind: "blocked"; reason: "privacy" | "provider-not-approved" | "local-not-available" };

export function decideInferenceRoute(input: {
  localAllowed: boolean;
  localAvailable: boolean;
  cloudAllowed: boolean;
  localFailureEligible?: boolean;
}): InferenceRoute {
  if (!input.localAllowed) return { kind: "blocked", reason: "privacy" };
  if (input.localAvailable) return { kind: "local" };
  if (!input.cloudAllowed) {
    return { kind: "blocked", reason: "provider-not-approved" };
  }
  return {
    kind: "cloud",
    reason: input.localFailureEligible
      ? "local-runtime-failure"
      : "local-engine-unavailable",
  };
}

export function getCloudFallbackPermission(
  state: PrivacyState,
  privacyReady: boolean,
) {
  if (!privacyReady) {
    return { allowed: false as const, reason: "privacy-not-ready" as const };
  }
  if (state.globalPause) {
    return { allowed: false as const, reason: "privacy-paused" as const };
  }
  if (!isCapabilityActive(state, "local.inference")) {
    return { allowed: false as const, reason: "local-inference-blocked" as const };
  }
  if (!isCapabilityActive(state, "network.remote-inference")) {
    return { allowed: false as const, reason: "cloud-fallback-not-approved" as const };
  }
  return { allowed: true as const };
}

export class CloudInferenceError extends Error {
  constructor(
    message: string,
    public readonly status: Exclude<CloudProgress, "checking-provider" | "sending-minimized-request" | "receiving-response" | "completed">,
  ) {
    super(message);
    this.name = "CloudInferenceError";
  }
}

function cloudEndpoint() {
  const configuredBase =
    typeof process !== "undefined"
      ? process.env.EXPO_PUBLIC_API_URL ??
        (process.env.EXPO_PUBLIC_DOMAIN
          ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
          : undefined)
      : undefined;
  if (!configuredBase) return "/api/cloud/inference";
  return `${configuredBase.replace(/\/+$/, "")}/api/cloud/inference`;
}

export function buildCloudRequest(input: {
  task: CloudTask;
  reason: CloudFallbackReason;
  userInput: string;
}): CloudRequest {
  const bounded = redactPrivacyText(
    input.userInput.replace(/[\u0000-\u001f\u007f]/g, " ").trim(),
    CLOUD_FALLBACK_LIMITS.maxInputChars,
  ).slice(0, CLOUD_FALLBACK_LIMITS.maxInputChars);
  return {
    task: input.task,
    reason: input.reason,
    input: bounded,
  };
}

export function isFallbackEligibleLocalFailure(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("out of memory") ||
    message.includes("outofmemory") ||
    message.includes("allocation failed") ||
    message.includes("cannot allocate") ||
    message.includes("needs more memory") ||
    message.includes("safe on this device") ||
    message.includes("context size") ||
    message.includes("failed to create context") ||
    message.includes("failed to load model") ||
    message.includes("native offline engine") ||
    message.includes("browser preview")
  );
}

function errorFromResponse(response: Response, body: unknown) {
  const code =
    body && typeof body === "object" && "code" in body && typeof body.code === "string"
      ? body.code
      : "";
  if (response.status === 429 || code === "quota") {
    return new CloudInferenceError(
      "The configured cloud provider quota is unavailable. Your local path is still unchanged.",
      "quota",
    );
  }
  if (response.status === 408 || code === "timeout") {
    return new CloudInferenceError(
      "The cloud provider took too long to respond. Try again locally or later.",
      "timed-out",
    );
  }
  if (code === "unavailable" || response.status === 503) {
    return new CloudInferenceError(
      "Cloud fallback is enabled, but the configured provider is unavailable.",
      "provider-unavailable",
    );
  }
  const message =
    body && typeof body === "object" && "message" in body && typeof body.message === "string"
      ? body.message
      : "The cloud provider could not complete this request.";
  return new CloudInferenceError(message, "failed");
}

export async function requestCloudInference(
  request: CloudRequest,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: CloudProgress) => void;
  } = {},
) {
  const boundedRequest = buildCloudRequest({
    task: request.task,
    reason: request.reason,
    userInput: request.input,
  });
  if (!boundedRequest.input) {
    throw new CloudInferenceError("There is no bounded task input to send.", "blocked");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLOUD_FALLBACK_LIMITS.timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const signal = controller.signal;
  options.onProgress?.("checking-provider");
  try {
    options.onProgress?.("sending-minimized-request");
    const response = await fetch(cloudEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(boundedRequest),
      signal,
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) throw errorFromResponse(response, body);
    options.onProgress?.("receiving-response");
    const output =
      body && typeof body === "object" && "output" in body && typeof body.output === "string"
        ? body.output.trim().slice(0, CLOUD_FALLBACK_LIMITS.maxOutputChars)
        : "";
    if (!output) {
      throw new CloudInferenceError("The cloud provider returned no usable text.", "failed");
    }
    options.onProgress?.("completed");
    return output;
  } catch (error) {
    if (error instanceof CloudInferenceError) {
      options.onProgress?.(error.status);
      throw error;
    }
    if (signal.aborted) {
      const timedOut = controller.signal.aborted && !options.signal?.aborted;
      const status = timedOut ? "timed-out" : "cancelled";
      options.onProgress?.(status);
      throw new CloudInferenceError(
        timedOut
          ? "The cloud fallback timed out. Your local result path is still available."
          : "Cloud fallback was cancelled. Your local result path is still available.",
        status,
      );
    }
    options.onProgress?.("failed");
    throw new CloudInferenceError(
      "The cloud provider request failed. Your local result path is still available.",
      "failed",
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}