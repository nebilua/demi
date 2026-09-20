import type {
  CapabilityId,
  DataSensitivity,
} from "@/lib/privacyCapabilities";

export type ToolId =
  | "local.files.pick"
  | "local.files.read"
  | "local.files.transform"
  | "local.code.execute"
  | "local.calendar.read"
  | "local.calendar.write"
  | "local.calendar.delete"
  | "local.contacts.read"
  | "local.notifications.schedule"
  | "local.notifications.cancel"
  | "connector.gmail.read"
  | "connector.google-calendar.read";

export type ToolSource = "local-file" | "local-code" | "local-calendar" | "local-contacts" | "local-notifications" | "connector";
export type ToolAction = "read" | "transform" | "create" | "update" | "delete" | "schedule" | "cancel";

export type ToolDefinition = {
  id: ToolId;
  name: string;
  description: string;
  source: ToolSource;
  action: ToolAction;
  capabilityId: CapabilityId;
  sensitivity: DataSensitivity;
  network: "never" | "required";
  requiresFreshConfirmation: boolean;
  supported: boolean;
  unavailableReason?: string;
};

export const TOOL_REGISTRY: readonly ToolDefinition[] = [
  {
    id: "local.files.pick",
    name: "Choose a local document",
    description: "Open Android's document picker without uploading the file.",
    source: "local-file",
    action: "read",
    capabilityId: "local.files",
    sensitivity: "sensitive",
    network: "never",
    requiresFreshConfirmation: false,
    supported: true,
  },
  {
    id: "local.files.read",
    name: "Read selected document",
    description: "Read text from the document selected for this session.",
    source: "local-file",
    action: "read",
    capabilityId: "local.files",
    sensitivity: "sensitive",
    network: "never",
    requiresFreshConfirmation: false,
    supported: true,
  },
  {
    id: "local.files.transform",
    name: "Transform selected document",
    description: "Summarize or transform a selected document with the local model.",
    source: "local-file",
    action: "transform",
    capabilityId: "local.files",
    sensitivity: "sensitive",
    network: "never",
    requiresFreshConfirmation: false,
    supported: true,
  },
  {
    id: "local.code.execute",
    name: "Run a sandboxed code action",
    description: "Run a reviewed bounded calculation or data transformation against explicitly selected text.",
    source: "local-code",
    action: "transform",
    capabilityId: "local.code-execution",
    sensitivity: "sensitive",
    network: "never",
    requiresFreshConfirmation: true,
    supported: true,
  },
  {
    id: "local.calendar.read",
    name: "Read local reminders",
    description: "Read Demi's saved reminders and upcoming dates.",
    source: "local-calendar",
    action: "read",
    capabilityId: "local.calendar",
    sensitivity: "personal",
    network: "never",
    requiresFreshConfirmation: false,
    supported: true,
  },
  {
    id: "local.calendar.write",
    name: "Change a local reminder",
    description: "Create or update a reminder after showing the proposed change.",
    source: "local-calendar",
    action: "update",
    capabilityId: "local.calendar",
    sensitivity: "personal",
    network: "never",
    requiresFreshConfirmation: true,
    supported: true,
  },
  {
    id: "local.calendar.delete",
    name: "Delete a local reminder",
    description: "Delete a reminder and its device alert after confirmation.",
    source: "local-calendar",
    action: "delete",
    capabilityId: "local.calendar",
    sensitivity: "personal",
    network: "never",
    requiresFreshConfirmation: true,
    supported: true,
  },
  {
    id: "local.contacts.read",
    name: "Read local contacts",
    description: "Read contact records only after the device permission is granted.",
    source: "local-contacts",
    action: "read",
    capabilityId: "local.contacts",
    sensitivity: "sensitive",
    network: "never",
    requiresFreshConfirmation: false,
    supported: false,
    unavailableReason: "Contacts are not included in this installed build yet.",
  },
  {
    id: "local.notifications.schedule",
    name: "Schedule a device notification",
    description: "Schedule a local reminder alert without network access.",
    source: "local-notifications",
    action: "schedule",
    capabilityId: "local.notifications",
    sensitivity: "personal",
    network: "never",
    requiresFreshConfirmation: true,
    supported: true,
  },
  {
    id: "local.notifications.cancel",
    name: "Cancel a device notification",
    description: "Cancel an alert after showing which reminder will change.",
    source: "local-notifications",
    action: "cancel",
    capabilityId: "local.notifications",
    sensitivity: "personal",
    network: "never",
    requiresFreshConfirmation: true,
    supported: true,
  },
  {
    id: "connector.gmail.read",
    name: "Gmail read-only",
    description: "Read only the Gmail records listed in a connector preflight.",
    source: "connector",
    action: "read",
    capabilityId: "network.connectors",
    sensitivity: "sensitive",
    network: "required",
    requiresFreshConfirmation: true,
    supported: false,
    unavailableReason: "No Gmail connector is connected.",
  },
  {
    id: "connector.google-calendar.read",
    name: "Google Calendar read-only",
    description: "Read only the Google Calendar records listed in a connector preflight.",
    source: "connector",
    action: "read",
    capabilityId: "network.connectors",
    sensitivity: "sensitive",
    network: "required",
    requiresFreshConfirmation: true,
    supported: false,
    unavailableReason: "No Google Calendar connector is connected.",
  },
];

