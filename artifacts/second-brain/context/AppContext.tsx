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
import { AppState, Platform } from "react-native";
import type { LlamaContext } from "llama.rn";
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
  getOfflineVoices,
  getRecognitionModule,
  speakLocally,
  stopLocalSpeech,
  openLocalVoiceSettings,
  voiceErrorMessage,
  voiceMatchesLanguage,
  type ExpoSpeechRecognitionResultEvent,
  type OfflineVoice,
  type RecognitionModule,
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
  MODEL_STORAGE_SAFETY_MARGIN_BYTES,
} from "@/lib/localLimits";
import {
  createUnavailableLocalStorageUsage,
  measureLocalStorageUsage,
  type LocalStorageUsage,
} from "@/lib/localStorageUsage";

export type Appearance = "system" | "light" | "dark";

export type ConversationTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
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
  turns: ConversationTurn[];
  isConversationReady: boolean;
  isThinking: boolean;
  storageError: string | null;
  storageProtection: SecureStorageProtection;
  memories: ApprovedMemory[];
  pendingMemoryCandidate: MemoryCandidate | null;
  saveMemoryCandidate: (content?: string) => Promise<void>;
  rejectMemoryCandidate: () => void;
  updateMemory: (id: string, content: string) => Promise<void>;
  updateMemoryAliases: (id: string, aliases: string[]) => Promise<void>;
  archiveMemory: (id: string, archived: boolean) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  savedTurnCount: number;
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
  installOfflineVoiceModel: () => Promise<void>;
  speakText: (text: string) => Promise<void>;
  stopSpeaking: () => Promise<void>;
  openVoiceSettings: () => Promise<void>;
  dismissVoiceError: () => void;
  sendMessage: (content: string) => Promise<void>;
  clearConversation: () => Promise<void>;
  storageUsage: LocalStorageUsage | null;
  refreshStorageUsage: () => void;
  reclaimUnusedModelFiles: () => Promise<ModelCleanupResult>;
  storageDetailsExpanded: boolean;
  setStorageDetailsExpanded: (expanded: boolean) => void;
};

const SETTINGS_KEY = "@second-brain/settings-v1";
const CONVERSATION_KEY = "@second-brain/conversation-v1";
const MODEL_KEY = "@second-brain/local-model-v1";
const PROFILE_KEY = "@second-brain/personal-profile-v1";
const SECURE_PROFILE_KEY = "profile";
const SECURE_CONVERSATION_KEY = "conversation";
const SECURE_MEMORIES_KEY = "approved-memories";

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

