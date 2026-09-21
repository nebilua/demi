export type CapabilityId =
  | "local.inference"
  | "local.files"
  | "local.code-execution"
  | "local.calendar"
  | "local.contacts"
  | "local.voice-input"
  | "local.voice-output"
  | "local.notifications"
  | "network.model-download"
  | "network.connectors"
  | "network.web-research"
  | "network.remote-inference"
  | "device.screen-access"
  | "automation.scheduled-actions";

export type CapabilityKind = "local" | "system" | "network";
export type CapabilityApproval =
  | "approved"
  | "paused"
  | "revoked"
  | "expired"
  | "not-granted";
export type CapabilityLifetime = "session" | "24-hours" | "7-days" | "until-revoked";
export type DataSensitivity = "ordinary" | "personal" | "sensitive" | "secret";

export type CapabilityDefinition = {
  id: CapabilityId;
  name: string;
  purpose: string;
  scope: string;
  kind: CapabilityKind;
  dataSensitivity: DataSensitivity;
  networkUse: "never" | "optional" | "required";
  defaultApproval: CapabilityApproval;
  defaultLifetime: CapabilityLifetime;
  requiresDestructiveConfirmation: boolean;
};

export const CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  {
    id: "local.inference",
    name: "Local model inference",
    purpose: "Generate replies and suggestions with the GGUF model installed on this device.",
    scope: "The current message, selected memories, profile context, and recent conversation turns.",
    kind: "local",
    dataSensitivity: "sensitive",
    networkUse: "never",
    defaultApproval: "approved",
    defaultLifetime: "until-revoked",
    requiresDestructiveConfirmation: false,
  },
  {
    id: "local.files",
    name: "Selected local files",
    purpose: "Read a document the user selected through Android's document picker.",
    scope: "Only the selected document; file contents stay on this device.",
    kind: "system",
    dataSensitivity: "sensitive",
    networkUse: "never",
    defaultApproval: "approved",
    defaultLifetime: "until-revoked",
    requiresDestructiveConfirmation: false,
  },
  {
    id: "local.code-execution",
    name: "Sandboxed code actions",
    purpose: "Run a reviewed calculation or data transformation against files you explicitly select.",
    scope: "Only the selected input text, inside Demi's bounded pure-operation sandbox; no file writes or side effects.",
    kind: "local",
    dataSensitivity: "sensitive",
    networkUse: "never",
    defaultApproval: "not-granted",
    defaultLifetime: "until-revoked",
    requiresDestructiveConfirmation: false,
  },
  {
    id: "local.calendar",
    name: "Local calendar and reminders",
    purpose: "Read or change reminders that Demi saved on this device.",
    scope: "Only Demi's local reminders; changes require a fresh confirmation.",
    kind: "system",
    dataSensitivity: "personal",
    networkUse: "never",
    defaultApproval: "approved",
    defaultLifetime: "until-revoked",
    requiresDestructiveConfirmation: true,
  },
  {
    id: "local.contacts",
    name: "Local contacts",
    purpose: "Read selected contact details through an explicit device permission.",
    scope: "Contact records requested for the current action; no background access.",
    kind: "system",
    dataSensitivity: "sensitive",
    networkUse: "never",
    defaultApproval: "not-granted",
    defaultLifetime: "session",
    requiresDestructiveConfirmation: false,
  },
  {
    id: "local.voice-input",
    name: "Offline voice input",
    purpose: "Turn speech into editable text through the verified on-device Android recognizer.",
    scope: "Microphone audio while the microphone action is active and the selected offline locale.",
    kind: "system",
    dataSensitivity: "sensitive",
    networkUse: "never",
    defaultApproval: "approved",
    defaultLifetime: "until-revoked",
    requiresDestructiveConfirmation: false,
  },
  {
    id: "local.voice-output",
    name: "Offline spoken replies",
    purpose: "Speak a reply with an installed Android voice that reports no network requirement.",
    scope: "The reply text currently being spoken.",
    kind: "system",
    dataSensitivity: "personal",
    networkUse: "never",
    defaultApproval: "approved",
    defaultLifetime: "until-revoked",
    requiresDestructiveConfirmation: false,
  },
  {
    id: "local.notifications",
    name: "Local reminders",
    purpose: "Schedule reminders with the device's local notification service.",
    scope: "Reminder title, body, date, and trigger time.",
    kind: "system",
    dataSensitivity: "personal",
    networkUse: "never",
    defaultApproval: "approved",
    defaultLifetime: "until-revoked",
    requiresDestructiveConfirmation: true,
  },
  {
    id: "network.model-download",
    name: "Recommended model download",
    purpose: "Download the selected model file from its published source for local inference.",
    scope: "Only the named model file and its checksum; no conversation or profile data is uploaded.",
    kind: "network",
    dataSensitivity: "ordinary",
    networkUse: "required",
    defaultApproval: "not-granted",
    defaultLifetime: "24-hours",
    requiresDestructiveConfirmation: false,
  },
  {
    id: "network.connectors",
    name: "Network connectors",
    purpose: "Allow a future connector to exchange only the data described by its separate approval.",
    scope: "A named connector's explicitly listed records; never the entire device.",
    kind: "network",
    dataSensitivity: "secret",
    networkUse: "required",
    defaultApproval: "not-granted",
    defaultLifetime: "24-hours",
    requiresDestructiveConfirmation: true,
  },
  {
    id: "network.web-research",
    name: "Opt-in web research",
    purpose: "Fetch one public HTTPS source that you approve for the current research request.",
    scope: "Only the URL shown in the request; no background crawling, local memories, or hidden browser access.",
    kind: "network",
    dataSensitivity: "ordinary",
    networkUse: "required",
    defaultApproval: "not-granted",
    defaultLifetime: "24-hours",
    requiresDestructiveConfirmation: false,
  },
  {
    id: "network.remote-inference",
    name: "Cloud fallback",
    purpose: "Allow a server-managed cloud provider to answer only when local inference cannot run.",
    scope: "The current bounded chat or research input only; no profile, memories, history, files, contacts, or screen content.",
    kind: "network",
    dataSensitivity: "sensitive",
    networkUse: "required",
    defaultApproval: "not-granted",
    defaultLifetime: "24-hours",
    requiresDestructiveConfirmation: false,
  },
  {
    id: "device.screen-access",
    name: "Screen access",
    purpose: "Read a user-approved screen region for a future focused action.",
    scope: "A user-selected screen region during an active action.",
    kind: "system",
    dataSensitivity: "sensitive",
    networkUse: "never",
    defaultApproval: "not-granted",
    defaultLifetime: "session",
    requiresDestructiveConfirmation: false,
  },
  {
    id: "automation.scheduled-actions",
    name: "Scheduled actions",
    purpose: "Run an explicitly approved local action at a later time.",
    scope: "The named action, its input, and its scheduled result.",
    kind: "local",
    dataSensitivity: "sensitive",
    networkUse: "optional",
    defaultApproval: "not-granted",
    defaultLifetime: "7-days",
    requiresDestructiveConfirmation: true,
  },
];