export type ToolInput =
  | { toolId: "local.files.pick"; mimeTypes?: string[] }
  | { toolId: "local.files.read"; documentId: string }
  | { toolId: "local.files.transform"; documentId: string; instruction: string }
  | { toolId: "local.code.execute"; inputIds: string[]; code: string }
  | { toolId: "local.calendar.read" }
  | { toolId: "local.calendar.write"; reminderId?: string; proposedChange: string }
  | { toolId: "local.calendar.delete"; reminderId: string; proposedChange: string }
  | { toolId: "local.contacts.read"; contactIds?: string[] }
  | { toolId: "local.notifications.schedule"; reminderId: string; proposedChange: string }
  | { toolId: "local.notifications.cancel"; reminderId: string; proposedChange: string }
  | { toolId: "connector.gmail.read"; query: string; recordLimit: number }
  | { toolId: "connector.google-calendar.read"; from: string; to: string; recordLimit: number };

export type ToolValidation = {
  ok: boolean;
  error?: string;
};

export function getToolDefinition(toolId: ToolId) {
  return TOOL_REGISTRY.find((tool) => tool.id === toolId);
}

export function validateToolInput(input: ToolInput): ToolValidation {
  const definition = getToolDefinition(input.toolId);
  if (!definition) return { ok: false, error: "This tool is not registered." };
  if (!definition.supported) {
    return { ok: false, error: definition.unavailableReason ?? "This tool is unavailable." };
  }
  if ("instruction" in input && (!input.instruction.trim() || input.instruction.length > 400)) {
    return { ok: false, error: "Add a short instruction of 1–400 characters." };
  }
  if ("code" in input && (!input.code.trim() || input.code.length > 4000)) {
    return { ok: false, error: "Sandbox code must be 1–4,000 characters." };
  }
  if ("inputIds" in input && (
    !Array.isArray(input.inputIds) ||
    input.inputIds.length < 1 ||
    input.inputIds.length > 3 ||
    input.inputIds.some((id) => typeof id !== "string" || !id.trim())
  )) {
    return { ok: false, error: "Choose between 1 and 3 explicit input files." };
  }
  if ("proposedChange" in input && (!input.proposedChange.trim() || input.proposedChange.length > 500)) {
    return { ok: false, error: "The proposed change is missing or too long." };
  }
  if ("recordLimit" in input && (!Number.isInteger(input.recordLimit) || input.recordLimit < 1 || input.recordLimit > 100)) {
    return { ok: false, error: "Record limit must be between 1 and 100." };
  }
  if ("query" in input && (!input.query.trim() || input.query.length > 200)) {
    return { ok: false, error: "Connector queries must be 1–200 characters." };
  }
  return { ok: true };
}

export type ToolPreflight = {
  toolId: ToolId;
  title: string;
  source: string;
  action: string;
  scope: string;
  network: string;
  confirmation: string;
  sensitivity: DataSensitivity;
};

export function createToolPreflight(toolId: ToolId, scope: string): ToolPreflight {
  const definition = getToolDefinition(toolId);
  if (!definition) throw new Error("This tool is not registered.");
  return {
    toolId,
    title: definition.name,
    source: definition.source === "connector" ? "Optional network connector" : "This device",
    action: definition.action,
    scope: scope.trim().slice(0, 240) || definition.description,
    network: definition.network === "never" ? "No network access" : "Network required; nothing is sent until confirmed",
    confirmation: definition.requiresFreshConfirmation
      ? "Fresh confirmation required before this action"
      : "No write confirmation required",
    sensitivity: definition.sensitivity,
  };
}
