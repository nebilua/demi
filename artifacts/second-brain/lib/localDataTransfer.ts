import { sha256 } from "js-sha256";
import type { ConversationTurn, PersonalProfile } from "@/context/AppContext";
import type { DateReminder } from "@/lib/reminders";
import type { ApprovedMemory } from "@/lib/memory";
import type { ResearchDocument } from "@/lib/research";
import type {
  JobCadence,
  JobNotificationPolicy,
  JobResultStatus,
  JobSource,
  MonitorCondition,
  ScheduledJob,
  ScheduledJobResult,
} from "@/lib/scheduledJobs";

export const LOCAL_DATA_EXPORT_FORMAT = "second-brain-local-data";
export const LOCAL_DATA_EXPORT_VERSION = 1 as const;
export const MAX_LOCAL_DATA_EXPORT_BYTES = 2_000_000;
export const MAX_EXPORTED_TURNS = 80;
export const MAX_EXPORTED_MEMORIES = 100;
export const MAX_EXPORTED_REMINDERS = 100;
export const MAX_EXPORTED_DOCUMENTS = 12;
export const MAX_EXPORTED_JOBS = 20;
export const MAX_EXPORTED_RESULTS_PER_JOB = 10;

export const LOCAL_DATA_INCLUDED_CATEGORIES = [
  "conversations",
  "approved memories",
  "personal profile",
  "important dates",
  "research library",
  "scheduled work",
] as const;

export const LOCAL_DATA_EXCLUDED_CATEGORIES = [
  "GGUF model binaries and model files",
  "Android Keystore and device-bound encryption keys",
  "privacy capability grants, raw audit events, and runtime traces",
  "connector credentials, cloud provider credentials, and other secrets",
  "notification registrations and other device-specific runtime state",
] as const;

export type PortableReminder = Omit<
  DateReminder,
  "notificationId" | "retiredNotificationIds" | "notificationState" | "notificationError"
> & {
  notificationState: "pending";
  notificationError: null;
};

export type PortableScheduledJob = Omit<ScheduledJob, "notificationId" | "lastError"> & {
  notificationId: null;
  lastError: null;
};

export type LocalDataExportRecords = {
  conversations: ConversationTurn[];
  memories: ApprovedMemory[];
  profile: PersonalProfile;
  importantDates: PortableReminder[];
  research: ResearchDocument[];
  scheduledJobs: PortableScheduledJob[];
};

export type LocalDataExport = {
  format: typeof LOCAL_DATA_EXPORT_FORMAT;
  version: typeof LOCAL_DATA_EXPORT_VERSION;
  exportedAt: number;
  included: readonly string[];
  excluded: readonly string[];
  records: LocalDataExportRecords;
  integrity: {
    algorithm: "SHA-256";
    digest: string;
  };
};

