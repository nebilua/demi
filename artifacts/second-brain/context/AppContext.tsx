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
import { Platform } from 'react-native';
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
  importModel: () => Promise<void>;
  loadModel: () => Promise<void>;
  removeModel: () => Promise<void>;
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
  const deviceCompatibility = useMemo(() => getDeviceCompatibility(), []);
  const llamaContextRef = useRef<LlamaContext | null>(null);
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
      importModel,
      loadModel,
      removeModel,
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