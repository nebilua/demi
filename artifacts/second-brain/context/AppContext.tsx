import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";
import type { LlamaContext } from "llama.rn";
import { releaseNativeContext } from "@/lib/inferenceScheduler";
import { NativeInferenceError } from "@/lib/inferenceErrors";
import {
  formatBytes,
  getDeviceCompatibility,
  loadNativeModel,
  proposeMemoryCandidate,
  streamCompletion,
  RECOMMENDED_MODEL,
  type DeviceCompatibility,
  type LocalModel,
  type RuntimeDetails,
} from "@/lib/offlineLlm";
import {
  cancelLocalRecognition,
  getVoiceModule,
  getVoiceReadiness,
  getOfflineVoices,
  prepareVoiceModels,
  speakLocally,
  startLocalRecognition,
  stopLocalRecognition,
  stopLocalSpeech,
  voiceErrorMessage,
  voiceMatchesLanguage,
  type OfflineVoice,
  type OfflineVoiceModule,
  type RecognitionResultEvent,
  type RecognitionStatusEvent,
  type VoiceInputStatus,
  type VoiceSelfTestResult,
  voiceSelfTestDiagnosis,
} from "@/lib/offlineVoice";
import {
  memoryFingerprint,
  hasConversationalReminderIntent,
  normalizeMemoryAliases,
  parseConversationalReminder,
  parseApprovedMemories,
  parseMemoryCandidate,
  selectRelevantMemories,
  type ApprovedMemory,
  type MemoryCandidate,
} from "@/lib/memory";
import { computeFileSha256 } from "@/lib/fileHash";
import {
  getSecureStorageProtection,
  migratePlaintextRecord,
  readSecureRecord,
  removeSecureRecord,
  writeSecureRecord,
  type SecureStorageProtection,
} from "@/lib/secureLocalStorage";
import {
  MAX_CONVERSATION_TURNS,
  MAX_MEMORIES,
  MAX_MEMORIES_IN_PROMPT,
  MODEL_STORAGE_SAFETY_MARGIN_BYTES,
} from "@/lib/localLimits";
import {
  createUnavailableLocalStorageUsage,
  measureLocalStorageUsage,
  type LocalStorageUsage,
} from "@/lib/localStorageUsage";
import {
  appendPrivacyAuditEvent,
  createDefaultPrivacyState,
  isCapabilityActive,
  parsePrivacyState,
  prunePrivacyState,
  redactPrivacyText,
  updateCapabilityGrant,
  type AgentTrace,
  type CapabilityApproval,
  type CapabilityId,
  type PrivacyAuditEvent,
  type PrivacyState,
  type ScreenPrivacyPolicy,
  endPrivacySession,
} from "@/lib/privacyCapabilities";
import {
  CloudInferenceError,
  getCloudFallbackPermission,
  isFallbackEligibleLocalFailure,
  requestCloudInference,
  type CloudFallbackActivity,
  type CloudFallbackReason,
  type CloudProgress,
  type CloudTask,
} from "@/lib/cloudFallback";
import {
  getAccessibilitySnapshot,
  captureScreenshotText,
  readImageText,
  getScreenAccessStatus,
  openAccessibilitySettings,
  requestScreenCapture,
  stopScreenSession as stopNativeScreenSession,
  type ScreenAccessStatus,
} from "@/lib/screenAccess";
import {
  createScreenContext, screenContextValid, screenPrompt, supportedScreenResource,
  MAX_SCREEN_FILE_BYTES, type SharedScreenContext,
} from "@/lib/sharedScreenContext";
import {
  recordRuntimeEvent,
  startRuntimeMetric,
} from "@/lib/runtimeDiagnostics";

export type Appearance = "system" | "light" | "dark";

export type ConversationTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  privateContext?: boolean;
};

export type AppSettings = {
  appearance: Appearance;
  hapticsEnabled: boolean;
  saveConversations: boolean;
  voiceInputEnabled: boolean;
  spokenRepliesEnabled: boolean;
  voiceLanguage: string;
  speechRate: number;
  preferredVoiceId: string | null;
};

export type PersonalProfile = {
  displayName: string;
  context: string;
  onboardingCompleted: boolean;
};

export type ModelSetupStatus =
  "idle" | "selecting" | "copying" | "validating" | "loading";

export type ModelCleanupResult = {
  status: "completed" | "unavailable";
  deletedFiles: number;
  deletedBytes: number;
  failedFiles: number;
};

export type ScreenSession = {
  status: "idle" | "starting" | "active" | "stopped" | "error";
  accessibilityText: boolean;
  screenshot: boolean;
  selectedResource: {
    name: string;
    mimeType: string | null;
    size: number | null;
    uri?: string;
  } | null;
  protectedContent: boolean;
  message: string | null;
};

export type PrivacyActionInput = Omit<
  PrivacyAuditEvent,
  "id" | "createdAt" | "retentionUntil"
>;