export type LocalDataImportSummary = {
  conversations: number;
  memories: number;
  importantDates: number;
  research: number;
  scheduledJobs: number;
  profile: boolean;
  bytes: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isString(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === "string" && value.length <= maximum;
}

function utf8Bytes(value: string) {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return bytes;
}

function portableRecords(records: LocalDataExportRecords) {
  return {
    conversations: records.conversations,
    memories: records.memories,
    profile: records.profile,
    importantDates: records.importantDates.map((item) => ({
      ...item,
      notificationState: "pending" as const,
      notificationError: null,
    })),
    research: records.research,
    scheduledJobs: records.scheduledJobs.map((item) => ({
      ...item,
      notificationId: null,
      lastError: null,
    })),
  };
}

function integrityInput(input: Omit<LocalDataExport, "integrity">) {
  return JSON.stringify(input);
}

export function createLocalDataExport(
  records: LocalDataExportRecords,
  exportedAt = Date.now(),
): LocalDataExport {
  const input: Omit<LocalDataExport, "integrity"> = {
    format: LOCAL_DATA_EXPORT_FORMAT,
    version: LOCAL_DATA_EXPORT_VERSION,
    exportedAt,
    included: [...LOCAL_DATA_INCLUDED_CATEGORIES],
    excluded: [...LOCAL_DATA_EXCLUDED_CATEGORIES],
    records: portableRecords(records),
  };
  if (!validateRecords(input.records)) {
    throw new Error("The local data exceeds a supported recovery limit.");
  }
  const output = {
    ...input,
    integrity: {
      algorithm: "SHA-256" as const,
      digest: sha256(integrityInput(input)),
    },
  };
  const encoded = JSON.stringify(output);
  if (utf8Bytes(encoded) > MAX_LOCAL_DATA_EXPORT_BYTES) {
    throw new Error("The local export is too large to safely write.");
  }
  return output;
}

function validateConversation(value: unknown): value is ConversationTurn {
  return (
    isRecord(value) &&
    isString(value.id, 160) &&
    (value.role === "user" || value.role === "assistant") &&
    isString(value.content, 20_000) &&
    isFiniteNumber(value.createdAt)
  );
}

function validateMemory(value: unknown): value is ApprovedMemory {
  if (
    !isRecord(value) ||
    !isString(value.id, 160) ||
    !["preference", "person", "goal", "project", "fact"].includes(
      value.category as string,
    ) ||
    !isString(value.content, 240) ||
    !isRecord(value.source) ||
    !isString(value.source.turnId, 160) ||
    !isString(value.source.excerpt, 2_000) ||
    !isFiniteNumber(value.source.createdAt) ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt) ||
    !(value.archivedAt === null || isFiniteNumber(value.archivedAt))
  ) {
    return false;
  }
  return (
    value.aliases === undefined ||
    (Array.isArray(value.aliases) &&
      value.aliases.length <= 20 &&
      value.aliases.every((alias) => isString(alias, 80)))
  );
}

function validateProfile(value: unknown): value is PersonalProfile {
  return (
    isRecord(value) &&
    isString(value.displayName, 80) &&
    isString(value.context, 2_000) &&
    typeof value.onboardingCompleted === "boolean"
  );
}

function validateReminder(value: unknown): value is PortableReminder {
  const date = typeof value === "object" && value !== null
    ? (value as Record<string, unknown>).date
    : null;
  const time = typeof value === "object" && value !== null
    ? (value as Record<string, unknown>).time
    : null;
  const dateMatch =
    typeof date === "string"
      ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
      : null;
  const timeMatch = time === null
    ? null
    : typeof time === "string"
      ? /^(\d{2}):(\d{2})$/.exec(time)
      : null;
  const year = dateMatch ? Number(dateMatch[1]) : Number.NaN;
  const month = dateMatch ? Number(dateMatch[2]) : Number.NaN;
  const day = dateMatch ? Number(dateMatch[3]) : Number.NaN;
  const parsedDate = dateMatch
    ? new Date(
        year,
        month - 1,
        day,
        timeMatch ? Number(timeMatch[1]) : 9,
        timeMatch ? Number(timeMatch[2]) : 0,
      )
    : null;
  const dateIsValid =
    Boolean(dateMatch) &&
    (time === null || Boolean(timeMatch)) &&
    parsedDate !== null &&
    parsedDate.getFullYear() === year &&
    parsedDate.getMonth() === month - 1 &&
    parsedDate.getDate() === day &&
    parsedDate.getHours() === (timeMatch ? Number(timeMatch[1]) : 9) &&
    parsedDate.getMinutes() === (timeMatch ? Number(timeMatch[2]) : 0);
  return (
    isRecord(value) &&
    isString(value.id, 160) &&
    isString(value.label, 240) &&
    isString(value.eventName, 240) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.date as string) &&
    (value.time === null || /^\d{2}:\d{2}$/.test(value.time as string)) &&
    dateIsValid &&
    isString(value.notes, 2_000) &&
    typeof value.repeatsAnnually === "boolean" &&
    [0, 60, 1440, 10080].includes(value.remindMinutesBefore as number) &&
    value.notificationState === "pending" &&
    value.notificationError === null &&
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.updatedAt) &&
    (value.deletedAt === null || isFiniteNumber(value.deletedAt)) &&
    value.notificationId === undefined &&
    value.retiredNotificationIds === undefined
  );
}