export type CapabilityGrant = {
  capabilityId: CapabilityId;
  approval: CapabilityApproval;
  lifetime: CapabilityLifetime;
  approvedAt: number | null;
  expiresAt: number | null;
  updatedAt: number;
};

export type ConnectorReference = {
  id: string;
  capabilityId: "network.connectors";
  provider: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export type ScheduledJobState = {
  id: string;
  capabilityId: "automation.scheduled-actions";
  actionName: string;
  createdAt: number;
  nextRunAt: number | null;
  lastResult: "pending" | "completed" | "failed" | "interrupted" | null;
  retentionUntil: number;
};

export type AgentTrace = {
  id: string;
  capabilityId: CapabilityId;
  phase: "input" | "output" | "tool-call" | "scheduled-result";
  summary: string;
  status: "started" | "completed" | "failed" | "interrupted";
  createdAt: number;
  retentionUntil: number;
};

export type PrivacyAuditEvent = {
  id: string;
  capabilityId: CapabilityId | null;
  action: string;
  status: "allowed" | "denied" | "cancelled" | "completed" | "failed" | "interrupted";
  summary: string;
  createdAt: number;
  retentionUntil: number;
};

export type PrivacyState = {
  version: 1;
  globalPause: boolean;
  capabilities: Record<CapabilityId, CapabilityGrant>;
  screenPolicy: ScreenPrivacyPolicy;
  connectorReferences: ConnectorReference[];
  schedules: ScheduledJobState[];
  traces: AgentTrace[];
  auditEvents: PrivacyAuditEvent[];
};

export type ScreenRetention = "discard-immediately" | "save-only-on-request";

export type ScreenPrivacyPolicy = {
  retention: ScreenRetention;
  excludedApps: string[];
};

export const PRIVACY_STATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_PRIVACY_AUDIT_EVENTS = 100;
export const MAX_AGENT_TRACES = 100;

function capabilityDefinition(id: CapabilityId) {
  return CAPABILITY_DEFINITIONS.find((definition) => definition.id === id)!;
}

function defaultGrant(definition: CapabilityDefinition, now: number): CapabilityGrant {
  const approved = definition.defaultApproval === "approved";
  return {
    capabilityId: definition.id,
    approval: definition.defaultApproval,
    lifetime: definition.defaultLifetime,
    approvedAt: approved ? now : null,
    expiresAt: null,
    updatedAt: now,
  };
}

export function createDefaultPrivacyState(now = Date.now()): PrivacyState {
  return {
    version: 1,
    globalPause: false,
    capabilities: Object.fromEntries(
      CAPABILITY_DEFINITIONS.map((definition) => [
        definition.id,
        defaultGrant(definition, now),
      ]),
    ) as Record<CapabilityId, CapabilityGrant>,
    screenPolicy: {
      retention: "discard-immediately",
      excludedApps: [],
    },
    connectorReferences: [],
    schedules: [],
    traces: [],
    auditEvents: [],
  };
}

function isCapabilityId(value: unknown): value is CapabilityId {
  return CAPABILITY_DEFINITIONS.some((definition) => definition.id === value);
}

function isApproval(value: unknown): value is CapabilityApproval {
  return (
    value === "approved" ||
    value === "paused" ||
    value === "revoked" ||
    value === "expired" ||
    value === "not-granted"
  );
}

function isLifetime(value: unknown): value is CapabilityLifetime {
  return (
    value === "session" ||
    value === "24-hours" ||
    value === "7-days" ||
    value === "until-revoked"
  );
}

function normalizeGrant(
  value: unknown,
  definition: CapabilityDefinition,
  now: number,
): CapabilityGrant {
  const input = value && typeof value === "object" ? value as Partial<CapabilityGrant> : {};
  const approval = isApproval(input.approval)
    ? input.approval
    : definition.defaultApproval;
  return {
    capabilityId: definition.id,
    approval,
    lifetime: isLifetime(input.lifetime)
      ? input.lifetime
      : definition.defaultLifetime,
    approvedAt: typeof input.approvedAt === "number" ? input.approvedAt : null,
    expiresAt: typeof input.expiresAt === "number" ? input.expiresAt : null,
    updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : now,
  };
}

function cleanText(value: unknown, maximum = 180) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum)
    : "";
}