const AppContext = createContext<AppContextValue | null>(null);

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
      voiceLanguage:
        typeof parsed.voiceLanguage === "string"
          ? parsed.voiceLanguage
          : "en-US",
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
  if (message) return message;
  return "The model could not be loaded. Choose a smaller compatible GGUF file and try again.";
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
  const [storageDetailsExpanded, setStorageDetailsExpanded] = useState(false);
  const [storageUsageRefreshToken, setStorageUsageRefreshToken] = useState(0);
  const [memories, setMemories] = useState<ApprovedMemory[]>([]);
  const [pendingMemoryCandidate, setPendingMemoryCandidate] =
    useState<MemoryCandidate | null>(null);
  const memoriesRef = useRef<ApprovedMemory[]>([]);
  const memoryMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const storageProtection = getSecureStorageProtection();
  const [localModel, setLocalModel] = useState<LocalModel | null>(null);
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
  const recognitionModuleRef = useRef<RecognitionModule | null>(null);
  const recognitionServicePackageRef = useRef<string | undefined>(undefined);
  const voiceSelfTestActiveRef = useRef(false);
  const voiceSelfTestCancelRef = useRef<(() => void) | null>(null);
  const voiceSelfTestCancelRequestedRef = useRef(false);
  const voiceSelfTestSpeechRunRef = useRef(0);
  const didRestoreModelRef = useRef(false);
  const modelImportInFlightRef = useRef(false);
  const modelLoadInFlightRef = useRef(false);
  const offlineVoiceSetupInFlightRef = useRef(false);
  const downloadRunRef = useRef(0);
  const clearConversationInFlightRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  function refreshStorageUsage() {
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

    void (async () => {
      const [
        settingsResult,
        modelResult,
        conversationResult,
        profileResult,
        memoriesResult,
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
      ]);

      if (!isMounted) return;

      let nextSettings = DEFAULT_SETTINGS;
      let savedTurns: ConversationTurn[] = [];
      let savedModel: LocalModel | null = null;
      let savedProfile = DEFAULT_PROFILE;
      let savedMemories: ReturnType<typeof parseApprovedMemories> = [];
      try {
        nextSettings = parseSettings(settingsResult.value);
        savedTurns = parseTurns(conversationResult.value);
        savedModel = parseModel(modelResult.value);
        savedProfile = parseProfile(profileResult.value);
        savedMemories = parseApprovedMemories(memoriesResult.value);
      } catch {
        setStorageError(
          "Some saved local data could not be read. Chat, memory, and voice controls remain available with safe defaults.",
        );
      }

      setSettings(nextSettings);
      setProfile(savedProfile);
      setMemories(savedMemories);
      memoriesRef.current = savedMemories;
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
      ) {
        setStorageError(
          "Some local data could not be opened. Chat, memory, and voice controls remain available; affected values are unavailable.",
        );
      }
      setSettingsReady(true);
      setIsConversationReady(true);
    })();

    return () => {
      isMounted = false;
      void llamaContextRef.current?.release();
      llamaContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    let isMounted = true;
    void measureLocalStorageUsage(localModel?.uri ?? null, {
      settings: SETTINGS_KEY,
      model: MODEL_KEY,
      conversation: SECURE_CONVERSATION_KEY,
      profile: SECURE_PROFILE_KEY,
      memories: SECURE_MEMORIES_KEY,
    })
      .then((usage) => {
        if (isMounted) setStorageUsage(usage);
      })
      .catch(() => {
        if (!isMounted) return;
        setStorageUsage((previous) => previous ?? createUnavailableLocalStorageUsage());
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
    let isMounted = true;
    void refreshOfflineVoices();

    const module = getRecognitionModule();
    recognitionModuleRef.current = module;
    if (!module) {
      setVoiceInputStatus("unavailable");
      return () => {
        isMounted = false;
        void stopLocalSpeech();
      };
    }

    void refreshVoiceAvailability(module);
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          void refreshVoiceAvailability(module);
          void refreshOfflineVoices();
          if (offlineVoiceSetupInFlightRef.current) {
            offlineVoiceSetupInFlightRef.current = false;
            setVoiceSetupInProgress(false);
          }
        }
      },
    );

    const subscriptions = [
      module.addListener("start", () => {
        if (voiceSelfTestActiveRef.current) return;
        setVoiceInputStatus("listening");
        setVoiceError(null);
      }),
      module.addListener(
        "result",
        (event: ExpoSpeechRecognitionResultEvent) => {
          if (voiceSelfTestActiveRef.current) return;
          const transcript = event.results[0]?.transcript?.trim();
          if (transcript) setVoiceTranscript(transcript);
          if (event.isFinal) setVoiceInputStatus("processing");
        },
      ),
      module.addListener("end", () => {
        if (voiceSelfTestActiveRef.current) return;
        setVoiceInputStatus((current) =>
          current === "unavailable" || current === "needs-model"
            ? current
            : "idle",
        );
      }),
      module.addListener("error", (event) => {
        if (voiceSelfTestActiveRef.current) return;
        if (event.error === "aborted") {
          setVoiceInputStatus("idle");
          return;
        }
        const needsModel =
          event.error === "language-not-supported" ||
          event.error === "service-not-allowed" ||
          event.error === "network";
        setVoiceInputStatus(needsModel ? "needs-model" : "error");
        setVoiceError(voiceErrorMessage(event));
      }),
    ];

    return () => {
      isMounted = false;
      voiceSelfTestCancelRef.current?.();
      appStateSubscription.remove();
      subscriptions.forEach((subscription) => subscription.remove());
      try {
        module.abort();
      } catch {
        // The recognizer may already be inactive.
      }
      void stopLocalSpeech();
      offlineVoiceSetupInFlightRef.current = false;
    };
  }, []);

  async function refreshOfflineVoices() {
    setOfflineVoicesLoading(true);
    try {
      const voices = await getOfflineVoices();
      setOfflineVoices(voices);
      setVoiceOutputAvailable(
        voices.some((voice) =>
          voiceMatchesLanguage(
            voice.language,
            settingsRef.current.voiceLanguage,
          ),
        ),
      );
    } catch {
      setOfflineVoices([]);
      setVoiceOutputAvailable(false);
    } finally {
      setOfflineVoicesLoading(false);
    }
  }

  async function refreshVoiceAvailability(moduleOverride?: RecognitionModule) {
    const module = moduleOverride ?? recognitionModuleRef.current;
    if (!module || Platform.OS !== "android") {
      setVoiceInputAvailable(false);
      setVoiceInputStatus("unavailable");
      return false;
    }

    const androidApiLevel =
      typeof Platform.Version === "number" ? Platform.Version : 0;
    if (androidApiLevel < 33) {
      setVoiceInputAvailable(false);
      setVoiceInputStatus("unavailable");
      setVoiceSetupMessage(
        "Private offline dictation requires Android 13 or newer. Voice input is disabled on this device so audio cannot fall back to a network recognizer.",
      );
      return false;
    }

    try {
      if (
        !module.isRecognitionAvailable() ||
        !module.supportsOnDeviceRecognition()
      ) {
        setVoiceInputAvailable(false);
        setVoiceInputStatus("unavailable");
        setVoiceSetupMessage(
          "This device does not provide private on-device speech recognition.",
        );
        return false;
      }

      const services = module.getSpeechRecognitionServices();
      const onDevicePackage = services.includes("com.google.android.as")
        ? "com.google.android.as"
        : undefined;
      recognitionServicePackageRef.current = onDevicePackage;
      const { installedLocales } = await module.getSupportedLocales({
        androidRecognitionServicePackage: onDevicePackage,
      });
      const expectedLocale = settingsRef.current.voiceLanguage.toLowerCase();
      const expectedLanguage = expectedLocale.split("-")[0];
      const localeInstalled = installedLocales.some((locale) => {
        const normalized = locale.toLowerCase();
        return (
          normalized === expectedLocale ||
          normalized.split("-")[0] === expectedLanguage
        );
      });

      setVoiceInputAvailable(localeInstalled);
      setVoiceInputStatus(localeInstalled ? "idle" : "needs-model");
      setVoiceSetupMessage(
        localeInstalled
          ? null
          : `Install the ${settingsRef.current.voiceLanguage} offline language pack before using private voice input.`,
      );
      return localeInstalled;
    } catch {
      setVoiceInputAvailable(false);
      setVoiceInputStatus("needs-model");
      setVoiceSetupMessage(
        `Demi could not verify an installed ${settingsRef.current.voiceLanguage} offline language pack.`,
      );
      return false;
    }
  }

  async function releaseModelContext(clearDetails = false) {
    const context = llamaContextRef.current;
    llamaContextRef.current = null;
    if (context) await context.release();
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
    if (!settings.voiceInputEnabled) {
      setVoiceError("Voice input is turned off in Settings.");
      return;
    }

    const module = recognitionModuleRef.current;
    if (!module) {
      setVoiceInputStatus("unavailable");
      setVoiceError(
        "Offline listening needs the installed Android build. It is not included in Expo Go or the browser preview.",
      );
      return;
    }

    const androidApiLevel =
      Platform.OS === "android" && typeof Platform.Version === "number"
        ? Platform.Version
        : 0;
    if (Platform.OS !== "android" || androidApiLevel < 33) {
      setVoiceInputStatus("unavailable");
      setVoiceError(
        "Private offline voice input requires an installed Android 13 or newer build.",
      );
      return;
    }

    setVoiceError(null);
    setVoiceSetupMessage(null);
    await stopSpeaking();

    try {
      const permission = await module.requestPermissionsAsync();
      if (!permission.granted) {
        setVoiceInputStatus("error");
        setVoiceError(
          permission.canAskAgain === false
            ? "Microphone access is blocked. Open Android Settings to enable it."
            : "Microphone access is required for local voice input.",
        );
        return;
      }

      const offlineLocaleInstalled = await refreshVoiceAvailability(module);
      if (!offlineLocaleInstalled) {
        setVoiceInputStatus("needs-model");
        setVoiceError(
          `Install the ${settings.voiceLanguage} offline language pack before using private voice input.`,
        );
        return;
      }

      setVoiceInputAvailable(true);
      setVoiceTranscript("");
      setVoiceInputStatus("checking");
      module.start({
        lang: settings.voiceLanguage,
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
        androidRecognitionServicePackage: recognitionServicePackageRef.current,
      });
    } catch (error) {
      setVoiceInputStatus("error");
      setVoiceError(
        error instanceof Error
          ? error.message
          : "Offline voice input could not start.",
      );
    }
  }

  function stopVoiceInput() {
    const module = recognitionModuleRef.current;
    if (!module) return;
    setVoiceInputStatus("processing");
    module.stop();
  }

  function cancelVoiceInput() {
    const module = recognitionModuleRef.current;
    if (!module) return;
    module.abort();
    setVoiceTranscript("");
    setVoiceInputStatus("idle");
    setVoiceError(null);
  }

  function clearVoiceTranscript() {
    setVoiceTranscript("");
  }

  async function runVoiceSelfTest() {
    if (voiceSelfTestRunning) return;

    const module = recognitionModuleRef.current;
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

    const androidApiLevel =
      typeof Platform.Version === "number" ? Platform.Version : 0;
    if (androidApiLevel < 33) {
      setVoiceSelfTestResult({
        kind: "recognition",
        outcome: "recognizer-unavailable",
        title: "Android 13 or newer is required",
        detail:
          "This app only uses the Android on-device recognizer when it can guarantee private recognition.",
        nextAction: "Use an Android 13+ device for the voice self-test.",
      });
      return;
    }

    setVoiceSelfTestRunning(true);
    voiceSelfTestCancelRequestedRef.current = false;
    setVoiceSelfTestResult({
      kind: "recognition",
      outcome: "running",
      title: "Checking local microphone access",
      detail:
        "Android will ask for microphone access if it has not been granted.",
      nextAction: "When listening starts, speak a short phrase.",
    });
    voiceSelfTestActiveRef.current = true;

    try {
      const permission = await module.requestPermissionsAsync();
      if (voiceSelfTestCancelRequestedRef.current) return;
      if (!permission.granted) {
        setVoiceSelfTestResult({
          kind: "recognition",
          outcome: "permission-denied",
          title: "Microphone permission is off",
          detail: "Android did not grant this app access to the microphone.",
          nextAction:
            permission.canAskAgain === false
              ? "Allow microphone access for Demi in Android Settings, then run the test again."
              : "Allow microphone access when Android asks, then run the test again.",
        });
        return;
      }

      if (
        !module.isRecognitionAvailable() ||
        !module.supportsOnDeviceRecognition()
      ) {
        setVoiceSelfTestResult({
          kind: "recognition",
          outcome: "recognizer-unavailable",
          title: "On-device recognizer is unavailable",
          detail:
            "Android does not have a recognizer that can run this test locally.",
          nextAction:
            "Install or enable an on-device speech recognition service, then run the test again.",
        });
        return;
      }

      const services = module.getSpeechRecognitionServices();
      const onDevicePackage = services.includes("com.google.android.as")
        ? "com.google.android.as"
        : undefined;
      const { installedLocales } = await module.getSupportedLocales({
        androidRecognitionServicePackage: onDevicePackage,
      });
      if (voiceSelfTestCancelRequestedRef.current) return;
      const expectedLocale = settingsRef.current.voiceLanguage.toLowerCase();
      const expectedLanguage = expectedLocale.split("-")[0];
      const localeInstalled = installedLocales.some((locale) => {
        const normalized = locale.toLowerCase();
        return (
          normalized === expectedLocale ||
          normalized.split("-")[0] === expectedLanguage
        );
      });
      if (!localeInstalled) {
        setVoiceSelfTestResult({
          kind: "recognition",
          outcome: "offline-language-missing",
          title: "Offline language data is missing",
          detail: `Android does not have the ${settingsRef.current.voiceLanguage} recognition pack installed.`,
          nextAction:
            "Tap Install offline language pack above, wait for Android to finish, then run the test again.",
        });
        return;
      }

      await new Promise<void>((resolve) => {
        let transcript = "";
        let settled = false;
        const subscriptions = [
          module.addListener(
            "result",
            (event: ExpoSpeechRecognitionResultEvent) => {
              transcript = event.results[0]?.transcript?.trim() ?? transcript;
            },
          ),
          module.addListener("error", (event) => {
            finish(voiceSelfTestDiagnosis(event));
          }),
          module.addListener("end", () => {
            if (transcript) {
              finish({
                outcome: "passed",
                title: "Microphone recognition passed",
                detail: `Android recognized “${transcript}” on this device without sending it to a network service.`,
                nextAction:
                  "You can use the microphone button for private voice input.",
                transcript,
              });
            } else {
              finish({
                outcome: "error",
                title: "No speech was detected",
                detail:
                  "The microphone opened, but the recognizer did not hear a phrase.",
                nextAction:
                  "Tap the test again and speak close to the device microphone.",
              });
            }
          }),
        ];

        function finish(diagnosis: Omit<VoiceSelfTestResult, "kind">) {
          if (settled) return;
          settled = true;
          subscriptions.forEach((subscription) => subscription.remove());
          voiceSelfTestCancelRef.current = null;
          setVoiceSelfTestResult({ kind: "recognition", ...diagnosis });
          resolve();
        }

        voiceSelfTestCancelRef.current = () => {
          try {
            module.abort();
          } catch {
            // The recognizer may already have stopped.
          }
          finish({
            outcome: "cancelled",
            title: "Microphone test cancelled",
            detail:
              "The on-device recognizer stopped before it returned a result.",
            nextAction:
              "Run the test again and speak a short phrase when prompted.",
          });
        };

        try {
          module.start({
            lang: settingsRef.current.voiceLanguage,
            interimResults: true,
            maxAlternatives: 1,
            continuous: false,
            requiresOnDeviceRecognition: true,
            addsPunctuation: true,
            androidRecognitionServicePackage: onDevicePackage,
          });
        } catch (error) {
          finish({
            outcome: "error",
            title: "Microphone test could not start",
            detail:
              error instanceof Error
                ? error.message
                : "Android rejected the local recognition request.",
            nextAction: "Close other recording apps and run the test again.",
          });
        }
      });
    } catch (error) {
      setVoiceSelfTestResult({
        kind: "recognition",
        outcome: "error",
        title: "Microphone test could not finish",
        detail:
          error instanceof Error
            ? error.message
            : "Android could not verify local speech recognition.",
        nextAction: "Check Android voice settings and run the test again.",
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

  async function playVoiceSelfTestSample() {
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
      detail:
        "This short sample uses the selected language and the verified offline voice fallback.",
      nextAction: "Tap Stop sample if you want to end playback early.",
    });
    await stopLocalSpeech();
    const availableVoices = await getOfflineVoices();
    const languageVoiceAvailable = availableVoices.some((voice) =>
      voiceMatchesLanguage(voice.language, settingsRef.current.voiceLanguage),
    );
    if (runId !== voiceSelfTestSpeechRunRef.current) return;
    if (!languageVoiceAvailable) {
      setVoiceSelfTestSpeechStatus("idle");
      setVoiceSelfTestResult({
        kind: "tts",
        outcome: "error",
        title: "No verified offline voice is installed",
        detail: `Android does not have a verified offline voice for ${settingsRef.current.voiceLanguage}.`,
        nextAction:
          "Open Android text-to-speech settings, install an offline voice, then try the sample again.",
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
            "The selected language and a verified offline voice played on this device.",
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
            "Install or enable an offline voice for the selected language in Android Settings, then try again.",
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

  async function installOfflineVoiceModel() {
    if (offlineVoiceSetupInFlightRef.current) return;
    const module = recognitionModuleRef.current;
    if (!module || Platform.OS !== "android") {
      setVoiceError(
        "Offline language installation is available in the installed Android build.",
      );
      return;
    }

    const androidApiLevel =
      typeof Platform.Version === "number" ? Platform.Version : 0;
    if (androidApiLevel < 33) {
      setVoiceInputStatus("unavailable");
      setVoiceError(
        "Private offline dictation requires Android 13 or newer and is disabled on this device.",
      );
      return;
    }

    offlineVoiceSetupInFlightRef.current = true;
    setVoiceSetupInProgress(true);
    setVoiceError(null);
    setVoiceSetupMessage(null);
    setVoiceInputStatus("checking");
    try {
      const result = await module.androidTriggerOfflineModelDownload({
        locale: settings.voiceLanguage,
      });
      setVoiceSetupMessage(
        result.status === "download_success"
          ? `${settings.voiceLanguage} offline recognition is installed.`
          : result.status === "download_scheduled"
            ? "The offline language download is scheduled. Android may wait for Wi-Fi."
            : "Android opened the offline language download. Return here when it finishes.",
      );
      await refreshVoiceAvailability(module);
      if (result.status !== "opened_dialog") {
        offlineVoiceSetupInFlightRef.current = false;
        setVoiceSetupInProgress(false);
      }
    } catch (error) {
      offlineVoiceSetupInFlightRef.current = false;
      setVoiceSetupInProgress(false);
      setVoiceInputStatus("needs-model");
      setVoiceError(
        error instanceof Error
          ? error.message
          : "The offline language download could not be opened.",
      );
    }
  }

  async function speakText(text: string) {
    const trimmedText = text.trim();
    if (!trimmedText) return;
    setVoiceError(null);
    await stopLocalSpeech();

    const availableVoices = await getOfflineVoices();
    setOfflineVoices(availableVoices);
    const languageVoiceAvailable = availableVoices.some((voice) =>
      voiceMatchesLanguage(voice.language, settings.voiceLanguage),
    );
    setVoiceOutputAvailable(languageVoiceAvailable);
    if (!languageVoiceAvailable) {
      setVoiceError(
        `No verified offline Android voice is installed for ${settings.voiceLanguage}. Add one in device Settings.`,
      );
      return;
    }

    speakLocally(trimmedText, {
      language: settings.voiceLanguage,
      rate: settings.speechRate,
      preferredVoiceId: settings.preferredVoiceId,
      onStart: () => setIsSpeaking(true),
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
      onError: (message) => {
        setIsSpeaking(false);
        setVoiceError(
          message || "The local voice could not speak this response.",
        );
      },
    });
  }

  async function stopSpeaking() {
    await stopLocalSpeech();
    setIsSpeaking(false);
  }

  async function openVoiceSettings() {
    try {
      await openLocalVoiceSettings();
    } catch {
      setVoiceError(
        "Android text-to-speech settings could not be opened from this build. Open Android Settings, then choose Text-to-speech output.",
      );
    }
  }

  function dismissVoiceError() {
    setVoiceError(null);
    setVoiceSetupMessage(null);
    if (voiceInputStatus === "error") {
      setVoiceInputStatus(voiceInputAvailable ? "idle" : "unavailable");
    }
  }

  async function updateSettings(patch: Partial<AppSettings>) {
    const nextSettings = { ...settings, ...patch };

    try {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
      setSettings(nextSettings);
      setStorageError(null);
    } catch {
      setStorageError("Settings could not be saved on this device.");
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

    try {
      await writeSecureRecord(
        SECURE_CONVERSATION_KEY,
        JSON.stringify(nextTurns.slice(-MAX_CONVERSATION_TURNS)),
      );
      setSavedTurnCount(Math.min(nextTurns.length, MAX_CONVERSATION_TURNS));
      setStorageError(null);
    } catch {
      setStorageError(
        "This message is visible now, but could not be saved locally.",
      );
    }
  }

  async function sendMessage(content: string) {
    const trimmedContent = content.trim();
    if (
      !trimmedContent ||
      isThinking ||
      !isConversationReady ||
      engineStatus !== "ready" ||
      !llamaContextRef.current
    ) {
      return;
    }

    if (settings.hapticsEnabled) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const userTurn: ConversationTurn = {
      id: createId(),
      role: "user",
      content: trimmedContent,
      createdAt: Date.now(),
    };
    const withUserTurn = [...turns, userTurn];

    setTurns(withUserTurn);
    setIsThinking(true);
    await persistTurns(withUserTurn);

    const assistantTurn: ConversationTurn = {
      id: createId(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };
    const withAssistantTurn = [...withUserTurn, assistantTurn];
    setTurns(withAssistantTurn);

    try {
      let streamedContent = "";
      const finalContent = await streamCompletion(
        llamaContextRef.current,
        withUserTurn.map((turn) => ({
          role: turn.role,
          content: turn.content,
        })),
        (token) => {
          streamedContent += token;
          setTurns((currentTurns) =>
            currentTurns.map((turn) =>
              turn.id === assistantTurn.id
                ? { ...turn, content: streamedContent }
                : turn,
            ),
          );
        },
        {
          displayName: profile.displayName,
          context: profile.context,
          memories: selectRelevantMemories(
            memories,
            trimmedContent,
            6,
            withUserTurn
              .slice(-6)
              .map((turn) => `${turn.role}: ${turn.content}`)
              .join("\n"),
          ),
        },
      );
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
      setTurns(completedTurns);
      await persistTurns(completedTurns);
      const completedResponse =
        completedTurns.find((turn) => turn.id === assistantTurn.id)?.content ??
        "";
      if (settings.spokenRepliesEnabled && completedResponse) {
        await speakText(completedResponse);
      }
      const conversationalReminder =
        parseConversationalReminder(trimmedContent);
      const hasReminderIntent = hasConversationalReminderIntent(trimmedContent);
      if (conversationalReminder) {
        setPendingMemoryCandidate(conversationalReminder);
      }
      try {
        if (!conversationalReminder && !hasReminderIntent) {
          const rawCandidate = await proposeMemoryCandidate(
            llamaContextRef.current,
            trimmedContent,
            completedResponse,
          );
          const candidate = parseMemoryCandidate(
            rawCandidate,
            memories,
            trimmedContent,
          );
          if (candidate) setPendingMemoryCandidate(candidate);
        }
      } catch {
        // Suggestions are optional and must never interrupt the conversation.
      }
    } catch (error) {
      const failedTurns = withAssistantTurn.map((turn) =>
        turn.id === assistantTurn.id
          ? {
              ...turn,
              content: `I could not finish that response locally. ${readableError(error)}`,
            }
          : turn,
      );
      setTurns(failedTurns);
      await persistTurns(failedTurns);
    } finally {
      setIsThinking(false);
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
      setTurns([]);
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

  const value = useMemo(
    () => ({
      settings,
      settingsReady,
      updateSettings,
      profile,
      saveProfile,
      skipProfile,
      clearProfile,
      turns,
      isConversationReady,
      isThinking,
      storageError,
      storageProtection,
      memories,
      pendingMemoryCandidate,
      saveMemoryCandidate,
      rejectMemoryCandidate: () => setPendingMemoryCandidate(null),
      updateMemory,
      updateMemoryAliases,
      archiveMemory,
      deleteMemory,
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
      installOfflineVoiceModel,
      speakText,
      stopSpeaking,
      openVoiceSettings,
      dismissVoiceError,
      sendMessage,
      clearConversation,
      storageUsage,
      refreshStorageUsage,
      reclaimUnusedModelFiles,
      storageDetailsExpanded,
      setStorageDetailsExpanded,
    }),
    [
      settings,
      settingsReady,
      profile,
      turns,
      isConversationReady,
      isThinking,
      storageError,
      storageProtection,
      memories,
      pendingMemoryCandidate,
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
      storageDetailsExpanded,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used inside AppProvider");
  }
  return context;
}