function validateResearchDocument(value: unknown): value is ResearchDocument {
  if (
    !isRecord(value) ||
    !isString(value.id, 160) ||
    !isString(value.name, 120) ||
    !isString(value.mimeType, 120) ||
    !isNonNegativeInteger(value.sizeBytes) ||
    !isFiniteNumber(value.importedAt) ||
    !(value.archivedAt === null || isFiniteNumber(value.archivedAt)) ||
    !Array.isArray(value.chunks) ||
    value.chunks.length > 400
  ) {
    return false;
  }
  return value.chunks.every(
    (chunk) =>
      isRecord(chunk) &&
      isString(chunk.id, 80) &&
      isNonNegativeInteger(chunk.start) &&
      isString(chunk.text, 1_800),
  );
}

const resultStatuses: JobResultStatus[] = [
  "pending",
  "completed",
  "changed",
  "skipped",
  "failed",
  "interrupted",
];

function validateJobSource(value: unknown): value is JobSource {
  if (!isRecord(value) || !["memories", "calendar", "file", "connector"].includes(value.kind as string)) {
    return false;
  }
  if (value.kind === "memories" || value.kind === "calendar") return Object.keys(value).length === 1;
  if (value.kind === "connector") {
    return (
      isString(value.id, 160) &&
      isString(value.label, 160) &&
      isString(value.provider, 160)
    );
  }
  return (
    isString(value.id, 160) &&
    isString(value.name, 160) &&
    isString(value.mimeType, 120) &&
    isString(value.content, 120_000) &&
    isNonNegativeInteger(value.sizeBytes) &&
    isFiniteNumber(value.selectedAt)
  );
}

function validateJobResult(value: unknown): value is ScheduledJobResult {
  return (
    isRecord(value) &&
    isString(value.id, 160) &&
    isFiniteNumber(value.startedAt) &&
    isFiniteNumber(value.finishedAt) &&
    resultStatuses.includes(value.status as JobResultStatus) &&
    isString(value.summary, 240) &&
    isString(value.details, 12_000) &&
    ["scheduled", "manual", "recovery"].includes(value.trigger as string) &&
    isString(value.sourceSnapshot, 2_000) &&
    (value.error === null || isString(value.error, 240))
  );
}

function validateMonitor(value: unknown): value is MonitorCondition {
  return (
    isRecord(value) &&
    ["memory-count", "upcoming-reminder-count"].includes(value.target as string) &&
    ["changes", "increases", "decreases", "at-least", "at-most"].includes(
      value.operator as string,
    ) &&
    isNonNegativeInteger(value.threshold) &&
    (value.threshold as number) <= 1_000
  );
}

function validateScheduledJob(value: unknown): value is PortableScheduledJob {
  return (
    isRecord(value) &&
    isString(value.id, 160) &&
    isString(value.name, 80) &&
    ["digest", "monitor"].includes(value.kind as string) &&
    ["daily", "weekly"].includes(value.cadence as string) &&
    /^\d{2}:\d{2}$/.test(value.time as string) &&
    isNonNegativeInteger(value.weekday) &&
    (value.weekday as number) <= 6 &&
    isString(value.prompt, 600) &&
    Array.isArray(value.sources) &&
    value.sources.length <= 8 &&
    value.sources.every(validateJobSource) &&
    (value.monitor === null || validateMonitor(value.monitor)) &&
    ["silent", "generic"].includes(value.notificationPolicy as string) &&
    [7, 30].includes(value.retentionDays as number) &&
    [30, 60].includes(value.executionBudgetSeconds as number) &&
    value.networkUse === "never" &&
    ["on-device model", "on-device check"].includes(value.runtime as string) &&
    typeof value.enabled === "boolean" &&
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.updatedAt) &&
    (value.nextRunAt === null || isFiniteNumber(value.nextRunAt)) &&
    (value.lastRunAt === null || isFiniteNumber(value.lastRunAt)) &&
    (value.lastResultStatus === null || resultStatuses.includes(value.lastResultStatus as JobResultStatus)) &&
    (value.lastResultSummary === null || isString(value.lastResultSummary, 240)) &&
    value.notificationId === null &&
    value.lastError === null &&
    (value.monitorBaseline === null || isNonNegativeInteger(value.monitorBaseline)) &&
    Array.isArray(value.results) &&
    value.results.length <= MAX_EXPORTED_RESULTS_PER_JOB &&
    value.results.every(validateJobResult)
  );
}