type AppContextValue = {
  settings: AppSettings;
  settingsReady: boolean;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  profile: PersonalProfile;
  saveProfile: (
    profile: Pick<PersonalProfile, "displayName" | "context">,
  ) => Promise<void>;
  skipProfile: () => Promise<void>;
  clearProfile: () => Promise<void>;
  storageError: string | null;
  storageProtection: SecureStorageProtection;
  privacyReady: boolean;
  privacyState: PrivacyState;
  setCapabilityApproval: (
    capabilityId: CapabilityId,
    approval: CapabilityApproval,
  ) => Promise<void>;
  setGlobalPrivacyPause: (paused: boolean) => Promise<void>;
  clearPrivacyState: () => Promise<void>;
  privacyResetVersion: number;
  recordPrivacyAction: (event: PrivacyActionInput) => Promise<void>;
  recordAgentTrace: (
    trace: Omit<AgentTrace, "id" | "createdAt" | "retentionUntil">,
  ) => Promise<void>;
  screenAccessStatus: ScreenAccessStatus;
  screenSession: ScreenSession;
  screenPreview: SharedScreenContext | null;
  screenAttachment: SharedScreenContext | null;
  attachScreenContext: (text: string) => void;
  discardScreenContext: () => void;
  refreshScreenAccessStatus: () => Promise<void>;
  startScreenSession: (options: {
    accessibilityText: boolean;
    screenshot: boolean;
    selectedResource?: ScreenSession["selectedResource"];
  }) => Promise<boolean>;
  stopScreenSession: (reason?: string) => Promise<void>;
  openAccessibilitySettings: () => Promise<void>;
  updateScreenPolicy: (patch: Partial<ScreenPrivacyPolicy>) => Promise<void>;
  memories: ApprovedMemory[];
  updateMemory: (id: string, content: string) => Promise<void>;
  updateMemoryAliases: (id: string, aliases: string[]) => Promise<void>;
  archiveMemory: (id: string, archived: boolean) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  savedTurnCount: number;
  reloadRecoverableData: () => Promise<void>;
  localModel: LocalModel | null;
  deviceCompatibility: DeviceCompatibility;
  engineStatus: "unsupported" | "no-model" | "loading" | "ready" | "error";
  engineProgress: number;
  engineError: string | null;
  modelSetupStatus: ModelSetupStatus;
  runtimeDetails: RuntimeDetails | null;
  voiceInputStatus: VoiceInputStatus;
  voiceInputAvailable: boolean;
  voiceOutputAvailable: boolean;
  offlineVoices: OfflineVoice[];
  offlineVoicesLoading: boolean;
  refreshOfflineVoices: () => Promise<void>;
  voiceTranscript: string;
  voiceError: string | null;
  voiceSetupMessage: string | null;
  voiceSetupInProgress: boolean;
  isSpeaking: boolean;
  voiceSelfTestResult: VoiceSelfTestResult | null;
  voiceSelfTestRunning: boolean;
  voiceSelfTestSpeechStatus: "idle" | "speaking";
  runVoiceSelfTest: () => Promise<void>;
  stopVoiceSelfTest: () => void;
  cancelVoiceSelfTest: () => void;
  playVoiceSelfTestSample: () => Promise<void>;
  stopVoiceSelfTestSample: () => Promise<void>;
  importModel: () => Promise<void>;
  downloadRecommendedModel: () => Promise<void>;
  cancelDownload: () => void;
  downloadStatus: "idle" | "downloading" | "validating" | "loading" | "error";
  downloadProgress: number;
  downloadError: string | null;
  loadModel: () => Promise<boolean>;
  removeModel: () => Promise<void>;
  startVoiceInput: () => Promise<void>;
  stopVoiceInput: () => void;
  cancelVoiceInput: () => void;
  clearVoiceTranscript: () => void;
  prepareBundledVoiceModels: () => Promise<void>;
  speakText: (text: string) => Promise<void>;
  stopSpeaking: () => Promise<void>;
  dismissVoiceError: () => void;
  cloudFallbackActivity: CloudFallbackActivity | null;
  runCloudFallback: (
    task: CloudTask,
    reason: CloudFallbackReason,
    userInput: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  storageUsage: LocalStorageUsage | null;
  storageUsageRefreshing: boolean;
  refreshStorageUsage: () => void;
  reclaimUnusedModelFiles: () => Promise<ModelCleanupResult>;
};

export type ChatContextValue = {
  turns: ConversationTurn[];
  isConversationReady: boolean;
  isThinking: boolean;
  pendingMemoryCandidate: MemoryCandidate | null;
  saveMemoryCandidate: (content?: string) => Promise<void>;
  rejectMemoryCandidate: () => void;
  sendMessage: (content: string) => Promise<void>;
  runLocalInference: (
    prompt: string,
    onToken?: (token: string) => void,
    priority?: number,
    guard?: () => boolean,
  ) => Promise<string>;
  clearConversation: () => Promise<void>;
};

const SETTINGS_KEY = "@second-brain/settings-v1";
const CONVERSATION_KEY = "@second-brain/conversation-v1";
const MODEL_KEY = "@second-brain/local-model-v1";
const PROFILE_KEY = "@second-brain/personal-profile-v1";
const SECURE_PROFILE_KEY = "profile";
const SECURE_CONVERSATION_KEY = "conversation";
const SECURE_MEMORIES_KEY = "approved-memories";
const SECURE_PRIVACY_STATE_KEY = "privacy-agent-state";

const DEFAULT_SETTINGS: AppSettings = {
  appearance: "system",
  hapticsEnabled: true,
  saveConversations: true,
  voiceInputEnabled: true,
  spokenRepliesEnabled: true,
  voiceLanguage: "en-US",
  speechRate: 0.92,
  preferredVoiceId: null,
};

const DEFAULT_PROFILE: PersonalProfile = {
  displayName: "",
  context: "",
  onboardingCompleted: false,
};

const STREAM_UI_UPDATE_INTERVAL_MS = 50;

const AppContext = createContext<AppContextValue | null>(null);
const ChatContext = createContext<ChatContextValue | null>(null);

function createId() {
  return `${Date.now().toString()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseSettings(value: string | null): AppSettings {
  if (!value) return DEFAULT_SETTINGS;

  try {
    const parsed = JSON.parse(value) as Partial<AppSettings>;
    return {
      appearance:
        parsed.appearance === "light" || parsed.appearance === "dark"
          ? parsed.appearance
          : "system",
      hapticsEnabled: parsed.hapticsEnabled !== false,
      saveConversations: parsed.saveConversations !== false,
      voiceInputEnabled: parsed.voiceInputEnabled !== false,
      spokenRepliesEnabled: parsed.spokenRepliesEnabled !== false,
      voiceLanguage: "en-US",
      speechRate:
        typeof parsed.speechRate === "number" &&
        parsed.speechRate >= 0.75 &&
        parsed.speechRate <= 1.2
          ? parsed.speechRate
          : 0.92,
      preferredVoiceId:
        typeof parsed.preferredVoiceId === "string"
          ? parsed.preferredVoiceId
          : null,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function parseProfile(value: string | null): PersonalProfile {
  if (!value) return DEFAULT_PROFILE;

  try {
    const parsed = JSON.parse(value) as Partial<PersonalProfile>;
    return {
      displayName:
        typeof parsed.displayName === "string"
          ? parsed.displayName.trim().slice(0, 80)
          : "",
      context:
        typeof parsed.context === "string"
          ? parsed.context.trim().slice(0, 2000)
          : "",
      onboardingCompleted: parsed.onboardingCompleted === true,
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

function parseTurns(value: string | null): ConversationTurn[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as ConversationTurn[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (turn) =>
        !turn.privateContext &&
        typeof turn.id === "string" &&
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.content === "string" &&
        typeof turn.createdAt === "number",
    );
  } catch {
    return [];
  }
}

function parseModel(value: string | null): LocalModel | null {
  if (!value) return null;
  try {
    const model = JSON.parse(value) as Partial<LocalModel>;
    if (
      typeof model.id !== "string" ||
      typeof model.name !== "string" ||
      typeof model.uri !== "string" ||
      typeof model.sizeBytes !== "number" ||
      typeof model.importedAt !== "number" ||
      typeof model.contextSize !== "number"
    ) {
      return null;
    }
    return model as LocalModel;
  } catch {
    return null;
  }
}

type StartupRead<T> = {
  value: T;
  failed: boolean;
};

async function readStartupValue<T>(
  read: () => Promise<T>,
  fallback: T,
): Promise<StartupRead<T>> {
  try {
    return { value: await read(), failed: false };
  } catch {
    return { value: fallback, failed: true };
  }
}

function cleanFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function readableError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();
  if (
    normalized.includes("outofmemory") ||
    normalized.includes("out of memory") ||
    normalized.includes("allocation failed") ||
    normalized.includes("cannot allocate") ||
    normalized.includes("bad_alloc") ||
    normalized.includes("failed to create context") ||
    normalized.includes("failed to load model")
  ) {
    return "Android ran out of memory while loading this model. Remove other apps from recents and retry with a smaller Q4 GGUF model.";
  }
  if (
    normalized.includes("no space") ||
    normalized.includes("insufficient storage") ||
    normalized.includes("storage full") ||
    normalized.includes("enospc")
  ) {
    return "There is not enough free storage to copy this model. Free space on the device and try again.";
  }
  if (/request is too long|model was unloaded|privacy controls|shared text (does not fit|requires)/i.test(message)) return message;
  if (/hostfunction|jsi|native/i.test(message)) {
    return "The native model stopped unexpectedly. Reload the model in Settings and retry; your message and partial reply have been kept.";
  }
  return "The model could not be loaded. Choose a smaller compatible GGUF file and try again.";
}

type MicrophonePermissionStatus = "granted" | "denied" | "blocked";

async function requestMicrophonePermission(): Promise<MicrophonePermissionStatus> {
  if (Platform.OS !== "android") return "blocked";
  try {
    const permission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: "Allow Demi to use the microphone",
        message:
          "Demi records after you tap the microphone until you stop or cancel, and transcribes speech on this device.",
        buttonPositive: "Allow",
        buttonNegative: "Not now",
      },
    );
    if (permission === PermissionsAndroid.RESULTS.GRANTED) return "granted";
    if (permission === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      return "blocked";
    }
    return "denied";
  } catch {
    return "denied";
  }
}

async function validateGgufHeader(uri: string) {
  const header = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: 4,
  });
  if (!header.replace(/\s/g, "").startsWith("R0dVRg")) {
    throw new Error(
      "This file is not a valid GGUF model. Choose a compatible Q4_K_M or other Q4 GGUF file.",
    );
  }
}

async function cleanupUnusedModelFiles(
  activeModelUri: string | null,
): Promise<ModelCleanupResult> {
  const result: ModelCleanupResult = {
    status: "completed",
    deletedFiles: 0,
    deletedBytes: 0,
    failedFiles: 0,
  };
  if (Platform.OS === "web" || !FileSystem.documentDirectory) return result;

  const modelsDirectory = `${FileSystem.documentDirectory}models`;
  const normalizedActiveUri = activeModelUri?.replace(/\/$/, "");

  async function removeInactiveFiles(directoryUri: string): Promise<boolean> {
    let entries: string[];
    try {
      entries = await FileSystem.readDirectoryAsync(directoryUri);
    } catch {
      result.status = "unavailable";
      return false;
    }

    for (const entry of entries) {
      const candidateUri = `${directoryUri.replace(/\/$/, "")}/${entry}`;
      if (candidateUri.replace(/\/$/, "") === normalizedActiveUri) continue;

      let info;
      try {
        info = await FileSystem.getInfoAsync(candidateUri);
      } catch {
        result.failedFiles += 1;
        continue;
      }
      if (!info.exists) continue;
      if (info.isDirectory) {
        await removeInactiveFiles(candidateUri);
        continue;
      }

      try {
        await FileSystem.deleteAsync(candidateUri, { idempotent: true });
        const remaining = await FileSystem.getInfoAsync(candidateUri);
        if (remaining.exists) {
          result.failedFiles += 1;
        } else {
          result.deletedFiles += 1;
          result.deletedBytes += info.size ?? 0;
        }
      } catch {
        result.failedFiles += 1;
      }
    }
    return true;
  }

  try {
    const directoryInfo = await FileSystem.getInfoAsync(modelsDirectory);
    if (!directoryInfo.exists) return result;
    if (!directoryInfo.isDirectory) {
      result.status = "unavailable";
      return result;
    }
    await removeInactiveFiles(modelsDirectory);
  } catch {
    result.status = "unavailable";
  }
  return result;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [profile, setProfile] = useState<PersonalProfile>(DEFAULT_PROFILE);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [savedTurnCount, setSavedTurnCount] = useState(0);
  const [isConversationReady, setIsConversationReady] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageUsage, setStorageUsage] = useState<LocalStorageUsage | null>(
    null,
  );
  const [storageUsageRefreshing, setStorageUsageRefreshing] = useState(false);
  const [storageUsageRefreshToken, setStorageUsageRefreshToken] = useState(0);
  const [memories, setMemories] = useState<ApprovedMemory[]>([]);
  const [pendingMemoryCandidate, setPendingMemoryCandidate] =
    useState<MemoryCandidate | null>(null);
  const memoriesRef = useRef<ApprovedMemory[]>([]);
  const memoryMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const storageProtection = getSecureStorageProtection();
  const [privacyReady, setPrivacyReady] = useState(false);
  const [privacyState, setPrivacyState] = useState<PrivacyState>(
    createDefaultPrivacyState(),
  );
  const [privacyResetVersion, setPrivacyResetVersion] = useState(0);
  const [cloudFallbackActivity, setCloudFallbackActivity] =
    useState<CloudFallbackActivity | null>(null);
  const [screenAccessStatus, setScreenAccessStatus] =
    useState<ScreenAccessStatus>({
      platform: "unsupported",
      mediaProjection: "unavailable",
      accessibility: "unavailable",
      activeSource: "none",
      protectedContent: false,
      protectedContentState: "unknown",
      lastStopReason: null,
    });
  const [screenSession, setScreenSession] = useState<ScreenSession>({
    status: "idle",
    accessibilityText: false,
    screenshot: false,
    selectedResource: null,
    protectedContent: false,
    message: null,
  });
  const [localModel, setLocalModel] = useState<LocalModel | null>(null);
  const [screenPreview, setScreenPreview] = useState<SharedScreenContext | null>(null);
  const [screenAttachment, setScreenAttachment] = useState<SharedScreenContext | null>(null);
  const screenAttachmentRef = useRef<SharedScreenContext | null>(null);
  const screenPreviewRef = useRef<SharedScreenContext | null>(null);
  const screenEpochRef = useRef(0);
  const appActiveRef = useRef(true);
  const [engineStatus, setEngineStatus] = useState<
    "unsupported" | "no-model" | "loading" | "ready" | "error"
  >(Platform.OS === "web" ? "unsupported" : "no-model");
  const [engineProgress, setEngineProgress] = useState(0);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [modelSetupStatus, setModelSetupStatus] =
    useState<ModelSetupStatus>("idle");
  const [runtimeDetails, setRuntimeDetails] = useState<RuntimeDetails | null>(
    null,
  );
  const [voiceInputStatus, setVoiceInputStatus] = useState<VoiceInputStatus>(
    Platform.OS === "web" ? "unavailable" : "checking",
  );
  const [voiceInputAvailable, setVoiceInputAvailable] = useState(false);
  const [voiceOutputAvailable, setVoiceOutputAvailable] = useState(false);
  const [offlineVoices, setOfflineVoices] = useState<OfflineVoice[]>([]);
  const [offlineVoicesLoading, setOfflineVoicesLoading] = useState(true);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSetupMessage, setVoiceSetupMessage] = useState<string | null>(
    null,
  );
  const [voiceSetupInProgress, setVoiceSetupInProgress] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceSelfTestResult, setVoiceSelfTestResult] =
    useState<VoiceSelfTestResult | null>(null);
  const [voiceSelfTestRunning, setVoiceSelfTestRunning] = useState(false);
  const [voiceSelfTestSpeechStatus, setVoiceSelfTestSpeechStatus] = useState<
    "idle" | "speaking"
  >("idle");

  const [downloadStatus, setDownloadStatus] = useState<
    "idle" | "downloading" | "validating" | "loading" | "error"
  >("idle");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadResumableRef = useRef<any>(null);

  const deviceCompatibility = useMemo(() => getDeviceCompatibility(), []);
  const llamaContextRef = useRef<LlamaContext | null>(null);
  const voiceModuleRef = useRef<OfflineVoiceModule | null>(null);
  const recognitionSubscriptionsRef = useRef<Array<{ remove: () => void }>>([]);
  const voiceRecognitionRunRef = useRef(0);
  const voiceRecognitionActiveRef = useRef(false);
  const voiceTranscriptRef = useRef("");
  const voiceModelPreparationRef = useRef(false);
  const voiceSelfTestActiveRef = useRef(false);
  const voiceSelfTestStopRef = useRef<(() => void) | null>(null);
  const voiceSelfTestCancelRef = useRef<(() => void) | null>(null);
  const voiceSelfTestCancelRequestedRef = useRef(false);
  const voiceSelfTestSpeechRunRef = useRef(0);
  const speechRunRef = useRef(0);
  const didRestoreModelRef = useRef(false);
  const modelImportInFlightRef = useRef(false);
  const modelLoadInFlightRef = useRef(false);
  const downloadRunRef = useRef(0);
  const clearConversationInFlightRef = useRef(false);
  const chatInFlightRef = useRef(false);
  const privacyStateRef = useRef(privacyState);
  const screenSessionRef = useRef(screenSession);
  const privacyMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const settingsRef = useRef(settings);
  const storageMeasurementRunRef = useRef(0);
  const turnsRef = useRef<ConversationTurn[]>([]);
  const streamUpdateRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    turnId: string | null;
    content: string;
    run: number;
  }>({ timer: null, turnId: null, content: "", run: 0 });
  const memorySuggestionRunRef = useRef(0);
  const memorySuggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  settingsRef.current = settings;
  privacyStateRef.current = privacyState;
  screenSessionRef.current = screenSession;
  turnsRef.current = turns;

  function clearRecognitionSubscriptions() {
    recognitionSubscriptionsRef.current.forEach((subscription) => {
      subscription.remove();
    });
    recognitionSubscriptionsRef.current = [];
  }

  function voiceInputApproved() {
    return privacyReady && settingsRef.current.voiceInputEnabled &&
      isCapabilityActive(privacyStateRef.current, "local.voice-input");
  }

  async function refreshScreenAccessStatus() {
    const status = await getScreenAccessStatus();
    setScreenAccessStatus(status);
  }

  function discardScreenContext() {
    screenEpochRef.current += 1;
    screenAttachmentRef.current = null;
    screenPreviewRef.current = null;
    setScreenPreview(null);
    setScreenAttachment(null);
    // Screen-derived replies are transient too, not just their inputs.
    commitTurns(turnsRef.current.filter((turn) => !turn.privateContext));
  }

  function screenAllowed() {
    return appActiveRef.current && isCapabilityActive(privacyStateRef.current, "device.screen-access") &&
      isCapabilityActive(privacyStateRef.current, "local.inference") &&
      (!screenSessionRef.current.selectedResource || isCapabilityActive(privacyStateRef.current, "local.files"));
  }

  function attachScreenContext(text: string) {
    const preview = screenPreviewRef.current;
    if (!screenContextValid(preview, screenEpochRef.current, screenAllowed())) {
      discardScreenContext();
      throw new Error("This capture expired or approval ended. Capture again.");
    }
    const attached = createScreenContext(text, preview!.source, preview!.epoch, preview!.capturedAt);
    screenAttachmentRef.current = attached;
    setScreenAttachment(attached);
    screenPreviewRef.current = null;
    setScreenPreview(null);
  }

  async function startScreenSession(options: {
    accessibilityText: boolean;
    screenshot: boolean;
    selectedResource?: ScreenSession["selectedResource"];
  }) {
    if (!isCapabilityActive(privacyStateRef.current, "device.screen-access")) {
      setScreenSession((current) => ({
        ...current,
        status: "error",
        message: "Enable Screen access in Settings before starting a session.",
      }));
      return false;
    }
    if (!options.accessibilityText && !options.screenshot && !options.selectedResource) {
      setScreenSession((current) => ({
        ...current,
        status: "error",
        message: "Choose accessibility text, a screenshot, or a selected resource.",
      }));
      return false;
    }

    discardScreenContext();
    const epoch = screenEpochRef.current;
    setScreenSession({
      status: "starting",
      accessibilityText: false,
      screenshot: false,
      selectedResource: options.selectedResource ?? null,
      protectedContent: false,
      message: null,
    });

    try {
      let status = await getScreenAccessStatus();
      if (options.accessibilityText && status.accessibility !== "enabled") {
        setScreenSession({
          status: "error",
          accessibilityText: false,
          screenshot: false,
          selectedResource: options.selectedResource ?? null,
          protectedContent: false,
          message: "Accessibility text is not enabled. Enable Demi in Android Settings first.",
        });
        return false;
      }
      const accessibilitySnapshot = options.accessibilityText
        ? await getAccessibilitySnapshot(privacyStateRef.current.screenPolicy.excludedApps)
        : null;
      if (accessibilitySnapshot?.protectedContent || accessibilitySnapshot?.excluded) {
        throw new Error("Protected or excluded content was withheld. Choose another source.");
      }
      let text = accessibilitySnapshot?.text ?? "";
      let source: SharedScreenContext["source"] = "accessibility";
      if (options.screenshot) {
        text = await captureScreenshotText(privacyStateRef.current.screenPolicy.excludedApps);
        source = "screenshot";
      }
      if (options.selectedResource) {
        if (!isCapabilityActive(privacyStateRef.current, "local.files")) throw new Error("Selected file access is paused or revoked in Settings.");
        const resource = options.selectedResource;
        if (!resource.uri) throw new Error("Choose the file again; no readable file was shared.");
        const kind = supportedScreenResource(resource.name, resource.mimeType);
        const info = await FileSystem.getInfoAsync(resource.uri);
        const size = resource.size ?? (info.exists && "size" in info ? info.size : null);
        if (size === null || size > (kind === "image" ? 10_000_000 : MAX_SCREEN_FILE_BYTES)) {
          throw new Error("Choose a text file under 120 KB or an image under 10 MB.");
        }
        text = kind === "image" ? await readImageText(resource.uri) : await FileSystem.readAsStringAsync(resource.uri, { length: MAX_SCREEN_FILE_BYTES });
        source = "resource";
      }
      if (epoch !== screenEpochRef.current || !screenAllowed()) throw new Error("Capture stopped or approval ended. Try again.");
      const preview = createScreenContext(text, source, epoch);
      screenPreviewRef.current = preview;
      setScreenPreview(preview);
      const nextSession: ScreenSession = {
        status: "active",
        accessibilityText:
          options.accessibilityText &&
            Boolean(accessibilitySnapshot?.available) &&
            !accessibilitySnapshot?.excluded,
        screenshot: options.screenshot,
        selectedResource: options.selectedResource ?? null,
        protectedContent: Boolean(
          status.protectedContent || accessibilitySnapshot?.protectedContent,
        ),
        message: "Text captured, not attached. Review it and share with one local request. Expires in two minutes.",
      };
      setScreenSession(nextSession);
      await recordPrivacyAction({
        capabilityId: "device.screen-access",
        action: "screen-session-started",
        status: "allowed",
        summary: `Screen session started with ${[
          nextSession.accessibilityText ? "accessibility text" : "",
          nextSession.screenshot ? "screenshot" : "",
          nextSession.selectedResource ? "selected resource" : "",
        ].filter(Boolean).join(", ")}.`,
      });
      return true;
    } catch (error) {
      if (epoch !== screenEpochRef.current) return false;
      discardScreenContext();
      await stopNativeScreenSession("capture-failed").catch(() => undefined);
      setScreenSession((current) => ({
        ...current,
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "The screen session could not start.",
      }));
      return false;
    }
  }

  async function stopScreenSession(reason = "user-stopped") {
    discardScreenContext();
    await stopNativeScreenSession(reason);
    const wasActive =
      screenSessionRef.current.status === "active" ||
      screenSessionRef.current.status === "starting";
    setScreenSession((current) => ({
      ...current,
      status: "stopped",
      accessibilityText: false,
      screenshot: false,
      selectedResource: null,
      protectedContent: false,
      message: reason === "app-paused"
        ? "Session stopped because Demi was paused."
        : "Session stopped. Transient screen data was discarded.",
    }));
    await refreshScreenAccessStatus().catch(() => undefined);
    if (wasActive) {
      await recordPrivacyAction({
        capabilityId: "device.screen-access",
        action: "screen-session-stopped",
        status: reason === "user-stopped" ? "completed" : "interrupted",
        summary: `Screen session stopped: ${reason}.`,
      });
    }
  }

  async function updateScreenPolicy(patch: Partial<ScreenPrivacyPolicy>) {
    await stopScreenSession("policy-changed");
    await mutatePrivacyState((current) => ({
      ...current,
      screenPolicy: {
        ...current.screenPolicy,
        ...patch,
        excludedApps: patch.excludedApps ?? current.screenPolicy.excludedApps,
      },
    }));
  }

  useEffect(() => {
    void refreshScreenAccessStatus().catch(() => undefined);
    const subscription = AppState.addEventListener("change", (state) => {
      appActiveRef.current = state === "active";
      if (state === "active") {
        void refreshScreenAccessStatus().catch(() => undefined);
        refreshStorageUsage();
        return;
      }
      if (
        screenSessionRef.current.status === "active" ||
        screenSessionRef.current.status === "starting"
      ) {
        void stopScreenSession("app-paused");
      }
      if (state === "background") {
        // A session lasts for the foreground process session. Revocation is
        // immediate in memory even if persisting the expired state fails.
        const next = endPrivacySession(privacyStateRef.current);
        privacyStateRef.current = next;
        setPrivacyState(next);
        void mutatePrivacyState(endPrivacySession).catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const context = screenAttachmentRef.current ?? screenPreviewRef.current;
      if (context && !screenContextValid(context, screenEpochRef.current, screenAllowed())) {
        void stopScreenSession("expired");
      }
      if ((!isCapabilityActive(privacyStateRef.current, "local.voice-input") ||
        !settingsRef.current.voiceInputEnabled || !appActiveRef.current) &&
        (voiceRecognitionActiveRef.current || voiceSelfTestActiveRef.current)) {
        cancelVoiceInput();
        cancelVoiceSelfTest();
        setVoiceError("Voice approval ended. Resume it in Settings before trying again.");
      }
      if (!isCapabilityActive(privacyStateRef.current, "local.voice-output") &&
        (isSpeaking || voiceSelfTestSpeechStatus === "speaking")) void stopSpeaking();
    }, 1000);
    return () => clearInterval(timer);
  }, [isSpeaking, voiceSelfTestSpeechStatus]);

  function refreshStorageUsage() {
    setStorageUsageRefreshing(true);
    setStorageUsageRefreshToken((current) => current + 1);
  }

  async function reclaimUnusedModelFiles() {
    if (
      modelImportInFlightRef.current ||
      modelLoadInFlightRef.current ||
      modelSetupStatus !== "idle" ||
      (downloadStatus !== "idle" && downloadStatus !== "error")
    ) {
      return {
        status: "unavailable",
        deletedFiles: 0,
        deletedBytes: 0,
        failedFiles: 0,
      } satisfies ModelCleanupResult;
    }
    return cleanupUnusedModelFiles(localModel?.uri ?? null);
  }

  useEffect(() => {
    let isMounted = true;
    const finishStartupMetricOnce = startRuntimeMetric("startup.local-data");
    let startupMetricFinished = false;
    const finishStartupMetric = (details?: Record<string, string | number | boolean>) => {
      if (startupMetricFinished) return;
      startupMetricFinished = true;
      finishStartupMetricOnce(details);
    };

    void (async () => {
      const [
        settingsResult,
        modelResult,
        conversationResult,
        profileResult,
        memoriesResult,
        privacyResult,
      ] = await Promise.all([
        readStartupValue(() => AsyncStorage.getItem(SETTINGS_KEY), null),
        readStartupValue(() => AsyncStorage.getItem(MODEL_KEY), null),
        readStartupValue(
          () => migratePlaintextRecord(SECURE_CONVERSATION_KEY, CONVERSATION_KEY),
          null,
        ),
        readStartupValue(
          () => migratePlaintextRecord(SECURE_PROFILE_KEY, PROFILE_KEY),
          null,
        ),
        readStartupValue(() => readSecureRecord(SECURE_MEMORIES_KEY), null),
        readStartupValue(
          () => readSecureRecord(SECURE_PRIVACY_STATE_KEY),
          null,
        ),
      ]);

      if (!isMounted) return;

      let nextSettings = DEFAULT_SETTINGS;
      let savedTurns: ConversationTurn[] = [];
      let savedModel: LocalModel | null = null;
      let savedProfile = DEFAULT_PROFILE;
      let savedMemories: ReturnType<typeof parseApprovedMemories> = [];
      let savedPrivacyState = createDefaultPrivacyState();
      try {
        nextSettings = parseSettings(settingsResult.value);
        savedTurns = parseTurns(conversationResult.value);
        savedModel = parseModel(modelResult.value);
        savedProfile = parseProfile(profileResult.value);
        savedMemories = parseApprovedMemories(memoriesResult.value);
        savedPrivacyState = parsePrivacyState(privacyResult.value);
      } catch {
        setStorageError(
          "Some saved local data could not be read. Chat, memory, and voice controls remain available with safe defaults.",
        );
      }

      setSettings(nextSettings);
      setProfile(savedProfile);
      setMemories(savedMemories);
      memoriesRef.current = savedMemories;
      setPrivacyState(savedPrivacyState);
      privacyStateRef.current = savedPrivacyState;
      setSavedTurnCount(savedTurns.length);
      setTurns(nextSettings.saveConversations ? savedTurns : []);
      let activeModelUri: string | null = null;
      if (savedModel && Platform.OS !== "web") {
        try {
          const file = await FileSystem.getInfoAsync(savedModel.uri);
          if (file.exists) {
            setLocalModel(savedModel);
            activeModelUri = savedModel.uri;
            setEngineStatus("no-model");
          } else {
            await AsyncStorage.removeItem(MODEL_KEY);
          }
        } catch {
          setStorageError(
            "The saved model could not be checked. Chat, memory, and voice controls remain available.",
          );
        }
      }
      await cleanupUnusedModelFiles(activeModelUri).catch(() => undefined);
      if (
        settingsResult.failed ||
        modelResult.failed ||
        conversationResult.failed ||
        profileResult.failed ||
        memoriesResult.failed
        || privacyResult.failed
      ) {
        setStorageError(
          "Some local data could not be opened. Chat, memory, and voice controls remain available; affected values are unavailable.",
        );
      }
      setSettingsReady(true);
      setIsConversationReady(true);
      setPrivacyReady(true);
      finishStartupMetric({
        savedTurns: savedTurns.length,
        savedMemories: savedMemories.length,
      });
    })();

    return () => {
      isMounted = false;
      finishStartupMetric();
      if (streamUpdateRef.current.timer) {
        clearTimeout(streamUpdateRef.current.timer);
        streamUpdateRef.current.timer = null;
      }
      if (memorySuggestionTimerRef.current) {
        clearTimeout(memorySuggestionTimerRef.current);
        memorySuggestionTimerRef.current = null;
      }
      memorySuggestionRunRef.current += 1;
      if (llamaContextRef.current) void releaseNativeContext(llamaContextRef.current);
      llamaContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    let isMounted = true;
    const measurementRun = storageMeasurementRunRef.current + 1;
    storageMeasurementRunRef.current = measurementRun;
    setStorageUsageRefreshing(true);
    void measureLocalStorageUsage(localModel?.uri ?? null, {
      settings: SETTINGS_KEY,
      model: MODEL_KEY,
      conversation: SECURE_CONVERSATION_KEY,
      profile: SECURE_PROFILE_KEY,
      memories: SECURE_MEMORIES_KEY,
      privacyState: SECURE_PRIVACY_STATE_KEY,
    })
      .then((usage) => {
        if (
          !isMounted ||
          measurementRun !== storageMeasurementRunRef.current
        ) {
          return;
        }
        setStorageUsage(usage);
        if (measurementRun === storageMeasurementRunRef.current) {
          setStorageUsageRefreshing(false);
        }
      })
      .catch(() => {
        if (
          !isMounted ||
          measurementRun !== storageMeasurementRunRef.current
        ) {
          return;
        }
        setStorageUsage((previous) => previous ?? createUnavailableLocalStorageUsage());
        if (measurementRun === storageMeasurementRunRef.current) {
          setStorageUsageRefreshing(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [
    settingsReady,
    settings.saveConversations,
    profile,
    turns,
    memories,
    localModel?.uri,
    storageUsageRefreshToken,
  ]);

  useEffect(() => {
    const module = getVoiceModule();
    voiceModuleRef.current = module;
    if (!module) {
      setVoiceInputStatus("unavailable");
      setVoiceInputAvailable(false);
      setVoiceOutputAvailable(false);
      setOfflineVoices([]);
      setOfflineVoicesLoading(false);
      return () => {
        void stopLocalSpeech();
      };
    }

    void refreshOfflineVoices();
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          void refreshOfflineVoices();
        } else {
          voiceSelfTestCancelRef.current?.();
          cancelVoiceInput();
          void stopSpeaking();
        }
      },
    );

    return () => {
      voiceRecognitionRunRef.current += 1;
      voiceRecognitionActiveRef.current = false;
      clearRecognitionSubscriptions();
      voiceSelfTestCancelRef.current?.();
      appStateSubscription.remove();
      void cancelLocalRecognition(voiceRecognitionRunRef.current);
      void stopLocalSpeech();
    };
  }, []);

  // Re-check after persisted settings finish loading and whenever the
  // selected language changes. Without this, changing languages could leave
  // the readiness indicators showing the previous locale until the app was
  // backgrounded and resumed.
  useEffect(() => {
    if (!settingsReady) return;
    void refreshOfflineVoices();
  }, [settingsReady, settings.voiceLanguage]);

  async function refreshOfflineVoices() {
    if (voiceRecognitionActiveRef.current || voiceSelfTestActiveRef.current) return;
    setOfflineVoicesLoading(true);
    try {
      const [readiness, voices] = await Promise.all([
        getVoiceReadiness(),
        getOfflineVoices(),
      ]);
      setOfflineVoices(voices);
      setVoiceInputAvailable(readiness.inputAvailable);
      setVoiceInputStatus(
        readiness.inputAvailable ? "idle" : Platform.OS === "android" ? "needs-model" : "unavailable",
      );
      setVoiceSetupMessage(readiness.error);
      setVoiceOutputAvailable(
        readiness.outputAvailable &&
          voices.some((voice) =>
          voiceMatchesLanguage(
            voice.language,
            settingsRef.current.voiceLanguage,
          ),
          ),
      );
    } catch (error) {
      setOfflineVoices([]);
      setVoiceInputAvailable(false);
      setVoiceInputStatus(
        Platform.OS === "android" ? "needs-model" : "unavailable",
      );
      setVoiceSetupMessage(
        error instanceof Error
          ? error.message
          : "The bundled offline voice models could not be checked.",
      );
      setVoiceOutputAvailable(false);
    } finally {
      setOfflineVoicesLoading(false);
    }
  }

  async function releaseModelContext(clearDetails = false) {
    const context = llamaContextRef.current;
    llamaContextRef.current = null;
    if (context) await releaseNativeContext(context);
    if (clearDetails) setRuntimeDetails(null);
  }

  async function loadModel(modelOverride?: LocalModel): Promise<boolean> {
    const model = modelOverride ?? localModel;
    if (!model || modelLoadInFlightRef.current) return false;

    modelLoadInFlightRef.current = true;
    setModelSetupStatus("loading");
    setEngineStatus("loading");
    setEngineProgress(0);
    setEngineError(null);

    try {
      await releaseModelContext();
      const loaded = await loadNativeModel(
        model,
        deviceCompatibility,
        setEngineProgress,
      );
      llamaContextRef.current = loaded.context;
      setRuntimeDetails(loaded.details);
      setEngineProgress(100);
      setEngineStatus("ready");
      return true;
    } catch (error) {
      setEngineError(readableError(error));
      setEngineStatus("error");
      return false;
    } finally {
      modelLoadInFlightRef.current = false;
      setModelSetupStatus("idle");
    }
  }

  useEffect(() => {
    if (!settingsReady || didRestoreModelRef.current) return;
    didRestoreModelRef.current = true;
    if (localModel) void loadModel(localModel);
  }, [settingsReady, localModel]);

  async function importModel() {
    if (modelImportInFlightRef.current || modelLoadInFlightRef.current) return;
    if (Platform.OS === "web") {
      setEngineError(
        "Model import and offline inference are available in the installed Android app.",
      );
      setEngineStatus("unsupported");
      return;
    }

    modelImportInFlightRef.current = true;
    setModelSetupStatus("selecting");
    setEngineError(null);
    let destination: string | null = null;
    let loadedNewModel = false;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/octet-stream",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) {
        setModelSetupStatus("idle");
        return;
      }

      const asset = result.assets[0];
      if (!asset.name.toLowerCase().endsWith(".gguf")) {
        setEngineError("Choose a quantized model file ending in .gguf.");
        setEngineStatus("error");
        setModelSetupStatus("idle");
        return;
      }

      setModelSetupStatus("validating");
      const sourceInfo = await FileSystem.getInfoAsync(asset.uri);
      const sizeBytes =
        asset.size ?? (sourceInfo.exists ? (sourceInfo.size ?? 0) : 0);
      if (sizeBytes <= 0) {
        setEngineError("The selected file could not be read.");
        setEngineStatus("error");
        setModelSetupStatus("idle");
        return;
      }
      await validateGgufHeader(asset.uri);

      let freeStorageBytes: number;
      try {
        freeStorageBytes = await FileSystem.getFreeDiskStorageAsync();
      } catch {
        throw new Error(
          "Demi could not check free storage before copying this model. Try again after closing other apps.",
        );
      }
      if (freeStorageBytes < sizeBytes + MODEL_STORAGE_SAFETY_MARGIN_BYTES) {
        throw new Error(
          `There is not enough free storage to copy this ${formatBytes(sizeBytes)} model. Free at least ${formatBytes(
            sizeBytes + MODEL_STORAGE_SAFETY_MARGIN_BYTES,
          )} and try again.`,
        );
      }

      const modelsDirectory = `${FileSystem.documentDirectory}models`;
      await FileSystem.makeDirectoryAsync(modelsDirectory, {
        intermediates: true,
      });
      destination = `${modelsDirectory}/${Date.now()}-${cleanFileName(asset.name)}`;
      setModelSetupStatus("copying");
      await FileSystem.copyAsync({ from: asset.uri, to: destination });
      setModelSetupStatus("validating");
      const copiedInfo = await FileSystem.getInfoAsync(destination);
      if (!copiedInfo.exists || (copiedInfo.size ?? 0) !== sizeBytes) {
        throw new Error(
          "The model copy did not finish correctly. Remove the partial file and try importing it again.",
        );
      }
      await validateGgufHeader(destination);

      const nextModel: LocalModel = {
        id: createId(),
        name: asset.name,
        uri: destination,
        sizeBytes,
        importedAt: Date.now(),
        contextSize: deviceCompatibility.contextSize,
      };

      if (nextModel.sizeBytes > deviceCompatibility.maxRecommendedModelBytes) {
        await FileSystem.deleteAsync(destination, { idempotent: true });
        destination = null;
        setEngineError(
          `${asset.name} is ${formatBytes(sizeBytes)}. Choose a model smaller than ${formatBytes(
            deviceCompatibility.maxRecommendedModelBytes,
          )} to avoid a low-memory crash.`,
        );
        setEngineStatus("error");
        setModelSetupStatus("idle");
        return;
      }

      const previousModel = localModel;
      const loaded = await loadModel(nextModel);
      if (!loaded) {
        await FileSystem.deleteAsync(destination, { idempotent: true });
        destination = null;
        return;
      }
      loadedNewModel = true;
      await AsyncStorage.setItem(MODEL_KEY, JSON.stringify(nextModel));
      setStorageError(null);
      setLocalModel(nextModel);
      destination = null;
      if (previousModel && previousModel.uri !== nextModel.uri) {
        await FileSystem.deleteAsync(previousModel.uri, {
          idempotent: true,
        }).catch(() => {});
      }
      await cleanupUnusedModelFiles(nextModel.uri);
    } catch (error) {
      if (destination) {
        await FileSystem.deleteAsync(destination, { idempotent: true }).catch(
          () => {},
        );
      }
      if (loadedNewModel) await releaseModelContext();
      setEngineError(readableError(error));
      setEngineStatus("error");
      setModelSetupStatus("idle");
    } finally {
      modelImportInFlightRef.current = false;
    }
  }

  async function removeModel() {
    const model = localModel;
    if (
      !model ||
      modelImportInFlightRef.current ||
      modelLoadInFlightRef.current
    ) {
      return;
    }
    try {
      await AsyncStorage.removeItem(MODEL_KEY);
      await releaseModelContext(true);
      if (model) await FileSystem.deleteAsync(model.uri, { idempotent: true });
      setLocalModel(null);
      setEngineProgress(0);
      setEngineError(null);
      setEngineStatus(Platform.OS === "web" ? "unsupported" : "no-model");
      setStorageError(null);
    } catch {
      setStorageError(
        "The model could not be removed completely. Your saved model selection was kept.",
      );
    }
  }

  function cancelDownload() {
    downloadRunRef.current += 1;
    if (downloadResumableRef.current) {
      downloadResumableRef.current.cancelAsync().catch(() => {});
      const dest = downloadResumableRef.current.fileUri;
      if (dest)
        FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
      downloadResumableRef.current = null;
    }
    setDownloadError(null);
    setDownloadStatus("idle");
    setDownloadProgress(0);
  }

  async function downloadRecommendedModel() {
    if (
      !privacyReady ||
      !isCapabilityActive(privacyState, "network.model-download")
    ) {
      setDownloadError(
        privacyState.globalPause
          ? "Privacy pause is active. Resume privileged actions in Settings before downloading a model."
          : "Model downloads are off by default. Approve the download in Model settings first.",
      );
      setDownloadStatus("error");
      return;
    }
    void recordPrivacyAction({
      capabilityId: "network.model-download",
      action: "recommended-model-download",
      status: "allowed",
      summary:
        "A named model file download started; no conversation data was sent.",
    }).catch(() => undefined);
    if (modelLoadInFlightRef.current || downloadStatus === "downloading")
      return;
    if (Platform.OS === "web") {
      setDownloadError(
        "Model download is available in the installed Android app.",
      );
      setDownloadStatus("error");
      return;
    }

    const runId = downloadRunRef.current + 1;
    downloadRunRef.current = runId;
    setDownloadStatus("downloading");
    setDownloadProgress(0);
    setDownloadError(null);

    const modelsDirectory = `${FileSystem.documentDirectory}models`;
    const destination = `${modelsDirectory}/${Date.now()}-${RECOMMENDED_MODEL.name}`;
    let loadedNewModel = false;

    try {
      if (!deviceCompatibility.architectureSupported) {
        throw new Error(
          "This device needs a 64-bit ARM or x86-64 processor to run the local model.",
        );
      }
      if (
        RECOMMENDED_MODEL.sizeBytes >
        deviceCompatibility.maxRecommendedModelBytes
      ) {
        throw new Error(
          `This model is too large for the available memory. Import a GGUF smaller than ${formatBytes(
            deviceCompatibility.maxRecommendedModelBytes,
          )}.`,
        );
      }
      let freeStorageBytes: number;
      try {
        freeStorageBytes = await FileSystem.getFreeDiskStorageAsync();
      } catch {
        throw new Error("Could not check free storage.");
      }
      if (
        freeStorageBytes <
        RECOMMENDED_MODEL.sizeBytes + MODEL_STORAGE_SAFETY_MARGIN_BYTES
      ) {
        throw new Error(
          `Not enough free storage. Need ${formatBytes(
            RECOMMENDED_MODEL.sizeBytes + MODEL_STORAGE_SAFETY_MARGIN_BYTES,
          )}.`,
        );
      }
      await FileSystem.makeDirectoryAsync(modelsDirectory, {
        intermediates: true,
      });

      const downloadResumable = FileSystem.createDownloadResumable(
        RECOMMENDED_MODEL.url,
        destination,
        {},
        (downloadProgress) => {
          const progress =
            downloadProgress.totalBytesWritten /
            downloadProgress.totalBytesExpectedToWrite;
          setDownloadProgress(progress * 100);
        },
      );
      downloadResumableRef.current = downloadResumable;

      const result = await downloadResumable.downloadAsync();
      downloadResumableRef.current = null;
      if (runId !== downloadRunRef.current) {
        await FileSystem.deleteAsync(destination, { idempotent: true });
        return;
      }

      if (!result || result.status !== 200) {
        throw new Error("Download failed.");
      }

      const downloadedInfo = await FileSystem.getInfoAsync(destination);
      if (
        !downloadedInfo.exists ||
        downloadedInfo.size !== RECOMMENDED_MODEL.sizeBytes
      ) {
        throw new Error("Downloaded file size does not match expected size.");
      }

      setDownloadStatus("validating");
      await validateGgufHeader(destination);

      const checksum = await computeFileSha256(destination);
      if (checksum !== RECOMMENDED_MODEL.expectedChecksum) {
        throw new Error(
          "Downloaded file checksum does not match expected checksum.",
        );
      }

      setDownloadStatus("loading");

      const nextModel: LocalModel = {
        id: createId(),
        name: RECOMMENDED_MODEL.name,
        uri: destination,
        sizeBytes: RECOMMENDED_MODEL.sizeBytes,
        importedAt: Date.now(),
        contextSize: deviceCompatibility.contextSize,
      };

      const previousModel = localModel;
      const loaded = await loadModel(nextModel);
      if (runId !== downloadRunRef.current) {
        await FileSystem.deleteAsync(destination, { idempotent: true });
        await releaseModelContext();
        return;
      }
      if (!loaded) {
        await FileSystem.deleteAsync(destination, { idempotent: true });
        setDownloadStatus("idle");
        return;
      }
      loadedNewModel = true;

      await AsyncStorage.setItem(MODEL_KEY, JSON.stringify(nextModel));
      setStorageError(null);
      setLocalModel(nextModel);

      if (previousModel && previousModel.uri !== nextModel.uri) {
        await FileSystem.deleteAsync(previousModel.uri, {
          idempotent: true,
        }).catch(() => {});
      }
      await cleanupUnusedModelFiles(nextModel.uri);

      setDownloadStatus("idle");
    } catch (error) {
      downloadResumableRef.current = null;
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(
        () => {},
      );
      if (runId !== downloadRunRef.current) return;
      if (loadedNewModel) await releaseModelContext();
      setDownloadError(
        error instanceof Error ? error.message : "Download failed.",
      );
      setDownloadStatus("error");
    }
  }

  async function startVoiceInput() {
    if (voiceSelfTestActiveRef.current) {
      setVoiceError("Stop the microphone test in Settings before starting dictation.");
      return;
    }
    const previousRunId = voiceRecognitionRunRef.current;
    const runId = previousRunId + 1;
    voiceRecognitionRunRef.current = runId;
    voiceRecognitionActiveRef.current = false;
    clearRecognitionSubscriptions();
    await cancelLocalRecognition(previousRunId).catch(() => undefined);
    voiceTranscriptRef.current = "";
    setVoiceTranscript("");

    if (!privacyReady || !isCapabilityActive(privacyStateRef.current, "local.voice-input")) {
      setVoiceInputStatus("error");
      setVoiceError(
        privacyState.globalPause
          ? "Privacy pause is active. Resume privileged actions in Settings before using the microphone."
          : "Offline voice input is paused or revoked in Settings.",
      );
      return;
    }
    if (!settings.voiceInputEnabled) {
      setVoiceError("Voice input is turned off in Settings.");
      return;
    }

    const module = voiceModuleRef.current;
    if (!module) {
      setVoiceInputStatus("unavailable");
      setVoiceError(
        "Offline listening needs the installed Android build. It is not included in Expo Go or the browser preview.",
      );
      return;
    }

    if (Platform.OS !== "android") {
      setVoiceInputStatus("unavailable");
      setVoiceError(
        "Bundled offline voice input is available in the installed Android app.",
      );
      return;
    }

    setVoiceError(null);
    setVoiceSetupMessage(null);
    setVoiceInputStatus("checking");
    await stopSpeaking();

    try {
      const permission = await requestMicrophonePermission();
      if (runId !== voiceRecognitionRunRef.current || !voiceInputApproved()) return;
      if (permission !== "granted") {
        setVoiceInputStatus("error");
        setVoiceError(
          permission === "blocked"
            ? "Microphone access is blocked. Enable it for Demi in Android Settings."
            : "Microphone access is required for local voice input.",
        );
        return;
      }

      const readiness = await getVoiceReadiness();
      if (runId !== voiceRecognitionRunRef.current || !voiceInputApproved()) return;
      if (!readiness.inputAvailable) {
        setVoiceInputStatus("needs-model");
        setVoiceError(
          readiness.error ??
            "The bundled English recognition model is not ready. Prepare the offline voice models in Settings.",
        );
        return;
      }

      setVoiceInputStatus("checking");
      const subscriptions = [
        module.addListener(
          "recognitionResult",
          (event: RecognitionResultEvent) => {
            if (runId !== voiceRecognitionRunRef.current || event.sessionId !== runId || !voiceInputApproved()) return;
            const transcript = event.transcript.trim();
            if (transcript) {
              voiceTranscriptRef.current = transcript;
              if (event.isFinal) setVoiceTranscript(transcript);
            }
            if (event.isFinal) setVoiceInputStatus("processing");
          },
        ),
        module.addListener(
          "recognitionStatus",
          (event: RecognitionStatusEvent) => {
            if (runId !== voiceRecognitionRunRef.current || event.sessionId !== runId || !voiceInputApproved()) return;
            if (event.status === "listening") {
              setVoiceInputStatus("listening");
              setVoiceError(null);
            } else if (event.status === "processing") {
              setVoiceInputStatus("processing");
            } else if (event.status === "completed") {
              voiceRecognitionActiveRef.current = false;
              clearRecognitionSubscriptions();
              if (!voiceTranscriptRef.current.trim()) {
                setVoiceError(
                  "No speech was detected. Tap the microphone and try again.",
                );
                setVoiceInputStatus("error");
              } else {
                setVoiceInputStatus("idle");
              }
            } else if (event.status === "cancelled") {
              voiceRecognitionActiveRef.current = false;
              clearRecognitionSubscriptions();
              setVoiceInputStatus("idle");
            } else {
              voiceRecognitionActiveRef.current = false;
              clearRecognitionSubscriptions();
              setVoiceInputStatus("error");
              setVoiceError(voiceErrorMessage(event.message));
            }
          },
        ),
      ];
      recognitionSubscriptionsRef.current = subscriptions;
      voiceRecognitionActiveRef.current = true;
      if (runId !== voiceRecognitionRunRef.current) {
        clearRecognitionSubscriptions();
        voiceRecognitionActiveRef.current = false;
        return;
      }
      await startLocalRecognition(runId);
      void recordPrivacyAction({
        capabilityId: "local.voice-input",
        action: "offline-voice-input",
        status: "allowed",
        summary: "On-device microphone capture started; audio content omitted.",
      }).catch(() => undefined);
    } catch (error) {
      if (runId !== voiceRecognitionRunRef.current) return;
      voiceRecognitionActiveRef.current = false;
      clearRecognitionSubscriptions();
      voiceTranscriptRef.current = "";
      setVoiceTranscript("");
      setVoiceInputStatus("error");
      setVoiceError(
        error instanceof Error
          ? error.message
          : "Offline voice input could not start.",
      );
    }
  }

  function stopVoiceInput() {
    const module = voiceModuleRef.current;
    if (!module || !voiceRecognitionActiveRef.current) {
      cancelVoiceInput();
      return;
    }
    setVoiceInputStatus("processing");
    void stopLocalRecognition(voiceRecognitionRunRef.current).catch(() => {
      cancelVoiceInput();
      setVoiceInputStatus("error");
      setVoiceError("Recording could not stop cleanly. Tap the microphone to retry.");
    });
  }

  function cancelVoiceInput() {
    const sessionId = voiceRecognitionRunRef.current;
    voiceRecognitionRunRef.current += 1;
    voiceRecognitionActiveRef.current = false;
    clearRecognitionSubscriptions();
    void cancelLocalRecognition(sessionId);
    voiceTranscriptRef.current = "";
    setVoiceTranscript("");
    setVoiceInputStatus("idle");
    setVoiceError(null);
  }

  function clearVoiceTranscript() {
    voiceTranscriptRef.current = "";
    setVoiceTranscript("");
  }

  async function runVoiceSelfTest() {
    if (voiceSelfTestRunning) return;
    if (!voiceInputApproved()) {
      setVoiceError("Voice input is paused, revoked, or disabled. Resume it in Settings before testing.");
      return;
    }

    const module = voiceModuleRef.current;
    if (!module || Platform.OS !== "android") {
      setVoiceSelfTestResult({
        kind: "recognition",
        outcome: "recognizer-unavailable",
        title: "Voice self-test is unavailable here",
        detail:
          "The browser preview does not access the microphone or a local Android recognizer.",
        nextAction: "Run this test from the installed Android app.",
      });
      return;
    }

    setVoiceSelfTestRunning(true);
    voiceSelfTestCancelRequestedRef.current = false;
    setVoiceSelfTestResult({
      kind: "recognition",
      outcome: "running",
      title: "Preparing the bundled speech model",
      detail:
        "Demi runs recognition locally with the model packaged in the app.",
      nextAction: "When the microphone opens, speak a short phrase.",
    });
    voiceSelfTestActiveRef.current = true;

    try {
      const permission = await requestMicrophonePermission();
      if (voiceSelfTestCancelRequestedRef.current || !voiceInputApproved()) return;
      if (permission !== "granted") {
        setVoiceSelfTestResult({
          kind: "recognition",
          outcome: "permission-denied",
          title: "Microphone permission is off",
          detail: "Android did not grant this app access to the microphone.",
          nextAction:
            permission === "blocked"
              ? "Allow microphone access for Demi in Android Settings, then run the test again."
              : "Allow microphone access when Android asks, then run the test again.",
        });
        return;
      }

      const readiness = await getVoiceReadiness();
      if (voiceSelfTestCancelRequestedRef.current || !voiceInputApproved()) return;
      if (!readiness.inputAvailable) {
        setVoiceSelfTestResult({
          kind: "recognition",
          outcome: "error",
          title: "Bundled recognition model is unavailable",
          detail: readiness.error ?? "The bundled English model is not ready.",
          nextAction: "Prepare the bundled voice models and run the test again.",
        });
        return;
      }

      if (voiceRecognitionActiveRef.current) {
        const activeSessionId = voiceRecognitionRunRef.current;
        cancelVoiceInput();
        await cancelLocalRecognition(activeSessionId).catch(() => undefined);
      }
      const sessionId = voiceRecognitionRunRef.current + 1;
      voiceRecognitionRunRef.current = sessionId;
      await new Promise<void>((resolve) => {
        let transcript = "";
        let settled = false;
        const subscriptions = [
          module.addListener(
            "recognitionResult",
            (event: RecognitionResultEvent) => {
              if (event.sessionId !== sessionId || !event.isFinal || !voiceInputApproved()) return;
              transcript = event.transcript.trim();
            },
          ),
          module.addListener(
            "recognitionStatus",
            (event: RecognitionStatusEvent) => {
              if (event.sessionId !== sessionId || !voiceInputApproved()) return;
              if (event.status === "listening") {
                setVoiceSelfTestResult({
                  kind: "recognition",
                  outcome: "running",
                  title: "Listening for a short phrase",
                  detail: "Your voice is transcribed on this device.",
                  nextAction: "Speak a short phrase, then stop the test.",
                });
                return;
              }
              if (event.status === "processing") {
                setVoiceSelfTestResult({
                  kind: "recognition",
                  outcome: "running",
                  title: "Transcribing locally",
                  detail: "The bundled model is processing the recording.",
                  nextAction: "Wait for the local transcription to finish.",
                });
                return;
              }
              if (event.status === "completed" && transcript) {
                finish({
                  outcome: "passed",
                  title: "Microphone recognition passed",
                  detail: `Demi recognized “${transcript}” with its bundled model. Audio was not sent to a speech service.`,
                  nextAction:
                    "You can use the microphone button for private voice input.",
                  transcript,
                });
              } else if (event.status === "completed") {
                finish({
                  outcome: "error",
                  title: "No speech was detected",
                  detail:
                    "The microphone opened, but the bundled model did not recognize a phrase.",
                  nextAction:
                    "Tap the test again and speak close to the device microphone.",
                });
              } else if (event.status === "cancelled") {
                finish({
                  outcome: "cancelled",
                  title: "Microphone test cancelled",
                  detail: "The local microphone check was cancelled.",
                  nextAction:
                    "Run the test again and speak a short phrase when prompted.",
                });
              } else if (event.status === "error") {
                finish(voiceSelfTestDiagnosis(event.message));
              }
            },
          ),
        ];

        function finish(diagnosis: Omit<VoiceSelfTestResult, "kind">) {
          if (settled) return;
          settled = true;
          subscriptions.forEach((subscription) => subscription.remove());
          voiceSelfTestStopRef.current = null;
          voiceSelfTestCancelRef.current = null;
          setVoiceSelfTestResult({ kind: "recognition", ...diagnosis });
          resolve();
        }

        voiceSelfTestCancelRef.current = () => {
          void cancelLocalRecognition(sessionId);
          finish({
            outcome: "cancelled",
            title: "Microphone test cancelled",
            detail: "The local microphone check was cancelled.",
            nextAction:
              "Run the test again and speak a short phrase when prompted.",
          });
        };
        voiceSelfTestStopRef.current = () => {
          void stopLocalRecognition(sessionId);
        };

        void startLocalRecognition(sessionId).catch((error) => {
          finish({
            outcome: "error",
            title: "Microphone test could not start",
            detail:
              error instanceof Error
                ? error.message
                : "The bundled recognizer could not start.",
            nextAction: "Close other recording apps and run the test again.",
          });
        });
      });
    } catch (error) {
      setVoiceSelfTestResult({
        kind: "recognition",
        outcome: "error",
        title: "Microphone test could not finish",
        detail:
          error instanceof Error
            ? error.message
            : "The bundled model could not verify local speech recognition.",
        nextAction: "Prepare the bundled voice models and run the test again.",
      });
    } finally {
      voiceSelfTestCancelRef.current = null;
      voiceSelfTestActiveRef.current = false;
      setVoiceSelfTestRunning(false);
    }
  }

  function cancelVoiceSelfTest() {
    voiceSelfTestCancelRequestedRef.current = true;
    voiceSelfTestCancelRef.current?.();
    if (!voiceSelfTestCancelRef.current) {
      setVoiceSelfTestResult({
        kind: "recognition",
        outcome: "cancelled",
        title: "Microphone test cancelled",
        detail:
          "The local microphone check was cancelled before listening started.",
        nextAction:
          "Run the test again and speak a short phrase when prompted.",
      });
    }
  }

  function stopVoiceSelfTest() {
    if (voiceSelfTestStopRef.current) {
      voiceSelfTestStopRef.current();
    } else {
      cancelVoiceSelfTest();
    }
  }

  async function playVoiceSelfTestSample() {
    if (!privacyReady || !isCapabilityActive(privacyState, "local.voice-output")) {
      setVoiceError(
        privacyState.globalPause
          ? "Privacy pause is active. Resume privileged actions in Settings before playing a voice sample."
          : "Offline spoken replies are paused or revoked in Settings.",
      );
      return;
    }
    if (voiceSelfTestSpeechStatus === "speaking") return;
    if (Platform.OS !== "android") {
      setVoiceSelfTestResult({
        kind: "tts",
        outcome: "recognizer-unavailable",
        title: "Voice self-test is unavailable here",
        detail: "The browser preview does not play local Android speech.",
        nextAction: "Run this test from the installed Android app.",
      });
      return;
    }

    const runId = voiceSelfTestSpeechRunRef.current + 1;
    voiceSelfTestSpeechRunRef.current = runId;
    setVoiceSelfTestSpeechStatus("speaking");
    setVoiceSelfTestResult({
      kind: "tts",
      outcome: "running",
      title: "Playing local speech sample",
      detail: "This short sample uses the bundled US English Piper voice.",
      nextAction: "Tap Stop sample if you want to end playback early.",
    });
    await stopLocalSpeech();
    const availableVoices = await getOfflineVoices();
    const languageVoiceAvailable = availableVoices.some((voice) =>
      voiceMatchesLanguage(voice.language, settingsRef.current.voiceLanguage),
    );
    if (runId !== voiceSelfTestSpeechRunRef.current || !isCapabilityActive(privacyStateRef.current, "local.voice-output") || !appActiveRef.current) return;
    if (!languageVoiceAvailable) {
      setVoiceSelfTestSpeechStatus("idle");
      setVoiceSelfTestResult({
        kind: "tts",
        outcome: "error",
        title: "Bundled offline voice is unavailable",
        detail: `The packaged English voice is not ready for ${settingsRef.current.voiceLanguage}.`,
        nextAction: "Prepare the bundled voice models, then try again.",
      });
      return;
    }
    await speakLocally("This is a private local voice test.", {
      language: settingsRef.current.voiceLanguage,
      rate: settingsRef.current.speechRate,
      preferredVoiceId: settingsRef.current.preferredVoiceId,
      onStart: () => {
        if (runId === voiceSelfTestSpeechRunRef.current) {
          setVoiceSelfTestSpeechStatus("speaking");
        }
      },
      onDone: () => {
        if (runId !== voiceSelfTestSpeechRunRef.current) return;
        setVoiceSelfTestSpeechStatus("idle");
        setVoiceSelfTestResult({
          kind: "tts",
          outcome: "passed",
          title: "Local speech playback passed",
          detail:
            "The bundled Piper voice played locally on this device.",
          nextAction: "You can use spoken replies without a network voice.",
        });
      },
      onStopped: () => {
        if (runId !== voiceSelfTestSpeechRunRef.current) return;
        setVoiceSelfTestSpeechStatus("idle");
        setVoiceSelfTestResult({
          kind: "tts",
          outcome: "cancelled",
          title: "Speech sample stopped",
          detail: "The local sample stopped before it finished.",
          nextAction: "Tap Play sample to run the voice test again.",
        });
      },
      onError: (message) => {
        if (runId !== voiceSelfTestSpeechRunRef.current) return;
        setVoiceSelfTestSpeechStatus("idle");
        setVoiceSelfTestResult({
          kind: "tts",
          outcome: "error",
          title: "Local speech playback failed",
          detail: message || "The verified offline voice could not start.",
          nextAction:
            "Prepare the bundled voice models and try the sample again.",
        });
      },
    });
  }

  async function stopVoiceSelfTestSample() {
    voiceSelfTestSpeechRunRef.current += 1;
    await stopLocalSpeech();
    setVoiceSelfTestSpeechStatus("idle");
    setVoiceSelfTestResult({
      kind: "tts",
      outcome: "cancelled",
      title: "Speech sample stopped",
      detail: "The local sample stopped before it finished.",
      nextAction: "Tap Play sample to run the voice test again.",
    });
  }

  async function prepareBundledVoiceModels() {
    if (voiceModelPreparationRef.current) return;
    const module = voiceModuleRef.current;
    if (!module || Platform.OS !== "android") {
      setVoiceError(
        "Bundled offline speech models are available in the installed Android build.",
      );
      return;
    }

    voiceModelPreparationRef.current = true;
    setVoiceSetupInProgress(true);
    setVoiceError(null);
    setVoiceSetupMessage("Preparing bundled offline speech models...");
    setVoiceInputStatus("checking");
    try {
      const readiness = await prepareVoiceModels();
      if (!readiness.ready) {
        throw new Error(
          readiness.error ?? "The bundled speech models are not ready.",
        );
      }
      await refreshOfflineVoices();
      setVoiceSetupMessage(
        "Bundled US English dictation and spoken replies are ready. No download or speech service is needed.",
      );
    } catch (error) {
      setVoiceInputAvailable(false);
      setVoiceOutputAvailable(false);
      setVoiceInputStatus("needs-model");
      setVoiceError(
        error instanceof Error
          ? error.message
          : "The bundled offline speech models could not be prepared.",
      );
    } finally {
      voiceModelPreparationRef.current = false;
      setVoiceSetupInProgress(false);
    }
  }

  async function speakText(text: string) {
    const trimmedText = text.trim();
    if (!trimmedText) return;
    if (!privacyReady || !isCapabilityActive(privacyState, "local.voice-output")) {
      setVoiceError(
        privacyState.globalPause
          ? "Privacy pause is active. Resume privileged actions in Settings before speaking a reply."
          : "Offline spoken replies are paused or revoked in Settings.",
      );
      return;
    }
    void recordPrivacyAction({
      capabilityId: "local.voice-output",
      action: "offline-voice-output",
      status: "allowed",
      summary: "Offline speech started; reply content omitted.",
    }).catch(() => undefined);
    setVoiceError(null);
    const run = ++speechRunRef.current;
    await stopLocalSpeech();

    const availableVoices = await getOfflineVoices();
    if (run !== speechRunRef.current || !isCapabilityActive(privacyStateRef.current, "local.voice-output") || !appActiveRef.current) return;
    setOfflineVoices(availableVoices);
    const languageVoiceAvailable = availableVoices.some((voice) =>
      voiceMatchesLanguage(voice.language, settings.voiceLanguage),
    );
    setVoiceOutputAvailable(languageVoiceAvailable);
    if (!languageVoiceAvailable) {
      setVoiceError(
        `The bundled offline voice does not support ${settings.voiceLanguage}. Choose English (US) in Settings.`,
      );
      return;
    }

    await speakLocally(trimmedText, {
      language: settings.voiceLanguage,
      rate: settings.speechRate,
      preferredVoiceId: settings.preferredVoiceId,
      onStart: () => { if (run === speechRunRef.current) setIsSpeaking(true); },
      onDone: () => { if (run === speechRunRef.current) setIsSpeaking(false); },
      onStopped: () => { if (run === speechRunRef.current) setIsSpeaking(false); },
      onError: (message) => {
        if (run !== speechRunRef.current) return;
        setIsSpeaking(false);
        setVoiceError(
          message || "The local voice could not speak this response.",
        );
      },
    });
  }

  async function stopSpeaking() {
    speechRunRef.current += 1;
    voiceSelfTestSpeechRunRef.current += 1;
    setVoiceSelfTestSpeechStatus("idle");
    await stopLocalSpeech();
    setIsSpeaking(false);
  }

  function dismissVoiceError() {
    setVoiceError(null);
    setVoiceSetupMessage(null);
    if (voiceInputStatus === "error") {
      setVoiceInputStatus(voiceInputAvailable ? "idle" : "unavailable");
    }
  }

  async function persistPrivacyState(nextState: PrivacyState) {
    const normalized = prunePrivacyState(nextState);
    try {
      await writeSecureRecord(SECURE_PRIVACY_STATE_KEY, JSON.stringify(normalized));
      // A write started before backgrounding cannot reactivate session grants.
      const effective = appActiveRef.current ? normalized : endPrivacySession(normalized);
      privacyStateRef.current = effective;
      setPrivacyState(effective);
      setStorageError(null);
    } catch {
      setStorageError(
        "Privacy controls could not be encrypted and saved. The previous privacy state is unchanged.",
      );
      throw new Error("Privacy controls could not be saved on this device.");
    }
  }

  function mutatePrivacyState(
    update: (current: PrivacyState) => PrivacyState,
  ) {
    const operation = privacyMutationQueueRef.current.then(() =>
      persistPrivacyState(update(privacyStateRef.current)),
    );
    privacyMutationQueueRef.current = operation.catch(() => undefined);
    return operation;
  }

  async function setCapabilityApproval(
    capabilityId: CapabilityId,
    approval: CapabilityApproval,
  ) {
    await mutatePrivacyState((current) => {
      const updated = updateCapabilityGrant(current, capabilityId, approval);
      return appendPrivacyAuditEvent(updated, {
        capabilityId,
        action: `capability-${approval}`,
        status: "completed",
        summary: `${capabilityId} was ${approval} by the user.`,
      });
    });
    if (capabilityId === "local.voice-input" && approval !== "approved") {
      cancelVoiceSelfTest();
      cancelVoiceInput();
    }
    if (capabilityId === "local.voice-output" && approval !== "approved") await stopSpeaking();
    if (
      (capabilityId === "device.screen-access" || capabilityId === "local.files" || capabilityId === "local.inference") &&
      approval !== "approved" &&
      (screenSessionRef.current.status === "active" ||
        screenSessionRef.current.status === "starting")
    ) {
      await stopScreenSession("capability-revoked");
    }
  }

  async function setGlobalPrivacyPause(paused: boolean) {
    await mutatePrivacyState((current) =>
      appendPrivacyAuditEvent(
        { ...current, globalPause: paused },
        {
          capabilityId: null,
          action: paused ? "global-pause" : "global-resume",
          status: "completed",
          summary: paused
            ? "All privileged actions were paused by the user."
            : "The global privacy pause was lifted by the user.",
        },
      ),
    );
    if (paused) {
      cancelVoiceSelfTest();
      cancelVoiceInput();
      await stopSpeaking();
    }
    if (
      paused &&
      (screenSessionRef.current.status === "active" ||
        screenSessionRef.current.status === "starting")
    ) {
      await stopScreenSession("global-privacy-pause");
    }
  }

  async function clearPrivacyState() {
    try {
      discardScreenContext();
      await privacyMutationQueueRef.current.catch(() => undefined);
      await stopNativeScreenSession("privacy-cleared");
      await removeSecureRecord(SECURE_PRIVACY_STATE_KEY);
      await removeSecureRecord("scheduled-jobs");
      const reset = createDefaultPrivacyState();
      privacyStateRef.current = reset;
      setPrivacyState(reset);
      setScreenSession((current) => ({
        ...current,
        status: "stopped",
        accessibilityText: false,
        screenshot: false,
        protectedContent: false,
        message: "Screen session stopped while privacy data was cleared.",
      }));
      setPrivacyResetVersion((value) => value + 1);
      setStorageError(null);
    } catch {
      setStorageError(
        "Privacy data could not be cleared. Nothing was removed from the previous state.",
      );
      throw new Error("Privacy data could not be cleared.");
    }
  }

  async function recordPrivacyAction(event: PrivacyActionInput) {
    await mutatePrivacyState((current) =>
      appendPrivacyAuditEvent(current, {
        ...event,
        summary: redactPrivacyText(event.summary),
      }),
    );
  }

  async function recordAgentTrace(
    trace: Omit<AgentTrace, "id" | "createdAt" | "retentionUntil">,
  ) {
    const now = Date.now();
    await mutatePrivacyState((current) =>
      prunePrivacyState(
        {
          ...current,
          traces: [
            ...current.traces,
            {
              ...trace,
              id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              summary: redactPrivacyText(trace.summary),
              createdAt: now,
              retentionUntil: now + 30 * 24 * 60 * 60 * 1000,
            },
          ],
        },
        now,
      ),
    );
  }

  async function runCloudFallback(
    task: CloudTask,
    reason: CloudFallbackReason,
    userInput: string,
    signal?: AbortSignal,
  ) {
    const permission = getCloudFallbackPermission(privacyState, privacyReady);
    if (!permission.allowed) {
      const message =
        permission.reason === "privacy-paused"
          ? "Privacy pause is active. Cloud fallback is blocked."
          : permission.reason === "local-inference-blocked"
            ? "Local inference is paused or revoked. Cloud fallback is blocked too."
            : "Cloud fallback is off or not ready. Enable it in Settings before sending data off device.";
      setCloudFallbackActivity({ task, status: "blocked", message });
      await recordPrivacyAction({
        capabilityId: "network.remote-inference",
        action: "cloud-fallback",
        status: "denied",
        summary: "Cloud fallback was blocked by privacy capabilities; input omitted.",
      }).catch(() => undefined);
      throw new CloudInferenceError(message, "blocked");
    }

    const updateActivity = (status: CloudProgress) => {
      const messages: Record<CloudProgress, string> = {
        "checking-provider": "Checking the configured cloud provider…",
        "provider-unavailable": "Cloud fallback is enabled, but its provider is unavailable.",
        "sending-minimized-request": "Sending only the bounded task input to the cloud provider…",
        "receiving-response": "Receiving the cloud response…",
        completed: "Cloud fallback completed. No local context was uploaded.",
        cancelled: "Cloud fallback was cancelled. The local path is still available.",
        "timed-out": "Cloud fallback timed out. The local path is still available.",
        quota: "Cloud provider quota is unavailable. The local path is still available.",
        failed: "Cloud fallback failed. The local path is still available.",
        blocked: "Cloud fallback is blocked by privacy controls.",
      };
      setCloudFallbackActivity({ task, status, message: messages[status] });
    };

    updateActivity("checking-provider");
    await recordPrivacyAction({
      capabilityId: "network.remote-inference",
      action: "cloud-fallback",
      status: "allowed",
      summary: `Cloud fallback started for ${task}; only bounded, redacted task input may leave the device.`,
    });
    try {
      const output = await requestCloudInference(
        {
          task,
          reason,
          input: userInput,
        },
        { signal, onProgress: updateActivity },
      );
      await recordPrivacyAction({
        capabilityId: "network.remote-inference",
        action: "cloud-fallback",
        status: "completed",
        summary: `Cloud fallback completed for ${task}; raw request and provider credentials were not stored.`,
      });
      await recordAgentTrace({
        capabilityId: "network.remote-inference",
        phase: "output",
        status: "completed",
        summary: `Cloud fallback completed for ${task}; response content omitted.`,
      }).catch(() => undefined);
      return output;
    } catch (error) {
      const cloudError =
        error instanceof CloudInferenceError
          ? error
          : new CloudInferenceError(
              "Cloud fallback failed. The local path is still available.",
              "failed",
            );
      updateActivity(cloudError.status);
      await recordPrivacyAction({
        capabilityId: "network.remote-inference",
        action: "cloud-fallback",
        status:
          cloudError.status === "cancelled"
            ? "cancelled"
            : cloudError.status === "timed-out"
              ? "interrupted"
              : "failed",
        summary: `Cloud fallback ${cloudError.status} for ${task}; request content omitted.`,
      }).catch(() => undefined);
      await recordAgentTrace({
        capabilityId: "network.remote-inference",
        phase: "output",
        status:
          cloudError.status === "cancelled" || cloudError.status === "timed-out"
            ? "interrupted"
            : "failed",
        summary: `Cloud fallback ${cloudError.status} for ${task}; response content omitted.`,
      }).catch(() => undefined);
      throw cloudError;
    }
  }

  async function updateSettings(patch: Partial<AppSettings>) {
    const finishMetric = startRuntimeMetric("settings.update");
    const nextSettings = { ...settings, ...patch };

    try {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
      setSettings(nextSettings);
      setStorageError(null);
      finishMetric({ changedKeys: Object.keys(patch).length });
    } catch {
      setStorageError("Settings could not be saved on this device.");
      finishMetric({ failed: true });
    }
  }

  async function persistProfile(nextProfile: PersonalProfile) {
    try {
      await writeSecureRecord(SECURE_PROFILE_KEY, JSON.stringify(nextProfile));
      setProfile(nextProfile);
      setStorageError(null);
    } catch {
      setStorageError("Your local profile could not be saved on this device.");
      throw new Error("Your local profile could not be saved on this device.");
    }
  }

  async function saveProfile(
    nextProfile: Pick<PersonalProfile, "displayName" | "context">,
  ) {
    await persistProfile({
      displayName: nextProfile.displayName.trim().slice(0, 80),
      context: nextProfile.context.trim().slice(0, 2000),
      onboardingCompleted: true,
    });
  }

  async function skipProfile() {
    await persistProfile({
      displayName: "",
      context: "",
      onboardingCompleted: true,
    });
  }

  async function clearProfile() {
    await persistProfile({
      displayName: "",
      context: "",
      onboardingCompleted: true,
    });
  }

  async function persistTurns(nextTurns: ConversationTurn[]) {
    if (!settings.saveConversations) return;
    const savableTurns = nextTurns.filter((turn) => !turn.privateContext);
    const finishMetric = startRuntimeMetric("conversation.persist", {
      turnCount: Math.min(nextTurns.length, MAX_CONVERSATION_TURNS),
    });

    try {
      await writeSecureRecord(
        SECURE_CONVERSATION_KEY,
        JSON.stringify(savableTurns.slice(-MAX_CONVERSATION_TURNS)),
      );
      setSavedTurnCount(Math.min(savableTurns.length, MAX_CONVERSATION_TURNS));
      setStorageError(null);
      finishMetric();
    } catch {
      setStorageError(
        "This message is visible now, but could not be saved locally.",
      );
      finishMetric({ failed: true });
    }
  }

  function commitTurns(nextTurns: ConversationTurn[]) {
    turnsRef.current = nextTurns;
    setTurns(nextTurns);
  }

  function cancelStreamUpdate() {
    if (streamUpdateRef.current.timer) {
      clearTimeout(streamUpdateRef.current.timer);
    }
    streamUpdateRef.current.timer = null;
    streamUpdateRef.current.turnId = null;
    streamUpdateRef.current.content = "";
  }

  function flushStreamUpdate() {
    const { turnId, content } = streamUpdateRef.current;
    if (!turnId) return;
    commitTurns(
      turnsRef.current.map((turn) =>
        turn.id === turnId ? { ...turn, content } : turn,
      ),
    );
    streamUpdateRef.current.timer = null;
    recordRuntimeEvent("conversation.stream-render", {
      contentLength: content.length,
    });
  }

  function scheduleStreamUpdate(turnId: string, content: string) {
    streamUpdateRef.current.turnId = turnId;
    streamUpdateRef.current.content = content;
    if (streamUpdateRef.current.timer) return;
    const run = streamUpdateRef.current.run;
    streamUpdateRef.current.timer = setTimeout(() => {
      if (run !== streamUpdateRef.current.run) return;
      flushStreamUpdate();
    }, STREAM_UI_UPDATE_INTERVAL_MS);
  }

  async function sendMessage(content: string) {
    const trimmedContent = content.trim();
    const sharedScreen = screenAttachmentRef.current;
    const sharedEpoch = screenEpochRef.current;
    const hasScreen = Boolean(sharedScreen);
    if (hasScreen && !screenContextValid(sharedScreen, sharedEpoch, screenAllowed())) {
      discardScreenContext();
      setStorageError("Shared text expired or approval ended. Capture and review it again.");
      return;
    }
    const localAvailable =
      privacyReady &&
      isCapabilityActive(privacyState, "local.inference") &&
      engineStatus === "ready" &&
      Boolean(llamaContextRef.current);
    const cloudAvailable =
      !hasScreen &&
      privacyReady &&
      isCapabilityActive(privacyState, "network.remote-inference");
    if (
      !trimmedContent ||
      chatInFlightRef.current ||
      !isConversationReady ||
      !privacyReady ||
      !isCapabilityActive(privacyState, "local.inference") ||
      (!localAvailable && !cloudAvailable)
    ) {
      if (
        trimmedContent &&
        privacyReady &&
        !isCapabilityActive(privacyState, "local.inference")
      ) {
        void recordPrivacyAction({
          capabilityId: "local.inference",
          action: "local-inference",
          status: "denied",
          summary: "A local reply was blocked by privacy controls; prompt omitted.",
        }).catch(() => undefined);
        setStorageError(
          privacyState.globalPause
            ? "Privacy pause is active. Resume privileged actions in Settings before generating a reply."
            : "Local model inference is paused or revoked in Settings.",
        );
      } else if (trimmedContent && !localAvailable && !cloudAvailable) {
        setStorageError(
          "Load the local model first, or enable Cloud fallback in Settings.",
        );
      }
      return;
    }

    if (localAvailable) {
      setCloudFallbackActivity(null);
      void recordPrivacyAction({
        capabilityId: "local.inference",
        action: "local-inference",
        status: "allowed",
        summary: "A local reply started; prompt content omitted.",
      }).catch(() => undefined);
      void recordAgentTrace({
        capabilityId: "local.inference",
        phase: "input",
        status: "started",
        summary: "Local model input accepted; prompt content omitted.",
      }).catch(() => undefined);
    }

    chatInFlightRef.current = true;
    if (settings.hapticsEnabled) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }

    const userTurn: ConversationTurn = {
      id: createId(),
      role: "user",
      content: trimmedContent,
      createdAt: Date.now(),
      privateContext: hasScreen,
    };
    const withUserTurn = [...turnsRef.current, userTurn];

    commitTurns(withUserTurn);
    setIsThinking(true);
    memorySuggestionRunRef.current += 1;
    if (memorySuggestionTimerRef.current) {
      clearTimeout(memorySuggestionTimerRef.current);
      memorySuggestionTimerRef.current = null;
    }

    const assistantTurn: ConversationTurn = {
      id: createId(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      privateContext: hasScreen,
    };
    const withAssistantTurn = [...withUserTurn, assistantTurn];
    commitTurns(withAssistantTurn);
    streamUpdateRef.current.run += 1;
    const streamRun = streamUpdateRef.current.run;
    const finishInferenceMetric = startRuntimeMetric("inference.reply", {
      promptLength: trimmedContent.length,
    });

    let streamedContent = "";
    const requestAllowed = () => isCapabilityActive(privacyStateRef.current, "local.inference") &&
      (!hasScreen || screenContextValid(sharedScreen, screenEpochRef.current, screenAllowed()));
    try {
      if (hasScreen && !localAvailable) throw new Error("Shared screen text requires a ready local model. Load it in Settings; cloud fallback is never used.");
      if (hasScreen && privacyStateRef.current.screenPolicy.retention === "discard-immediately") {
        screenAttachmentRef.current = null;
        setScreenAttachment(null);
      }
      let finalContent: string;
      if (localAvailable && llamaContextRef.current) {
        try {
          finalContent = await streamCompletion(
            llamaContextRef.current,
            withUserTurn.filter((turn) => !turn.privateContext || turn.id === userTurn.id).map((turn) => ({
              role: turn.role,
              content: turn.content,
            })),
            (token) => {
              streamedContent += token;
              if (streamRun === streamUpdateRef.current.run) {
                scheduleStreamUpdate(assistantTurn.id, streamedContent);
              }
            },
            {
              screenText: sharedScreen?.text,
              displayName: profile.displayName,
              context: profile.context,
              memories: selectRelevantMemories(
                memories,
                trimmedContent,
                  MAX_MEMORIES_IN_PROMPT,
                withUserTurn
                  .slice(-6)
                  .map((turn) => `${turn.role}: ${turn.content}`)
                  .join("\n"),
              ),
            },
            0,
            requestAllowed,
          );
        } catch (localError) {
          if (localError instanceof NativeInferenceError) {
            setEngineStatus("error");
            setEngineError(localError.message);
            await releaseModelContext();
          }
          if (!cloudAvailable || !isFallbackEligibleLocalFailure(localError)) {
            throw localError;
          }
          finalContent = await runCloudFallback(
            "chat",
            "local-runtime-failure",
            trimmedContent,
          );
        }
      } else {
        finalContent = await runCloudFallback(
          "chat",
          "local-engine-unavailable",
          trimmedContent,
        );
      }
      if (!requestAllowed()) throw new Error("Local inference was stopped by privacy controls.");
      const completedTurns = withAssistantTurn.map((turn) =>
        turn.id === assistantTurn.id
          ? {
              ...turn,
              content:
                finalContent ||
                streamedContent ||
                "The model finished without returning text. Try asking in a different way.",
            }
          : turn,
      );
      cancelStreamUpdate();
      commitTurns(completedTurns);
      await persistTurns(completedTurns);
      finishInferenceMetric({
        responseLength: completedTurns.at(-1)?.content.length ?? 0,
      });
      const completedResponse =
        completedTurns.find((turn) => turn.id === assistantTurn.id)?.content ??
        "";
      void recordAgentTrace({
        capabilityId: "local.inference",
        phase: "output",
        status: "completed",
        summary: "Local model output completed; response content omitted.",
      }).catch(() => undefined);
      const conversationalReminder =
        hasScreen ? null : parseConversationalReminder(trimmedContent);
      const hasReminderIntent = hasConversationalReminderIntent(trimmedContent);
      if (conversationalReminder) {
        setPendingMemoryCandidate(conversationalReminder);
      }
      if (!hasScreen && settings.spokenRepliesEnabled && completedResponse) {
        void speakText(completedResponse).catch(() => undefined);
      }
      if (
        !conversationalReminder &&
        !hasReminderIntent &&
        !hasScreen &&
        /\b(remember|save this|don['’]t forget|keep in mind)\b/i.test(trimmedContent) &&
        llamaContextRef.current &&
        memories.length < MAX_MEMORIES
      ) {
        const suggestionRun = memorySuggestionRunRef.current;
        memorySuggestionTimerRef.current = setTimeout(() => {
          memorySuggestionTimerRef.current = null;
          if (suggestionRun !== memorySuggestionRunRef.current) return;
          const finishMemoryMetric = startRuntimeMetric(
            "inference.memory-candidate",
            { promptLength: trimmedContent.length },
          );
          void (async () => {
            const extractionContext = llamaContextRef.current;
            if (!extractionContext) return;
            try {
              const rawCandidate = await proposeMemoryCandidate(
                extractionContext,
                trimmedContent,
                completedResponse,
                () => suggestionRun === memorySuggestionRunRef.current &&
                  llamaContextRef.current === extractionContext &&
                  isCapabilityActive(privacyStateRef.current, "local.inference"),
              );
              const candidate = parseMemoryCandidate(
                rawCandidate,
                memories,
                trimmedContent,
              );
              if (
                candidate &&
                suggestionRun === memorySuggestionRunRef.current
              ) {
                setPendingMemoryCandidate(candidate);
              }
              finishMemoryMetric({
                candidateFound: Boolean(candidate),
              });
            } catch (error) {
              finishMemoryMetric({ failed: true });
              if (error instanceof NativeInferenceError && llamaContextRef.current === extractionContext) {
                setEngineStatus("error");
                setEngineError(readableError(error));
                await releaseModelContext();
              }
            }
          })();
        }, 0);
      }
    } catch (error) {
      cancelStreamUpdate();
      const failedTurns = withAssistantTurn.map((turn) =>
        turn.id === assistantTurn.id
          ? {
              ...turn,
              content: `${streamedContent ? `${streamedContent}\n\n` : ""}I could not finish that response locally. ${readableError(error)}`,
            }
          : turn,
      );
      const visibleFailedTurns = hasScreen && !requestAllowed()
        ? failedTurns.filter((turn) => !turn.privateContext)
        : failedTurns;
      commitTurns(visibleFailedTurns);
      await persistTurns(visibleFailedTurns);
      finishInferenceMetric({ failed: true });
      void recordAgentTrace({
        capabilityId: "local.inference",
        phase: "output",
        status: "failed",
        summary: "Local model output failed; response content omitted.",
      }).catch(() => undefined);
    } finally {
      if (hasScreen) {
        screenAttachmentRef.current = null;
        setScreenAttachment(null);
        screenPreviewRef.current = null;
        setScreenPreview(null);
        screenEpochRef.current += 1;
      }
      chatInFlightRef.current = false;
      setIsThinking(false);
    }
  }

  async function runLocalInference(
    prompt: string,
    onToken?: (token: string) => void,
    priority = 1,
    guard: () => boolean = () => true,
  ) {
    const trimmedPrompt = prompt.trim();
    if (
      !trimmedPrompt ||
      !privacyReady ||
      !isCapabilityActive(privacyState, "local.inference") ||
      engineStatus !== "ready" ||
      !llamaContextRef.current
    ) {
      throw new Error("Load the local model and enable local inference first.");
    }
    try {
    return await streamCompletion(
      llamaContextRef.current,
      [{ role: "user", content: trimmedPrompt }],
      onToken ?? (() => undefined),
      {
        displayName: profile.displayName,
        context: profile.context,
        memories: selectRelevantMemories(memories, trimmedPrompt, 3),
      },
      priority,
      () => guard() && isCapabilityActive(privacyStateRef.current, "local.inference"),
    );
    } catch (error) {
      if (error instanceof NativeInferenceError) {
        setEngineStatus("error");
        setEngineError(error.message);
        await releaseModelContext();
      }
      throw error;
    }
  }

  async function clearConversation() {
    if (clearConversationInFlightRef.current) return;
    if (isThinking) {
      setStorageError(
        "Wait for the current response to finish before clearing history.",
      );
      throw new Error("A response is still being generated.");
    }
    clearConversationInFlightRef.current = true;
    try {
      await removeSecureRecord(SECURE_CONVERSATION_KEY);
      commitTurns([]);
      setSavedTurnCount(0);
      setStorageError(null);
    } catch {
      setStorageError("Conversation history could not be cleared.");
      throw new Error("Conversation history could not be cleared.");
    } finally {
      clearConversationInFlightRef.current = false;
    }
  }

  async function persistMemories(next: ApprovedMemory[]) {
    try {
      const seen = new Set<string>();
      const bounded = next
        .filter((memory) => {
          const fingerprint = memoryFingerprint(memory.content);
          if (!fingerprint || seen.has(fingerprint)) return false;
          seen.add(fingerprint);
          return true;
        })
        .map((memory) => ({
          ...memory,
          aliases: normalizeMemoryAliases(memory.aliases),
        }))
        .slice(0, MAX_MEMORIES);
      await writeSecureRecord(SECURE_MEMORIES_KEY, JSON.stringify(bounded));
      memoriesRef.current = bounded;
      setMemories(bounded);
      setStorageError(null);
    } catch {
      setStorageError(
        "Memory changes could not be encrypted and saved. Your previous memories are unchanged.",
      );
      throw new Error("The memory could not be saved securely.");
    }
  }

  function mutateMemories(
    update: (current: ApprovedMemory[]) => ApprovedMemory[],
  ) {
    const operation = memoryMutationQueueRef.current.then(() =>
      persistMemories(update(memoriesRef.current)),
    );
    memoryMutationQueueRef.current = operation.catch(() => undefined);
    return operation;
  }

  async function saveMemoryCandidate(editedContent?: string) {
    const candidate = pendingMemoryCandidate;
    if (!candidate || candidate.kind !== "memory") return;
    const content = (editedContent ?? candidate.content).trim().slice(0, 240);
    if (!content) {
      setPendingMemoryCandidate(null);
      return;
    }
    const now = Date.now();
    await mutateMemories((current) => {
      if (
        current.some(
          (memory) =>
            memoryFingerprint(memory.content) === memoryFingerprint(content),
        )
      ) {
        return current;
      }
      return [
        {
          id: createId(),
          category: candidate.category,
          content,
          source: {
            turnId:
              turns.filter((turn) => turn.role === "user").at(-1)?.id ?? "",
            excerpt: candidate.sourceExcerpt,
            createdAt: now,
          },
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        },
        ...current,
      ];
    });
    setPendingMemoryCandidate(null);
  }

  async function updateMemory(id: string, content: string) {
    const normalized = content.trim().slice(0, 240);
    if (
      !normalized ||
      memories.some(
        (memory) =>
          memory.id !== id &&
          memoryFingerprint(memory.content) === memoryFingerprint(normalized),
      )
    ) {
      return;
    }
    await mutateMemories((current) =>
      current.map((memory) =>
        memory.id === id
          ? { ...memory, content: normalized, updatedAt: Date.now() }
          : memory,
      ),
    );
  }

  async function updateMemoryAliases(id: string, aliases: string[]) {
    const normalizedAliases = normalizeMemoryAliases(aliases);
    await mutateMemories((current) =>
      current.map((memory) =>
        memory.id === id
          ? { ...memory, aliases: normalizedAliases, updatedAt: Date.now() }
          : memory,
      ),
    );
  }

  async function archiveMemory(id: string, archived: boolean) {
    await mutateMemories((current) =>
      current.map((memory) =>
        memory.id === id
          ? {
              ...memory,
              archivedAt: archived ? Date.now() : null,
              updatedAt: Date.now(),
            }
          : memory,
      ),
    );
  }

  async function deleteMemory(id: string) {
    await mutateMemories((current) =>
      current.filter((memory) => memory.id !== id),
    );
  }

  async function reloadRecoverableData() {
    const [conversationValue, profileValue, memoriesValue] = await Promise.all([
      readSecureRecord(SECURE_CONVERSATION_KEY),
      readSecureRecord(SECURE_PROFILE_KEY),
      readSecureRecord(SECURE_MEMORIES_KEY),
    ]);
    const nextTurns = parseTurns(conversationValue).slice(-MAX_CONVERSATION_TURNS);
    const nextProfile = parseProfile(profileValue);
    const nextMemories = parseApprovedMemories(memoriesValue);
    turnsRef.current = nextTurns;
    memoriesRef.current = nextMemories;
    setTurns(nextTurns);
    setSavedTurnCount(nextTurns.length);
    setProfile(nextProfile);
    setMemories(nextMemories);
    setStorageError(null);
  }

  const value = useMemo(
    () => ({
      settings,
      settingsReady,
      updateSettings,
      profile,
      saveProfile,
      skipProfile,
      clearProfile,
      storageError,
      storageProtection,
      privacyReady,
      privacyState,
      privacyResetVersion,
      setCapabilityApproval,
      setGlobalPrivacyPause,
      clearPrivacyState,
      recordPrivacyAction,
      recordAgentTrace,
      screenAccessStatus,
      screenSession,
      screenPreview,
      screenAttachment,
      attachScreenContext,
      discardScreenContext,
      refreshScreenAccessStatus,
      startScreenSession,
      stopScreenSession,
      openAccessibilitySettings,
      updateScreenPolicy,
      memories,
      updateMemory,
      updateMemoryAliases,
      archiveMemory,
      deleteMemory,
      savedTurnCount,
      reloadRecoverableData,
      localModel,
      deviceCompatibility,
      engineStatus,
      engineProgress,
      engineError,
      modelSetupStatus,
      runtimeDetails,
      voiceInputStatus,
      voiceInputAvailable,
      voiceOutputAvailable,
      offlineVoices,
      offlineVoicesLoading,
      refreshOfflineVoices,
      voiceTranscript,
      voiceError,
      voiceSetupMessage,
      voiceSetupInProgress,
      isSpeaking,
      voiceSelfTestResult,
      voiceSelfTestRunning,
      voiceSelfTestSpeechStatus,
      runVoiceSelfTest,
      stopVoiceSelfTest,
      cancelVoiceSelfTest,
      playVoiceSelfTestSample,
      stopVoiceSelfTestSample,
      importModel,
      downloadRecommendedModel,
      cancelDownload,
      downloadStatus,
      downloadProgress,
      downloadError,
      loadModel,
      removeModel,
      startVoiceInput,
      stopVoiceInput,
      cancelVoiceInput,
      clearVoiceTranscript,
      prepareBundledVoiceModels,
      speakText,
      stopSpeaking,
      dismissVoiceError,
      cloudFallbackActivity,
      runCloudFallback,
      storageUsage,
      storageUsageRefreshing,
      refreshStorageUsage,
      reclaimUnusedModelFiles,
    }),
    [
      settings,
      settingsReady,
      profile,
      storageError,
      storageProtection,
      privacyReady,
      privacyState,
      privacyResetVersion,
      screenAccessStatus,
      screenSession,
      screenPreview,
      screenAttachment,
      cloudFallbackActivity,
      memories,
      savedTurnCount,
      localModel,
      deviceCompatibility,
      engineStatus,
      engineProgress,
      engineError,
      modelSetupStatus,
      runtimeDetails,
      voiceInputStatus,
      voiceInputAvailable,
      voiceOutputAvailable,
      offlineVoices,
      offlineVoicesLoading,
      voiceTranscript,
      voiceError,
      voiceSetupMessage,
      voiceSetupInProgress,
      isSpeaking,
      voiceSelfTestResult,
      voiceSelfTestRunning,
      voiceSelfTestSpeechStatus,
      storageUsage,
      storageUsageRefreshing,
    ],
  );

  const chatValue = useMemo<ChatContextValue>(
    () => ({
      turns,
      isConversationReady,
      isThinking,
      pendingMemoryCandidate,
      saveMemoryCandidate,
      rejectMemoryCandidate: () => setPendingMemoryCandidate(null),
      sendMessage,
      runLocalInference,
      clearConversation,
    }),
    [
      turns,
      isConversationReady,
      isThinking,
      pendingMemoryCandidate,
      settings,
      privacyReady,
      privacyState,
      engineStatus,
      profile,
      memories,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      <ChatContext.Provider value={chatValue}>{children}</ChatContext.Provider>
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used inside AppProvider");
  }
  return context;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used inside AppProvider");
  }
  return context;
}
