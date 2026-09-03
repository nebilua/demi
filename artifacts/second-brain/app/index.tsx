import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';

type Role = 'user' | 'assistant';

type ConversationTurn = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
};

const STORAGE_KEY = '@second-brain/conversation-v1';

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

function TypingIndicator() {
  const colors = useColors();

  return (
    <View style={styles.typingRow}>
      <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
        <Feather name="aperture" size={15} color={colors.accentForeground} />
      </View>
      <View style={[styles.typingBubble, { backgroundColor: colors.card }]}>
        <View style={[styles.dot, { backgroundColor: colors.mutedForeground }]} />
        <View style={[styles.dot, { backgroundColor: colors.mutedForeground }]} />
        <View style={[styles.dot, { backgroundColor: colors.mutedForeground }]} />
      </View>
    </View>
  );
}

function MessageBubble({ item }: { item: ConversationTurn }) {
  const colors = useColors();
  const isUser = item.role === 'user';

  return (
    <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
      {!isUser && (
        <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
          <Feather name="aperture" size={15} color={colors.accentForeground} />
        </View>
      )}
      <View
        style={[
          styles.messageBubble,
          isUser
            ? { backgroundColor: colors.primary }
            : { backgroundColor: colors.card },
        ]}
      >
        <Text
          style={[
            styles.messageText,
            { color: isUser ? colors.primaryForeground : colors.cardForeground },
          ]}
        >
          {item.content}
        </Text>
      </View>
    </View>
  );
}