function normalizeScreenPolicy(value: unknown): ScreenPrivacyPolicy {
  const input =
    value && typeof value === "object"
      ? (value as Partial<ScreenPrivacyPolicy>)
      : {};
  const retention: ScreenRetention =
    input.retention === "save-only-on-request"
      ? "save-only-on-request"
      : "discard-immediately";
  const excludedApps = Array.isArray(input.excludedApps)
    ? input.excludedApps
        .filter((item): item is string => typeof item === "string")
        .map((item) => cleanText(item, 80))
        .filter(Boolean)
        .slice(0, 20)
    : [];
  return { retention, excludedApps };
}

export function redactPrivacyText(value: string, maximum = 180) {
  return cleanText(value, maximum)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/\b(?:\+?\d[\d ().-]{7,}\d)\b/g, "[redacted phone]")
    .replace(
      /\b(?:sk|pk|api|token|secret)[_-]?[a-z0-9_-]{8,}\b/gi,
      "[redacted secret]",
    );
}

function normalizeAuditEvent(value: unknown, now: number): PrivacyAuditEvent | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<PrivacyAuditEvent>;
  if (
    typeof input.id !== "string" ||
    (input.capabilityId !== null && !isCapabilityId(input.capabilityId)) ||
    typeof input.action !== "string" ||
    typeof input.status !== "string" ||
    typeof input.createdAt !== "number"
  ) {
    return null;
  }
  const status = ["allowed", "denied", "cancelled", "completed", "failed", "interrupted"].includes(
    input.status,
  )
    ? input.status as PrivacyAuditEvent["status"]
    : "failed";
  return {
    id: input.id,
    capabilityId: input.capabilityId ?? null,
    action: cleanText(input.action, 80),
    status,
    summary: redactPrivacyText(input.summary ?? ""),
    createdAt: input.createdAt,
    retentionUntil:
      typeof input.retentionUntil === "number"
        ? input.retentionUntil
        : now + PRIVACY_STATE_RETENTION_MS,
  };
}

