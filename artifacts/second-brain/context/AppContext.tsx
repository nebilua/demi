import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import type { LlamaContext } from 'llama.rn';
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
} from '@/lib/offlineLlm';
import {
  canSpeakLocally,
  getRecognitionModule,
  speakLocally,
  stopLocalSpeech,
  openLocalVoiceSettings,
  voiceErrorMessage,
  type ExpoSpeechRecognitionResultEvent,
  type RecognitionModule,
  type VoiceInputStatus,
} from '@/lib/offlineVoice';
import {
  memoryFingerprint,
  parseApprovedMemories,
  parseMemoryCandidate,
  selectRelevantMemories,
  type ApprovedMemory,
  type MemoryCandidate,
} from '@/lib/memory';
import { computeFileSha256 } from '@/lib/fileHash';
import {
  getSecureStorageProtection,
  migratePlaintextRecord,
  readSecureRecord,
  removeSecureRecord,
  writeSecureRecord,
  type SecureStorageProtection,
} from '@/lib/secureLocalStorage';

export type Appearance = 'system' | 'light' | 'dark';

export type ConversationTurn = {
  id: string;
  role: 'user' | 'assistant';
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
};

export type PersonalProfile = {
  displayName: string;
  context: string;
  onboardingCompleted: boolean;
};

export type ModelSetupStatus =
  | 'idle'
  | 'selecting'
  | 'copying'
  | 'validating'
  | 'loading';

type AppContextValue = {
  settings: AppSettings;
  settingsReady: boolean;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  profile: PersonalProfile;
  saveProfile: (
    profile: Pick<PersonalProfile, 'displayName' | 'context'>,
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
  archiveMemory: (id: string, archived: boolean) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  savedTurnCount: number;
  localModel: LocalModel | null;
  deviceCompatibility: DeviceCompatibility;
  engineStatus: 'unsupported' | 'no-model' | 'loading' | 'ready' | 'error';
  engineProgress: number;
  engineError: string | null;
  modelSetupStatus: ModelSetupStatus;
  runtimeDetails: RuntimeDetails | null;
  voiceInputStatus: VoiceInputStatus;
  voiceInputAvailable: boolean;
  voiceOutputAvailable: boolean;
  voiceTranscript: string;
  voiceError: string | null;
  voiceSetupMessage: string | null;
  voiceSetupInProgress: boolean;
  isSpeaking: boolean;
  importModel: () => Promise<void>;
  downloadRecommendedModel: () => Promise<void>;
  cancelDownload: () => void;
  downloadStatus: 'idle' | 'downloading' | 'validating' | 'loading' | 'error';
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
};

const SETTINGS_KEY = '@second-brain/settings-v1';
const CONVERSATION_KEY = '@second-brain/conversation-v1';
const MODEL_KEY = '@second-brain/local-model-v1';
const PROFILE_KEY = '@second-brain/personal-profile-v1';
const SECURE_PROFILE_KEY = 'profile';
const SECURE_CONVERSATION_KEY = 'conversation';
const SECURE_MEMORIES_KEY = 'approved-memories';
const MAX_MEMORIES = 100;

const DEFAULT_SETTINGS: AppSettings = {
  appearance: 'system',
  hapticsEnabled: true,
  saveConversations: true,
  voiceInputEnabled: true,
  spokenRepliesEnabled: true,
  voiceLanguage: 'en-US',
  speechRate: 0.92,
};

const DEFAULT_PROFILE: PersonalProfile = {
  displayName: '',
  context: '',
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
        parsed.appearance === 'light' || parsed.appearance === 'dark'
          ? parsed.appearance
          : 'system',
      hapticsEnabled: parsed.hapticsEnabled !== false,
      saveConversations: parsed.saveConversations !== false,
      voiceInputEnabled: parsed.voiceInputEnabled !== false,
      spokenRepliesEnabled: parsed.spokenRepliesEnabled !== false,
      voiceLanguage:
        typeof parsed.voiceLanguage === 'string' ? parsed.voiceLanguage : 'en-US',
      speechRate:
        typeof parsed.speechRate === 'number' &&
        parsed.speechRate >= 0.75 &&
        parsed.speechRate <= 1.2
          ? parsed.speechRate
          : 0.92,
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
        typeof parsed.displayName === 'string'
          ? parsed.displayName.trim().slice(0, 80)
          : '',
      context:
        typeof parsed.context === 'string'
          ? parsed.context.trim().slice(0, 2000)
          : '',
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
        typeof turn.id === 'string' &&
        (turn.role === 'user' || turn.role === 'assistant') &&
        typeof turn.content === 'string' &&
        typeof turn.createdAt === 'number',
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
      typeof model.id !== 'string' ||
      typeof model.name !== 'string' ||
      typeof model.uri !== 'string' ||
      typeof model.sizeBytes !== 'number' ||
      typeof model.importedAt !== 'number' ||
      typeof model.contextSize !== 'number'
    ) {
      return null;
    }
    return model as LocalModel;
  } catch {
    return null;
  }
}

function cleanFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function readableError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const normalized = message.toLowerCase();
  if (
    normalized.includes('outofmemory') ||
    normalized.includes('out of memory') ||
    normalized.includes('allocation failed') ||
    normalized.includes('cannot allocate') ||
    normalized.includes('bad_alloc') ||
    normalized.includes('failed to create context') ||
    normalized.includes('failed to load model')
  ) {
    return 'Android ran out of memory while loading this model. Remove other apps from recents and retry with a smaller Q4 GGUF model.';
  }
  if (
    normalized.includes('no space') ||
    normalized.includes('insufficient storage') ||
    normalized.includes('storage full') ||
    normalized.includes('enospc')
  ) {
    return 'There is not enough free storage to copy this model. Free space on the device and try again.';
  }
  if (message) return message;
  return 'The model could not be loaded. Choose a smaller compatible GGUF file and try again.';
}

async function validateGgufHeader(uri: string) {
  const header = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: 4,
  });
  if (!header.replace(/\s/g, '').startsWith('R0dVRg')) {
    throw new Error(
      'This file is not a valid GGUF model. Choose a compatible Q4_K_M or other Q4 GGUF file.',
    );
  }
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
  const [memories, setMemories] = useState<ApprovedMemory[]>([]);
  const [pendingMemoryCandidate, setPendingMemoryCandidate] =
    useState<MemoryCandidate | null>(null);
  const memoriesRef = useRef<ApprovedMemory[]>([]);
  const memoryMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const storageProtection = getSecureStorageProtection();
  const [localModel, setLocalModel] = useState<LocalModel | null>(null);
  const [engineStatus, setEngineStatus] = useState<
    'unsupported' | 'no-model' | 'loading' | 'ready' | 'error'
  >(Platform.OS === 'web' ? 'unsupported' : 'no-model');
  const [engineProgress, setEngineProgress] = useState(0);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [modelSetupStatus, setModelSetupStatus] =
    useState<ModelSetupStatus>('idle');
  const [runtimeDetails, setRuntimeDetails] = useState<RuntimeDetails | null>(null);
  const [voiceInputStatus, setVoiceInputStatus] = useState<VoiceInputStatus>(
    Platform.OS === 'web' ? 'unavailable' : 'checking',
  );
  const [voiceInputAvailable, setVoiceInputAvailable] = useState(false);
  const [voiceOutputAvailable, setVoiceOutputAvailable] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSetupMessage, setVoiceSetupMessage] = useState<string | null>(null);
  const [voiceSetupInProgress, setVoiceSetupInProgress] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'validating' | 'loading' | 'error'>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadResumableRef = useRef<any>(null);

  const deviceCompatibility = useMemo(() => getDeviceCompatibility(), []);
  const llamaContextRef = useRef<LlamaContext | null>(null);
  const recognitionModuleRef = useRef<RecognitionModule | null>(null);
  const recognitionServicePackageRef = useRef<string | undefined>(undefined);
  const didRestoreModelRef = useRef(false);
  const modelImportInFlightRef = useRef(false);
  const modelLoadInFlightRef = useRef(false);
  const offlineVoiceSetupInFlightRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      AsyncStorage.getItem(SETTINGS_KEY),
      AsyncStorage.getItem(MODEL_KEY),
      migratePlaintextRecord(SECURE_CONVERSATION_KEY, CONVERSATION_KEY),
      migratePlaintextRecord(SECURE_PROFILE_KEY, PROFILE_KEY),
      readSecureRecord(SECURE_MEMORIES_KEY),
    ])
      .then(
        async ([
          storedSettings,
          storedModel,
          storedConversation,
          storedProfile,
          storedMemories,
        ]) => {
        if (!isMounted) return;
        const nextSettings = parseSettings(storedSettings);
        const savedTurns = parseTurns(storedConversation);
        const savedModel = parseModel(storedModel);
        const savedProfile = parseProfile(storedProfile);
        const savedMemories = parseApprovedMemories(storedMemories);

        setSettings(nextSettings);
        setProfile(savedProfile);
        setMemories(savedMemories);
        memoriesRef.current = savedMemories;
        setSavedTurnCount(savedTurns.length);
        setTurns(nextSettings.saveConversations ? savedTurns : []);
        if (savedModel && Platform.OS !== 'web') {
          const file = await FileSystem.getInfoAsync(savedModel.uri);
          if (file.exists) {
            setLocalModel(savedModel);
            setEngineStatus('no-model');
          } else {
            await AsyncStorage.removeItem(MODEL_KEY);
          }
        }
        setSettingsReady(true);
        setIsConversationReady(true);
        },
      )
      .catch(() => {
        if (!isMounted) return;
        setStorageError(
          'Secure local memory could not be opened. Prior data was preserved. Do not clear app data; restart the app or restore access to this device’s Android Keystore.',
        );
        setSettingsReady(true);
        setIsConversationReady(true);
      });

    return () => {
      isMounted = false;
      void llamaContextRef.current?.release();
      llamaContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    void canSpeakLocally().then((available) => {
      if (isMounted) setVoiceOutputAvailable(available);
    });

    const module = getRecognitionModule();
    recognitionModuleRef.current = module;
    if (!module) {
      setVoiceInputStatus('unavailable');
      return () => {
        isMounted = false;
        void stopLocalSpeech();
      };
    }

    void refreshVoiceAvailability(module);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshVoiceAvailability(module);
        void canSpeakLocally().then((available) => {
          if (isMounted) setVoiceOutputAvailable(available);
        });
        if (offlineVoiceSetupInFlightRef.current) {
          offlineVoiceSetupInFlightRef.current = false;
          setVoiceSetupInProgress(false);
        }
      }
    });

    const subscriptions = [
      module.addListener('start', () => {
        setVoiceInputStatus('listening');
        setVoiceError(null);
      }),
      module.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
        const transcript = event.results[0]?.transcript?.trim();
        if (transcript) setVoiceTranscript(transcript);
        if (event.isFinal) setVoiceInputStatus('processing');
      }),
      module.addListener('end', () => {
        setVoiceInputStatus((current) =>
          current === 'unavailable' || current === 'needs-model'
            ? current
            : 'idle',
        );
      }),
      module.addListener('error', (event) => {
        if (event.error === 'aborted') {
          setVoiceInputStatus('idle');
          return;
        }
        const needsModel =
          event.error === 'language-not-supported' ||
          event.error === 'service-not-allowed' ||
          event.error === 'network';
        setVoiceInputStatus(needsModel ? 'needs-model' : 'error');
        setVoiceError(voiceErrorMessage(event));
      }),
    ];

    return () => {
      isMounted = false;
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

  async function refreshVoiceAvailability(
    moduleOverride?: RecognitionModule,
  ) {
    const module = moduleOverride ?? recognitionModuleRef.current;
    if (!module || Platform.OS !== 'android') {
      setVoiceInputAvailable(false);
      setVoiceInputStatus('unavailable');
      return false;
    }

    const androidApiLevel =
      typeof Platform.Version === 'number' ? Platform.Version : 0;
    if (androidApiLevel < 33) {
      setVoiceInputAvailable(false);
      setVoiceInputStatus('unavailable');
      setVoiceSetupMessage(
        'Private offline dictation requires Android 13 or newer. Voice input is disabled on this device so audio cannot fall back to a network recognizer.',
      );
      return false;
    }

    try {
      if (
        !module.isRecognitionAvailable() ||
        !module.supportsOnDeviceRecognition()
      ) {
        setVoiceInputAvailable(false);
        setVoiceInputStatus('unavailable');
        setVoiceSetupMessage(
          'This device does not provide private on-device speech recognition.',
        );
        return false;
      }

      const services = module.getSpeechRecognitionServices();
      const onDevicePackage = services.includes('com.google.android.as')
        ? 'com.google.android.as'
        : undefined;
      recognitionServicePackageRef.current = onDevicePackage;
      const { installedLocales } = await module.getSupportedLocales({
        androidRecognitionServicePackage: onDevicePackage,
      });
      const expectedLocale = settings.voiceLanguage.toLowerCase();
      const expectedLanguage = expectedLocale.split('-')[0];
      const localeInstalled = installedLocales.some((locale) => {
        const normalized = locale.toLowerCase();
        return (
          normalized === expectedLocale ||
          normalized.split('-')[0] === expectedLanguage
        );
      });

      setVoiceInputAvailable(localeInstalled);
      setVoiceInputStatus(localeInstalled ? 'idle' : 'needs-model');
      setVoiceSetupMessage(
        localeInstalled
          ? null
          : 'Install the English offline language pack before using private voice input.',
      );
      return localeInstalled;
    } catch {
      setVoiceInputAvailable(false);
      setVoiceInputStatus('needs-model');
      setVoiceSetupMessage(
        'Demi could not verify an installed English offline language pack.',
      );
      return false;
    }
  }

  async function releaseModelContext() {
    const context = llamaContextRef.current;
    llamaContextRef.current = null;
    if (context) await context.release();
    setRuntimeDetails(null);
  }

  async function loadModel(modelOverride?: LocalModel): Promise<boolean> {
    const model = modelOverride ?? localModel;
    if (!model || modelLoadInFlightRef.current) return false;

    modelLoadInFlightRef.current = true;
    setModelSetupStatus('loading');
    setEngineStatus('loading');
    setEngineProgress(0);
    setEngineError(null);

    try {
      await releaseModelContext();
      const loaded = await loadNativeModel(model, deviceCompatibility, setEngineProgress);
      llamaContextRef.current = loaded.context;
      setRuntimeDetails(loaded.details);
      setEngineProgress(100);
      setEngineStatus('ready');
      return true;
    } catch (error) {
      setEngineError(readableError(error));
      setEngineStatus('error');
      return false;
    } finally {
      modelLoadInFlightRef.current = false;
      setModelSetupStatus('idle');
    }
  }

  useEffect(() => {
    if (!settingsReady || didRestoreModelRef.current) return;
    didRestoreModelRef.current = true;
    if (localModel) void loadModel(localModel);
  }, [settingsReady, localModel]);

  async function importModel() {
    if (modelImportInFlightRef.current || modelLoadInFlightRef.current) return;
    if (Platform.OS === 'web') {
      setEngineError(
        'Model import and offline inference are available in the installed Android app.',
      );
      setEngineStatus('unsupported');
      return;
    }

    modelImportInFlightRef.current = true;
    setModelSetupStatus('selecting');
    setEngineError(null);
    let destination: string | null = null;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/octet-stream',
        copyToCacheDirectory: true,
        multiple: false,
      });
       if (result.canceled) {
         setModelSetupStatus('idle');
         return;
       }

      const asset = result.assets[0];
      if (!asset.name.toLowerCase().endsWith('.gguf')) {
        setEngineError('Choose a quantized model file ending in .gguf.');
        setEngineStatus('error');
         setModelSetupStatus('idle');
        return;
      }

       setModelSetupStatus('validating');
      const sourceInfo = await FileSystem.getInfoAsync(asset.uri);
      const sizeBytes = asset.size ?? (sourceInfo.exists ? sourceInfo.size ?? 0 : 0);
      if (sizeBytes <= 0) {
        setEngineError('The selected file could not be read.');
        setEngineStatus('error');
         setModelSetupStatus('idle');
        return;
      }
       await validateGgufHeader(asset.uri);

       let freeStorageBytes: number;
       try {
         freeStorageBytes = await FileSystem.getFreeDiskStorageAsync();
       } catch {
         throw new Error(
           'Demi could not check free storage before copying this model. Try again after closing other apps.',
         );
       }
       const storageSafetyMargin = 128 * 1024 * 1024;
       if (freeStorageBytes < sizeBytes + storageSafetyMargin) {
         throw new Error(
           `There is not enough free storage to copy this ${formatBytes(sizeBytes)} model. Free at least ${formatBytes(
             sizeBytes + storageSafetyMargin,
           )} and try again.`,
         );
       }

      const modelsDirectory = `${FileSystem.documentDirectory}models`;
      await FileSystem.makeDirectoryAsync(modelsDirectory, { intermediates: true });
       destination = `${modelsDirectory}/${Date.now()}-${cleanFileName(asset.name)}`;
       setModelSetupStatus('copying');
      await FileSystem.copyAsync({ from: asset.uri, to: destination });
       setModelSetupStatus('validating');
       const copiedInfo = await FileSystem.getInfoAsync(destination);
       if (!copiedInfo.exists || (copiedInfo.size ?? 0) !== sizeBytes) {
         throw new Error(
           'The model copy did not finish correctly. Remove the partial file and try importing it again.',
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
        setEngineStatus('error');
         setModelSetupStatus('idle');
        return;
      }

       const previousModel = localModel;
       const loaded = await loadModel(nextModel);
       if (!loaded) {
         await FileSystem.deleteAsync(destination, { idempotent: true });
         destination = null;
         return;
      }
       setLocalModel(nextModel);
       destination = null;
       try {
         await AsyncStorage.setItem(MODEL_KEY, JSON.stringify(nextModel));
         setStorageError(null);
       } catch {
         setStorageError(
           'The model is ready for this session, but its selection could not be saved locally.',
         );
       }
       if (previousModel && previousModel.uri !== nextModel.uri) {
         await FileSystem.deleteAsync(previousModel.uri, { idempotent: true }).catch(
           () => {},
         );
       }
    } catch (error) {
      if (destination) {
        await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
      }
      setEngineError(readableError(error));
      setEngineStatus('error');
      setModelSetupStatus('idle');
    } finally {
      modelImportInFlightRef.current = false;
    }
  }

  async function removeModel() {
    const model = localModel;
    await releaseModelContext();
    if (model) await FileSystem.deleteAsync(model.uri, { idempotent: true });
    await AsyncStorage.removeItem(MODEL_KEY);
    setLocalModel(null);
    setEngineProgress(0);
    setEngineError(null);
    setEngineStatus(Platform.OS === 'web' ? 'unsupported' : 'no-model');
  }

  function cancelDownload() {
    if (downloadResumableRef.current) {
      downloadResumableRef.current.cancelAsync().catch(() => {});
      const dest = downloadResumableRef.current.fileUri;
      if (dest) FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
      downloadResumableRef.current = null;
    }
    setDownloadStatus('idle');
    setDownloadProgress(0);
  }

  async function downloadRecommendedModel() {
    if (modelLoadInFlightRef.current || downloadStatus === 'downloading') return;
    if (Platform.OS === 'web') {
      setDownloadError('Model download is available in the installed Android app.');
      setDownloadStatus('error');
      return;
    }

    setDownloadStatus('downloading');
    setDownloadProgress(0);
    setDownloadError(null);

    const modelsDirectory = `${FileSystem.documentDirectory}models`;
    const destination = `${modelsDirectory}/${Date.now()}-${RECOMMENDED_MODEL.name}`;

    try {
      if (!deviceCompatibility.architectureSupported) {
        throw new Error(
          'This device needs a 64-bit ARM or x86-64 processor to run the local model.',
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
        throw new Error('Could not check free storage.');
      }
      const storageSafetyMargin = 128 * 1024 * 1024;
      if (freeStorageBytes < RECOMMENDED_MODEL.sizeBytes + storageSafetyMargin) {
        throw new Error(`Not enough free storage. Need ${formatBytes(RECOMMENDED_MODEL.sizeBytes + storageSafetyMargin)}.`);
      }
      await FileSystem.makeDirectoryAsync(modelsDirectory, { intermediates: true });

      const downloadResumable = FileSystem.createDownloadResumable(
        RECOMMENDED_MODEL.url,
        destination,
        {},
        (downloadProgress) => {
          const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
          setDownloadProgress(progress * 100);
        }
      );
      downloadResumableRef.current = downloadResumable;

      const result = await downloadResumable.downloadAsync();
      downloadResumableRef.current = null;

      if (!result || result.status !== 200) {
        throw new Error('Download failed.');
      }

      const downloadedInfo = await FileSystem.getInfoAsync(destination);
      if (!downloadedInfo.exists || downloadedInfo.size !== RECOMMENDED_MODEL.sizeBytes) {
        throw new Error('Downloaded file size does not match expected size.');
      }

      setDownloadStatus('validating');
      await validateGgufHeader(destination);

      const checksum = await computeFileSha256(destination);
      if (checksum !== RECOMMENDED_MODEL.expectedChecksum) {
        throw new Error('Downloaded file checksum does not match expected checksum.');
      }

      setDownloadStatus('loading');

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
      if (!loaded) {
        await FileSystem.deleteAsync(destination, { idempotent: true });
        setDownloadStatus('idle');
        return;
      }

      setLocalModel(nextModel);
      try {
        await AsyncStorage.setItem(MODEL_KEY, JSON.stringify(nextModel));
        setStorageError(null);
      } catch {
        setStorageError(
           'The model is ready for this session, but its selection could not be saved locally.',
        );
      }

      if (previousModel && previousModel.uri !== nextModel.uri) {
        await FileSystem.deleteAsync(previousModel.uri, { idempotent: true }).catch(() => {});
      }

      setDownloadStatus('idle');

    } catch (error) {
      downloadResumableRef.current = null;
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
      setDownloadError(error instanceof Error ? error.message : 'Download failed.');
      setDownloadStatus('error');
    }
  }

  async function startVoiceInput() {
    if (!settings.voiceInputEnabled) {
      setVoiceError('Voice input is turned off in Settings.');
      return;
    }

    const module = recognitionModuleRef.current;
    if (!module) {
      setVoiceInputStatus('unavailable');
      setVoiceError(
        'Offline listening needs the installed Android build. It is not included in Expo Go or the browser preview.',
      );
      return;
    }

    const androidApiLevel =
      Platform.OS === 'android' && typeof Platform.Version === 'number'
        ? Platform.Version
        : 0;
    if (Platform.OS !== 'android' || androidApiLevel < 33) {
      setVoiceInputStatus('unavailable');
      setVoiceError(
        'Private offline voice input requires an installed Android 13 or newer build.',
      );
      return;
    }

    setVoiceError(null);
    setVoiceSetupMessage(null);
    await stopSpeaking();

    try {
      const permission = await module.requestPermissionsAsync();
      if (!permission.granted) {
        setVoiceInputStatus('error');
        setVoiceError(
          permission.canAskAgain === false
            ? 'Microphone access is blocked. Open Android Settings to enable it.'
            : 'Microphone access is required for local voice input.',
        );
        return;
      }

      const offlineLocaleInstalled = await refreshVoiceAvailability(module);
      if (!offlineLocaleInstalled) {
        setVoiceInputStatus('needs-model');
        setVoiceError(
          'Install the English offline language pack before using private voice input.',
        );
        return;
      }

      setVoiceInputAvailable(true);
      setVoiceTranscript('');
      setVoiceInputStatus('checking');
      module.start({
        lang: settings.voiceLanguage,
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
        androidRecognitionServicePackage:
          recognitionServicePackageRef.current,
      });
    } catch (error) {
      setVoiceInputStatus('error');
      setVoiceError(
        error instanceof Error
          ? error.message
          : 'Offline voice input could not start.',
      );
    }
  }

  function stopVoiceInput() {
    const module = recognitionModuleRef.current;
    if (!module) return;
    setVoiceInputStatus('processing');
    module.stop();
  }

  function cancelVoiceInput() {
    const module = recognitionModuleRef.current;
    if (!module) return;
    module.abort();
    setVoiceTranscript('');
    setVoiceInputStatus('idle');
    setVoiceError(null);
  }

  function clearVoiceTranscript() {
    setVoiceTranscript('');
  }

  async function installOfflineVoiceModel() {
    if (offlineVoiceSetupInFlightRef.current) return;
    const module = recognitionModuleRef.current;
    if (!module || Platform.OS !== 'android') {
      setVoiceError(
        'Offline language installation is available in the installed Android build.',
      );
      return;
    }

    const androidApiLevel =
      typeof Platform.Version === 'number' ? Platform.Version : 0;
    if (androidApiLevel < 33) {
      setVoiceInputStatus('unavailable');
      setVoiceError(
        'Private offline dictation requires Android 13 or newer and is disabled on this device.',
      );
      return;
    }

    offlineVoiceSetupInFlightRef.current = true;
    setVoiceSetupInProgress(true);
    setVoiceError(null);
    setVoiceSetupMessage(null);
    setVoiceInputStatus('checking');
    try {
      const result = await module.androidTriggerOfflineModelDownload({
        locale: settings.voiceLanguage,
      });
      setVoiceSetupMessage(
        result.status === 'download_success'
          ? 'English offline recognition is installed.'
          : result.status === 'download_scheduled'
            ? 'The offline language download is scheduled. Android may wait for Wi-Fi.'
            : 'Android opened the offline language download. Return here when it finishes.',
      );
      await refreshVoiceAvailability(module);
      if (result.status !== 'opened_dialog') {
        offlineVoiceSetupInFlightRef.current = false;
        setVoiceSetupInProgress(false);
      }
    } catch (error) {
      offlineVoiceSetupInFlightRef.current = false;
      setVoiceSetupInProgress(false);
      setVoiceInputStatus('needs-model');
      setVoiceError(
        error instanceof Error
          ? error.message
          : 'The offline language download could not be opened.',
      );
    }
  }

  async function speakText(text: string) {
    const trimmedText = text.trim();
    if (!trimmedText) return;
    setVoiceError(null);
    await stopLocalSpeech();

    if (!(await canSpeakLocally())) {
      setVoiceOutputAvailable(false);
      setVoiceError(
        'No local Android voice is installed. Add a text-to-speech voice in device Settings.',
      );
      return;
    }

    setVoiceOutputAvailable(true);
    speakLocally(trimmedText, {
      language: settings.voiceLanguage,
      rate: settings.speechRate,
      onStart: () => setIsSpeaking(true),
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
      onError: (message) => {
        setIsSpeaking(false);
        setVoiceError(message || 'The local voice could not speak this response.');
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
        'Android text-to-speech settings could not be opened from this build. Open Android Settings, then choose Text-to-speech output.',
      );
    }
  }

  function dismissVoiceError() {
    setVoiceError(null);
    setVoiceSetupMessage(null);
    if (voiceInputStatus === 'error') {
      setVoiceInputStatus(voiceInputAvailable ? 'idle' : 'unavailable');
    }
  }

  async function updateSettings(patch: Partial<AppSettings>) {
    const nextSettings = { ...settings, ...patch };
    setSettings(nextSettings);

    try {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
      setStorageError(null);
    } catch {
      setStorageError('Settings could not be saved on this device.');
    }
  }

  async function persistProfile(nextProfile: PersonalProfile) {
    try {
      await writeSecureRecord(SECURE_PROFILE_KEY, JSON.stringify(nextProfile));
      setProfile(nextProfile);
      setStorageError(null);
    } catch {
      setStorageError('Your local profile could not be saved on this device.');
    }
  }

  async function saveProfile(
    nextProfile: Pick<PersonalProfile, 'displayName' | 'context'>,
  ) {
    await persistProfile({
      displayName: nextProfile.displayName.trim().slice(0, 80),
      context: nextProfile.context.trim().slice(0, 2000),
      onboardingCompleted: true,
    });
  }

  async function skipProfile() {
    await persistProfile({
      displayName: '',
      context: '',
      onboardingCompleted: true,
    });
  }

  async function clearProfile() {
    await persistProfile({
      displayName: '',
      context: '',
      onboardingCompleted: true,
    });
  }

  async function persistTurns(nextTurns: ConversationTurn[]) {
    if (!settings.saveConversations) return;

    try {
      await writeSecureRecord(
        SECURE_CONVERSATION_KEY,
        JSON.stringify(nextTurns.slice(-80)),
      );
      setSavedTurnCount(nextTurns.length);
      setStorageError(null);
    } catch {
      setStorageError('This message is visible now, but could not be saved locally.');
    }
  }

  async function sendMessage(content: string) {
    const trimmedContent = content.trim();
    if (
      !trimmedContent ||
      isThinking ||
      !isConversationReady ||
      engineStatus !== 'ready' ||
      !llamaContextRef.current
    ) {
      return;
    }

    if (settings.hapticsEnabled) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const userTurn: ConversationTurn = {
      id: createId(),
      role: 'user',
      content: trimmedContent,
      createdAt: Date.now(),
    };
    const withUserTurn = [...turns, userTurn];

    setTurns(withUserTurn);
    setIsThinking(true);
    await persistTurns(withUserTurn);

    const assistantTurn: ConversationTurn = {
      id: createId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };
    const withAssistantTurn = [...withUserTurn, assistantTurn];
    setTurns(withAssistantTurn);

    try {
      let streamedContent = '';
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
          memories: selectRelevantMemories(memories, trimmedContent),
        },
      );
      const completedTurns = withAssistantTurn.map((turn) =>
        turn.id === assistantTurn.id
          ? {
              ...turn,
              content:
                finalContent ||
                streamedContent ||
                'The model finished without returning text. Try asking in a different way.',
            }
          : turn,
      );
      setTurns(completedTurns);
      await persistTurns(completedTurns);
      const completedResponse =
        completedTurns.find((turn) => turn.id === assistantTurn.id)?.content ?? '';
      if (settings.spokenRepliesEnabled && completedResponse) {
        await speakText(completedResponse);
      }
      try {
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
    try {
      await removeSecureRecord(SECURE_CONVERSATION_KEY);
      setTurns([]);
      setSavedTurnCount(0);
      setStorageError(null);
    } catch {
      setStorageError('Conversation history could not be cleared.');
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
        .slice(0, MAX_MEMORIES);
      await writeSecureRecord(
        SECURE_MEMORIES_KEY,
        JSON.stringify(bounded),
      );
      memoriesRef.current = bounded;
      setMemories(bounded);
      setStorageError(null);
    } catch {
      setStorageError(
        'Memory changes could not be encrypted and saved. Your previous memories are unchanged.',
      );
      throw new Error('The memory could not be saved securely.');
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
    if (!candidate || candidate.kind !== 'memory') return;
    const content = (editedContent ?? candidate.content).trim().slice(0, 240);
    if (
      !content ||
      memories.some(
        (memory) => memoryFingerprint(memory.content) === memoryFingerprint(content),
      )
    ) {
      setPendingMemoryCandidate(null);
      return;
    }
    const now = Date.now();
    await mutateMemories((current) => [
      {
        id: createId(),
        category: candidate.category,
        content,
        source: {
          turnId: turns.filter((turn) => turn.role === 'user').at(-1)?.id ?? '',
          excerpt: candidate.sourceExcerpt,
          createdAt: now,
        },
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      },
      ...current,
    ]);
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
      )
    );
  }

  async function archiveMemory(id: string, archived: boolean) {
    await mutateMemories((current) =>
      current.map((memory) =>
        memory.id === id
          ? { ...memory, archivedAt: archived ? Date.now() : null, updatedAt: Date.now() }
          : memory,
      )
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
      voiceTranscript,
      voiceError,
      voiceSetupMessage,
      voiceSetupInProgress,
      isSpeaking,
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
      voiceTranscript,
      voiceError,
      voiceSetupMessage,
      voiceSetupInProgress,
      isSpeaking,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used inside AppProvider');
  }
  return context;
}