export default function SecondBrainScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!isMounted) return;
        if (stored) {
          setTurns(JSON.parse(stored) as ConversationTurn[]);
        }
        setIsLoading(false);
      })
      .catch(() => {
        if (isMounted) {
          setLoadError(true);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const visibleTurns = useMemo(() => [...turns].reverse(), [turns]);
  const canSend = draft.trim().length > 0 && !isThinking && !isLoading;

  async function persist(nextTurns: ConversationTurn[]) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextTurns));
    } catch {
      setLoadError(true);
    }
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!content || isThinking || isLoading) return;

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const userTurn: ConversationTurn = {
      id: createId(),
      role: 'user',
      content,
      createdAt: Date.now(),
    };
    const withUserTurn = [...turns, userTurn];

    setDraft('');
    setTurns(withUserTurn);
    setIsThinking(true);
    await persist(withUserTurn);

    await new Promise((resolve) => setTimeout(resolve, 650));
    const assistantTurn: ConversationTurn = {
      id: createId(),
      role: 'assistant',
      content: localReply(content),
      createdAt: Date.now(),
    };
    const completedTurns = [...withUserTurn, assistantTurn];
    setTurns(completedTurns);
    setIsThinking(false);
    await persist(completedTurns);
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <StatusBar style="light" />
      <View style={[styles.safeTop, { paddingTop: insets.top }]} />
      <View style={styles.header}>
        <View style={styles.brandLockup}>
          <Image
            source={require('../assets/images/icon.png')}
            style={styles.brandMark}
          />
          <View>
            <Text style={[styles.wordmark, { color: colors.foreground }]}>
              second brain
            </Text>
            <Text style={[styles.headerSubline, { color: colors.mutedForeground }]}>
              your private thinking space
            </Text>
          </View>
        </View>
        <View style={[styles.statusPill, { backgroundColor: colors.accent }]}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: colors.accentForeground },
            ]}
          />
          <Text style={[styles.statusText, { color: colors.accentForeground }]}>
            LOCAL
          </Text>
        </View>
      </View>

      <View style={styles.content}>
        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
              Opening your private space…
            </Text>
          </View>
        ) : loadError ? (
          <View style={styles.centerState}>
            <Feather name="alert-circle" size={24} color={colors.destructive} />
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>
              Your history couldn’t be opened
            </Text>
            <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
              New messages will still work, but this session may not be saved.
            </Text>
          </View>
        ) : turns.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
              <Feather name="sun" size={25} color={colors.primary} />
            </View>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>
              GOOD TO HAVE YOU HERE
            </Text>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>
              A quieter way{'\n'}to think.
            </Text>
            <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
              Talk things out, untangle ideas, or simply begin wherever you are.
              Your conversation stays on this phone.
            </Text>
            <View
              style={[
                styles.engineCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View
                style={[
                  styles.engineIcon,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <Feather name="cpu" size={18} color={colors.primary} />
              </View>
              <View style={styles.engineCopy}>
                <Text style={[styles.engineTitle, { color: colors.cardForeground }]}>
                  On-device engine
                </Text>
                <Text style={[styles.engineBody, { color: colors.mutedForeground }]}>
                  Private by default · no network needed
                </Text>
              </View>
              <Feather name="check" size={18} color={colors.accentForeground} />
            </View>
          </View>
        ) : (
          <FlatList
            data={visibleTurns}
            inverted
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <MessageBubble item={item} />}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            scrollEnabled={visibleTurns.length > 0}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={isThinking ? <TypingIndicator /> : null}
          />
        )}
      </View>

      <View
        style={[
          styles.composerArea,
          {
            paddingBottom: Math.max(
              insets.bottom,
              Platform.OS === 'web' ? 34 : 12,
            ),
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
        ]}
      >
        <View
          style={[
            styles.composer,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <TextInput
            testID="chat-input"
            value={draft}
            onChangeText={setDraft}
            placeholder="What’s on your mind?"
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={1200}
            editable={!isLoading}
            style={[styles.input, { color: colors.cardForeground }]}
            onSubmitEditing={Platform.OS === 'web' ? sendMessage : undefined}
            blurOnSubmit={false}
          />
          <Pressable
            testID="send-message"
            accessibilityRole="button"
            accessibilityLabel="Send message"
            onPress={sendMessage}
            disabled={!canSend}
            style={({ pressed }) => [
              styles.sendButton,
              { backgroundColor: canSend ? colors.primary : colors.secondary },
              pressed && canSend && styles.pressed,
            ]}
          >
            {isThinking ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Feather
                name="arrow-up"
                size={19}
                color={canSend ? colors.primaryForeground : colors.mutedForeground}
              />
            )}
          </Pressable>
        </View>
        <Text style={[styles.privacyNote, { color: colors.mutedForeground }]}>
          stored locally on this device
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeTop: {
    backgroundColor: 'transparent',
  },
  header: {
    minHeight: 72,
    paddingHorizontal: 22,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  brandMark: {
    width: 32,
    height: 32,
    borderRadius: 10,
  },
  wordmark: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    letterSpacing: -0.4,
  },
  headerSubline: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    letterSpacing: 0.4,
    marginTop: 2,
  },
  statusPill: {
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 99,
  },
  statusText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 1,
  },
  content: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 36,
  },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  eyebrow: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  heroTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: -1.5,
    marginBottom: 15,
  },
  heroBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 330,
  },
  engineCard: {
    borderWidth: 1,
    borderRadius: 18,
    marginTop: 28,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
  },
  engineIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  engineCopy: {
    flex: 1,
  },
  engineTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    marginBottom: 3,
  },
  engineBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 10,
  },
  stateTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    textAlign: 'center',
  },
  stateText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  messageList: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 12,
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageBubble: {
    maxWidth: '79%',
    borderRadius: 18,
    borderBottomLeftRadius: 5,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  messageText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 18,
    paddingBottom: 4,
  },
  typingBubble: {
    height: 38,
    paddingHorizontal: 13,
    borderRadius: 18,
    borderBottomLeftRadius: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 99,
  },
  composerArea: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 11,
    paddingHorizontal: 16,
  },
  composer: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 19,
    paddingLeft: 15,
    paddingRight: 7,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 110,
    paddingTop: 9,
    paddingBottom: 7,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 21,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.96 }],
  },
  privacyNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    textAlign: 'center',
    letterSpacing: 0.25,
    paddingTop: 8,
  },
});