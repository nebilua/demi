import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

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
  sendMessage: (content: string) => Promise<void>;
  clearConversation: () => Promise<void>;
};

const SETTINGS_KEY = '@second-brain/settings-v1';
const CONVERSATION_KEY = '@second-brain/conversation-v1';

const DEFAULT_SETTINGS: AppSettings = {
  appearance: 'system',
  hapticsEnabled: true,
  saveConversations: true,
};

const AppContext = createContext<AppContextValue | null>(null);

function createId() {
  return `${Date.now().toString()}-${Math.random().toString(36).slice(2, 10)}`;
}

function localReply(input: string) {
  const normalized = input.toLowerCase();

  if (normalized.includes('hello') || normalized.includes('hi')) {
    return 'Hi. I’m here with you, on this device. What would you like to think through?';
  }

  if (normalized.includes('thank')) {
    return 'You’re welcome. I’m keeping this conversation right here on your phone.';
  }

  if (normalized.includes('?')) {
    return 'That’s worth exploring. Start with the part that feels most important, and we can work through it together.';
  }

  if (normalized.includes('remember')) {
    return 'I can keep the context of this conversation locally while we’re working through it.';
  }

  return 'I’m listening. Keep going, and I’ll help you make sense of it one step at a time.';
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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [savedTurnCount, setSavedTurnCount] = useState(0);
  const [isConversationReady, setIsConversationReady] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      AsyncStorage.getItem(SETTINGS_KEY),
      AsyncStorage.getItem(CONVERSATION_KEY),
    ])
      .then(([storedSettings, storedConversation]) => {
        if (!isMounted) return;
        const nextSettings = parseSettings(storedSettings);
        const savedTurns = parseTurns(storedConversation);

        setSettings(nextSettings);
        setSavedTurnCount(savedTurns.length);
        setTurns(nextSettings.saveConversations ? savedTurns : []);
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
    };
  }, []);

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
    if (!trimmedContent || isThinking || !isConversationReady) return;

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

    await new Promise((resolve) => setTimeout(resolve, 650));

    const assistantTurn: ConversationTurn = {
      id: createId(),
      role: 'assistant',
      content: localReply(trimmedContent),
      createdAt: Date.now(),
    };
    const completedTurns = [...withUserTurn, assistantTurn];
    setTurns(completedTurns);
    setIsThinking(false);
    await persistTurns(completedTurns);
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