export function prunePrivacyState(state: PrivacyState, now = Date.now()): PrivacyState {
  const auditEvents = state.auditEvents
    .filter((event) => event.retentionUntil > now)
    .slice(-MAX_PRIVACY_AUDIT_EVENTS);
  const traces = state.traces
    .filter((trace) => trace.retentionUntil > now)
    .slice(-MAX_AGENT_TRACES);
  const schedules = state.schedules
    .filter((schedule) => schedule.retentionUntil > now)
    .slice(-20);
  const capabilities = { ...state.capabilities };
  for (const definition of CAPABILITY_DEFINITIONS) {
    const grant = capabilities[definition.id];
    if (grant?.approval === "approved" && grant.expiresAt !== null && grant.expiresAt <= now) {
      capabilities[definition.id] = {
        ...grant,
        approval: "expired",
        updatedAt: now,
      };
    }
  }
  return {
    ...state,
    capabilities,
    screenPolicy: normalizeScreenPolicy(state.screenPolicy),
    auditEvents,
    traces,
    schedules,
  };
}

export function parsePrivacyState(value: string | null, now = Date.now()): PrivacyState {
  if (!value) return createDefaultPrivacyState(now);
  try {
    const input = JSON.parse(value) as Partial<PrivacyState>;
    if (input.version !== 1) return createDefaultPrivacyState(now);
    const defaults = createDefaultPrivacyState(now);
    const capabilities = { ...defaults.capabilities };
    for (const definition of CAPABILITY_DEFINITIONS) {
      capabilities[definition.id] = normalizeGrant(
        input.capabilities?.[definition.id],
        definition,
        now,
      );
    }
    const auditEvents = Array.isArray(input.auditEvents)
      ? input.auditEvents.map((item) => normalizeAuditEvent(item, now)).filter(
          (item): item is PrivacyAuditEvent => item !== null,
        )
      : [];
    const traces = Array.isArray(input.traces)
      ? input.traces
          .filter((item): item is AgentTrace => Boolean(item && typeof item === "object"))
          .map((item) => ({
            ...item,
            summary: redactPrivacyText(item.summary),
          }))
      : [];
    return prunePrivacyState(
      {
        version: 1,
        globalPause: input.globalPause === true,
        capabilities,
        screenPolicy: normalizeScreenPolicy(input.screenPolicy),
        connectorReferences: Array.isArray(input.connectorReferences)
          ? input.connectorReferences.slice(0, 20)
          : [],
        schedules: Array.isArray(input.schedules) ? input.schedules.slice(0, 20) : [],
        traces,
        auditEvents,
      },
      now,
    );
  } catch {
    return createDefaultPrivacyState(now);
  }
}

export function isCapabilityActive(
  state: PrivacyState,
  capabilityId: CapabilityId,
  now = Date.now(),
) {
  if (state.globalPause) return false;
  const grant = state.capabilities[capabilityId];
  return Boolean(
    grant &&
      grant.approval === "approved" &&
      (grant.expiresAt === null || grant.expiresAt > now),
  );
}

export function getCapabilityStatusLabel(grant: CapabilityGrant) {
  if (grant.approval === "approved") return "Approved";
  if (grant.approval === "paused") return "Paused";
  if (grant.approval === "revoked") return "Revoked";
  if (grant.approval === "expired") return "Expired";
  return "Not granted";
}

export function approvalExpiry(lifetime: CapabilityLifetime, now = Date.now()) {
  if (lifetime === "session") return now;
  if (lifetime === "24-hours") return now + 24 * 60 * 60 * 1000;
  if (lifetime === "7-days") return now + 7 * 24 * 60 * 60 * 1000;
  return null;
}

export function updateCapabilityGrant(
  state: PrivacyState,
  capabilityId: CapabilityId,
  approval: CapabilityApproval,
  now = Date.now(),
): PrivacyState {
  const current = state.capabilities[capabilityId] ?? defaultGrant(
    capabilityDefinition(capabilityId),
    now,
  );
  const expiresAt = approval === "approved"
    ? approvalExpiry(current.lifetime, now)
    : current.expiresAt;
  return prunePrivacyState(
    {
      ...state,
      capabilities: {
        ...state.capabilities,
        [capabilityId]: {
          ...current,
          approval,
          approvedAt: approval === "approved" ? now : current.approvedAt,
          expiresAt,
          updatedAt: now,
        },
      },
    },
    now,
  );
}

export function appendPrivacyAuditEvent(
  state: PrivacyState,
  event: Omit<PrivacyAuditEvent, "id" | "createdAt" | "retentionUntil"> & {
    id?: string;
    createdAt?: number;
  },
  now = Date.now(),
): PrivacyState {
  const auditEvent: PrivacyAuditEvent = {
    ...event,
    id: event.id ?? `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: event.createdAt ?? now,
    summary: redactPrivacyText(event.summary),
    retentionUntil: now + PRIVACY_STATE_RETENTION_MS,
  };
  return prunePrivacyState(
    { ...state, auditEvents: [...state.auditEvents, auditEvent] },
    now,
  );
}