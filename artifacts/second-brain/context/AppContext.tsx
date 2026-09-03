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
import { AppState, Linking, Platform } from 'react-native';
import type { LlamaContext } from 'llama.rn';
import {
  formatBytes,
  getDeviceCompatibility,
  loadNativeModel,
  streamCompletion,
  type DeviceCompatibility,
  type LocalModel,
  type RuntimeDetails,
} from '@/lib/offlineLlm';
import {
  canSpeakLocally,
  getRecognitionModule,
  speakLocally,
  stopLocalSpeech,
  voiceErrorMessage,
  type ExpoSpeechRecognitionResultEvent,
  type RecognitionModule,
  type VoiceInputStatus,
} from '@/lib/offlineVoice';

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

type AppContextValue = {
  settings: AppSettings;
  settingsReady: boolean;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  turns: ConversationTurn[];
  isConversationReady: boolean;
  isThinking: boolean;
  storageError: string | null;
  savedTurnCount: number;
  localModel: LocalModel | null;
  deviceCompatibility: DeviceCompatibility;
  engineStatus: 'unsupported' | 'no-model' | 'loading' | 'ready' | 'error';
  engineProgress: number;
  engineError: string | null;
  runtimeDetails: RuntimeDetails | null;
  voiceInputStatus: VoiceInputStatus;
  voiceInputAvailable: boolean;
  voiceOutputAvailable: boolean;
  voiceTranscript: string;
  voiceError: string | null;
  voiceSetupMessage: string | null;
  isSpeaking: boolean;
  importModel: () => Promise<void>;
  loadModel: () => Promise<void>;
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

const DEFAULT_SETTINGS: AppSettings = {
  appearance: 'system',
  hapticsEnabled: true,
  saveConversations: true,
  voiceInputEnabled: true,
  spokenRepliesEnabled: false,
  voiceLanguage: 'en-US',
  speechRate: 0.92,
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
      spokenRepliesEnabled: parsed.spokenRepliesEnabled === true,
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
  if (error instanceof Error) return error.message;
  return 'The model could not be loaded. Choose a smaller compatible GGUF file and try again.';
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [savedTurnCount, setSavedTurnCount] = useState(0);
  const [isConversationReady, setIsConversationReady] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [localModel, setLocalModel] = useState<LocalModel | null>(null);
  const [engineStatus, setEngineStatus] = useState<
    'unsupported' | 'no-model' | 'loading' | 'ready' | 'error'
  >(Platform.OS === 'web' ? 'unsupported' : 'no-model');
  const [engineProgress, setEngineProgress] = useState(0);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [runtimeDetails, setRuntimeDetails] = useState<RuntimeDetails | null>(null);
  const [voiceInputStatus, setVoiceInputStatus] = useState<VoiceInputStatus>(
    Platform.OS === 'web' ? 'unavailable' : 'checking',
  );
  const [voiceInputAvailable, setVoiceInputAvailable] = useState(false);
  const [voiceOutputAvailable, setVoiceOutputAvailable] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSetupMessage, setVoiceSetupMessage] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const deviceCompatibility = useMemo(() => getDeviceCompatibility(), []);
  const llamaContextRef = useRef<LlamaContext | null>(null);
  const recognitionModuleRef = useRef<RecognitionModule | null>(null);
  const recognitionServicePackageRef = useRef<string | undefined>(undefined);
  const didRestoreModelRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      AsyncStorage.getItem(SETTINGS_KEY),
      AsyncStorage.getItem(CONVERSATION_KEY),
      AsyncStorage.getItem(MODEL_KEY),
    ])
      .then(async ([storedSettings, storedConversation, storedModel]) => {
        if (!isMounted) return;
        const nextSettings = parseSettings(storedSettings);
        const savedTurns = parseTurns(storedConversation);
        const savedModel = parseModel(storedModel);

        setSettings(nextSettings);
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
      })
      .catch(() => {
        if (!isMounted) return;
        setStorageError('Local storage could not be opened. New messages will remain in memory.');
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
      if (state === 'active') void refreshVoiceAvailability(module);
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
        'Second Brain could not verify an installed English offline language pack.',
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

  async function loadModel(modelOverride?: LocalModel) {
    const model = modelOverride ?? localModel;
    if (!model || engineStatus === 'loading') return;

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
    } catch (error) {
      setEngineError(readableError(error));
      setEngineStatus('error');
    }
  }

  useEffect(() => {
    if (!settingsReady || didRestoreModelRef.current) return;
    didRestoreModelRef.current = true;
    if (localModel) void loadModel(localModel);
  }, [settingsReady, localModel]);

  async function importModel() {
    if (Platform.OS === 'web') {
      setEngineError(
        'Model import and offline inference are available in the installed Android app.',
      );
      setEngineStatus('unsupported');
      return;
    }

    setEngineError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/octet-stream',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset.name.toLowerCase().endsWith('.gguf')) {
        setEngineError('Choose a quantized model file ending in .gguf.');
        setEngineStatus('error');
        return;
      }

      const sourceInfo = await FileSystem.getInfoAsync(asset.uri);
      const sizeBytes = asset.size ?? (sourceInfo.exists ? sourceInfo.size ?? 0 : 0);
      if (sizeBytes <= 0) {
        setEngineError('The selected file could not be read.');
        setEngineStatus('error');
        return;
      }

      const modelsDirectory = `${FileSystem.documentDirectory}models`;
      await FileSystem.makeDirectoryAsync(modelsDirectory, { intermediates: true });
      const destination = `${modelsDirectory}/${Date.now()}-${cleanFileName(asset.name)}`;
      await FileSystem.copyAsync({ from: asset.uri, to: destination });

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
        setEngineError(
          `${asset.name} is ${formatBytes(sizeBytes)}. Choose a model smaller than ${formatBytes(
            deviceCompatibility.maxRecommendedModelBytes,
          )} to avoid a low-memory crash.`,
        );
        setEngineStatus('error');
        return;
      }

      const previousModel = localModel;
      await releaseModelContext();
      setLocalModel(nextModel);
      await AsyncStorage.setItem(MODEL_KEY, JSON.stringify(nextModel));
      if (previousModel && previousModel.uri !== nextModel.uri) {
        await FileSystem.deleteAsync(previousModel.uri, { idempotent: true });
      }
      await loadModel(nextModel);
    } catch (error) {
      setEngineError(readableError(error));
      setEngineStatus('error');
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
    } catch (error) {
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
      await Linking.openSettings();
    } catch {
      setVoiceError('Android Settings could not be opened from this preview.');
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

  async function persistTurns(nextTurns: ConversationTurn[]) {
    if (!settings.saveConversations) return;

    try {
      await AsyncStorage.setItem(CONVERSATION_KEY, JSON.stringify(nextTurns));
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
      await AsyncStorage.removeItem(CONVERSATION_KEY);
      setTurns([]);
      setSavedTurnCount(0);
      setStorageError(null);
    } catch {
      setStorageError('Conversation history could not be cleared.');
    }
  }

  const value = useMemo(
    () => ({
      settings,
      settingsReady,
      updateSettings,
      turns,
      isConversationReady,
      isThinking,
      storageError,
      savedTurnCount,
      localModel,
      deviceCompatibility,
      engineStatus,
      engineProgress,
      engineError,
      runtimeDetails,
      voiceInputStatus,
      voiceInputAvailable,
      voiceOutputAvailable,
      voiceTranscript,
      voiceError,
      voiceSetupMessage,
      isSpeaking,
      importModel,
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
      turns,
      isConversationReady,
      isThinking,
      storageError,
      savedTurnCount,
      localModel,
      deviceCompatibility,
      engineStatus,
      engineProgress,
      engineError,
      runtimeDetails,
      voiceInputStatus,
      voiceInputAvailable,
      voiceOutputAvailable,
      voiceTranscript,
      voiceError,
      voiceSetupMessage,
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