function uniqueIds(values: Array<{ id: string }>) {
  return new Set(values.map((value) => value.id)).size === values.length;
}

function validateRecords(value: unknown): value is LocalDataExportRecords {
  if (!isRecord(value)) return false;
  const conversations = value.conversations;
  const memories = value.memories;
  const importantDates = value.importantDates;
  const research = value.research;
  const scheduledJobs = value.scheduledJobs;
  return (
    Array.isArray(conversations) &&
    conversations.length <= MAX_EXPORTED_TURNS &&
    conversations.every(validateConversation) &&
    uniqueIds(conversations) &&
    Array.isArray(memories) &&
    memories.length <= MAX_EXPORTED_MEMORIES &&
    memories.every(validateMemory) &&
    uniqueIds(memories) &&
    validateProfile(value.profile) &&
    Array.isArray(importantDates) &&
    importantDates.length <= MAX_EXPORTED_REMINDERS &&
    importantDates.every(validateReminder) &&
    uniqueIds(importantDates) &&
    Array.isArray(research) &&
    research.length <= MAX_EXPORTED_DOCUMENTS &&
    research.every(validateResearchDocument) &&
    uniqueIds(research) &&
    Array.isArray(scheduledJobs) &&
    scheduledJobs.length <= MAX_EXPORTED_JOBS &&
    scheduledJobs.every(validateScheduledJob) &&
    uniqueIds(scheduledJobs)
  );
}

export function summarizeLocalDataExport(
  value: LocalDataExport,
  bytes = utf8Bytes(JSON.stringify(value)),
): LocalDataImportSummary {
  return {
    conversations: value.records.conversations.length,
    memories: value.records.memories.length,
    importantDates: value.records.importantDates.length,
    research: value.records.research.length,
    scheduledJobs: value.records.scheduledJobs.length,
    profile: value.records.profile.onboardingCompleted || Boolean(
      value.records.profile.displayName || value.records.profile.context,
    ),
    bytes,
  };
}

export function parseLocalDataExport(text: string): LocalDataExport {
  if (utf8Bytes(text) > MAX_LOCAL_DATA_EXPORT_BYTES) {
    throw new Error("This local export is too large to open safely.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not a valid local data export.");
  }
  if (
    !isRecord(parsed) ||
    parsed.format !== LOCAL_DATA_EXPORT_FORMAT ||
    parsed.version !== LOCAL_DATA_EXPORT_VERSION ||
    !isFiniteNumber(parsed.exportedAt) ||
    JSON.stringify(parsed.included) !== JSON.stringify(LOCAL_DATA_INCLUDED_CATEGORIES) ||
    JSON.stringify(parsed.excluded) !== JSON.stringify(LOCAL_DATA_EXCLUDED_CATEGORIES) ||
    !isRecord(parsed.integrity) ||
    parsed.integrity.algorithm !== "SHA-256" ||
    !isString(parsed.integrity.digest, 64) ||
    !validateRecords(parsed.records)
  ) {
    throw new Error("This local export has an unsupported or incomplete schema.");
  }
  const { integrity, ...withoutIntegrity } = parsed;
  const expected = sha256(integrityInput(withoutIntegrity as Omit<LocalDataExport, "integrity">));
  if (integrity.digest !== expected) {
    throw new Error("This local export failed its integrity check and was not imported.");
  }
  return parsed as LocalDataExport;
}

export function toStoredReminder(item: PortableReminder): DateReminder {
  return {
    ...item,
    notificationId: null,
    retiredNotificationIds: [],
    notificationState: "pending",
    notificationError: null,
  };
}

export function toStoredScheduledJob(item: PortableScheduledJob): ScheduledJob {
  return {
    ...item,
    notificationId: null,
    lastError: null,
  };
}
