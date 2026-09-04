import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp, type ConversationTurn } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';

function TypingIndicator() {
  const { settings } = useApp();
  const colors = useColors(settings.appearance);

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
  const { settings, isSpeaking, speakText, stopSpeaking } = useApp();
  const colors = useColors(settings.appearance);
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
        {!isUser && item.content.length > 0 && (
          <Pressable
            testID={`speak-message-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={
              isSpeaking ? 'Stop spoken response' : 'Speak this response locally'
            }
            onPress={() =>
              isSpeaking ? void stopSpeaking() : void speakText(item.content)
            }
            style={({ pressed }) => [
              styles.speakMessageButton,
              pressed && styles.pressed,
            ]}
          >
            <Feather
              name={isSpeaking ? 'square' : 'volume-2'}
              size={13}
              color={colors.mutedForeground}
            />
            <Text
              style={[
                styles.speakMessageText,
                { color: colors.mutedForeground },
              ]}
            >
              {isSpeaking ? 'Stop' : 'Speak'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function SecondBrainScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const {
    settings,
    turns,
    isConversationReady,
    isThinking,
    storageError,
    localModel,
    engineStatus,
    engineProgress,
    engineError,
    voiceInputStatus,
    voiceTranscript,
    voiceError,
    isSpeaking,
    startVoiceInput,
    stopVoiceInput,
    cancelVoiceInput,
    clearVoiceTranscript,
    stopSpeaking,
    dismissVoiceError,
    sendMessage,
  } = useApp();
  const colors = useColors(settings.appearance);
  const [draft, setDraft] = useState('');
  const isCompact = width < 370;
  const isShort = height < 720;
  const isListening = voiceInputStatus === 'listening';
  const isProcessingVoice =
    voiceInputStatus === 'checking' || voiceInputStatus === 'processing';

  const visibleTurns = useMemo(() => [...turns].reverse(), [turns]);
  const canSend =
    draft.trim().length > 0 &&
    !isThinking &&
    isConversationReady &&
    engineStatus === 'ready';
  const engineLabel =
    engineStatus === 'ready'
      ? 'LOCAL'
      : engineStatus === 'loading'
        ? `${Math.round(engineProgress)}%`
        : 'SETUP';

  useEffect(() => {
    if (!voiceTranscript) return;
    setDraft(voiceTranscript);
    clearVoiceTranscript();
  }, [clearVoiceTranscript, voiceTranscript]);

  async function handleSend() {
    if (!canSend) return;
    const message = draft.trim();
    setDraft('');
    await sendMessage(message);
  }

  function handleVoiceInput() {
    if (isListening || isProcessingVoice) {
      stopVoiceInput();
      return;
    }
    void startVoiceInput();
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={0}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <SafeAreaView
        edges={['top']}
        style={[
          styles.headerSafe,
          {
            backgroundColor: colors.background,
            paddingTop: Platform.OS === 'web' ? 67 : 0,
          },
        ]}
      >
        <View
          style={[
            styles.header,
            isCompact && styles.headerCompact,
          ]}
        >
          <View style={styles.brandLockup}>
            <Image
              source={require('../assets/images/icon.png')}
              style={[styles.brandMark, isCompact && styles.brandMarkCompact]}
            />
            <View>
              <Text style={[styles.wordmark, { color: colors.foreground }]}>
                second brain
              </Text>
              {!isCompact && (
                <Text
                  style={[
                    styles.headerSubline,
                    { color: colors.mutedForeground },
                  ]}
                >
                  your private thinking space
                </Text>
              )}
            </View>
          </View>
          <View style={styles.headerActions}>
            {!isCompact && (
              <View
                style={[styles.statusPill, { backgroundColor: colors.accent }]}
              >
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: colors.accentForeground },
                  ]}
                />
                <Text
                  style={[styles.statusText, { color: colors.accentForeground }]}
                >
                  {engineLabel}
                </Text>
              </View>
            )}
            <Pressable
              testID="open-calendar"
              accessibilityRole="button"
              accessibilityLabel="Open important dates"
              onPress={() => router.push('/calendar')}
              style={({ pressed }) => [
                styles.settingsButton,
                { backgroundColor: colors.secondary },
                pressed && styles.pressed,
              ]}
            >
              <Feather name="calendar" size={17} color={colors.foreground} />
            </Pressable>
            <Pressable
              testID="open-settings"
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [
                styles.settingsButton,
                { backgroundColor: colors.secondary },
                pressed && styles.pressed,
              ]}
            >
              <Feather name="sliders" size={17} color={colors.foreground} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <View style={styles.content}>
        {!isConversationReady ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
              Opening your private space…
            </Text>
          </View>
        ) : turns.length === 0 ? (
          <ScrollView
            style={styles.emptyScroll}
            contentContainerStyle={[
              styles.emptyState,
              isCompact && styles.emptyStateCompact,
              isShort && styles.emptyStateShort,
            ]}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
              <Feather name="sun" size={25} color={colors.primary} />
            </View>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>
              GOOD TO HAVE YOU HERE
            </Text>
            <Text
              style={[
                styles.heroTitle,
                isCompact && styles.heroTitleCompact,
                { color: colors.foreground },
              ]}
            >
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
                <Text
                  numberOfLines={2}
                  ellipsizeMode="tail"
                  style={[
                    styles.engineTitle,
                    styles.engineName,
                    { color: colors.cardForeground },
                  ]}
                >
                  {engineStatus === 'ready'
                    ? localModel?.name ?? 'On-device model'
                    : 'Offline model setup needed'}
                </Text>
                <Text
                  style={[styles.engineBody, { color: colors.mutedForeground }]}
                >
                  {engineStatus === 'loading'
                    ? `Loading locally · ${Math.round(engineProgress)}%`
                    : engineStatus === 'ready'
                      ? 'Private by default · no network needed'
                      : 'Choose a compatible GGUF model in Settings'}
                </Text>
              </View>
              <Feather
                name={engineStatus === 'ready' ? 'check' : 'chevron-right'}
                size={18}
                color={colors.accentForeground}
              />
            </View>
          </ScrollView>
        ) : (
          <FlatList
            data={visibleTurns}
            inverted
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <MessageBubble item={item} />}
            contentContainerStyle={styles.messageList}
            contentInsetAdjustmentBehavior="never"
            showsVerticalScrollIndicator={false}
            scrollEnabled={visibleTurns.length > 0}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={isThinking ? <TypingIndicator /> : null}
          />
        )}
      </View>

      <SafeAreaView
        edges={['bottom']}
        style={[
          styles.composerSafe,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: Platform.OS === 'web' ? 34 : 0,
          },
        ]}
      >
        {storageError && (
          <View
            style={[
              styles.storageNotice,
              { backgroundColor: colors.secondary },
            ]}
          >
            <Feather
              name="alert-circle"
              size={14}
              color={colors.primary}
            />
            <Text
              style={[styles.storageNoticeText, { color: colors.foreground }]}
            >
              {storageError}
            </Text>
          </View>
        )}
        {engineStatus !== 'ready' && (
          <Pressable
            testID="open-model-setup"
            accessibilityRole="button"
            accessibilityLabel="Open offline model setup"
            onPress={() => router.push('/settings')}
            style={({ pressed }) => [
              styles.engineNotice,
              { backgroundColor: colors.secondary },
              pressed && styles.pressed,
            ]}
          >
            <Feather
              name={engineStatus === 'error' ? 'alert-circle' : 'cpu'}
              size={14}
              color={engineStatus === 'error' ? colors.destructive : colors.primary}
            />
            <Text style={[styles.engineNoticeText, { color: colors.foreground }]}>
              {engineStatus === 'loading'
                ? `Loading ${localModel?.name ?? 'model'} · ${Math.round(engineProgress)}%`
                : engineError ?? 'Choose a GGUF model before starting a conversation.'}
            </Text>
            <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
          </Pressable>
        )}
        {(isListening || isProcessingVoice) && (
          <View
            testID="voice-listening-status"
            style={[styles.voiceNotice, { backgroundColor: colors.accent }]}
          >
            <View style={[styles.voicePulse, { backgroundColor: colors.primary }]} />
            <Text
              style={[
                styles.voiceNoticeText,
                { color: colors.accentForeground },
              ]}
            >
              {isListening
                ? 'Listening on this device…'
                : 'Finishing your transcript…'}
            </Text>
            <Pressable
              testID="cancel-voice-input"
              accessibilityRole="button"
              accessibilityLabel="Cancel voice input"
              onPress={cancelVoiceInput}
              hitSlop={10}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Feather name="x" size={17} color={colors.accentForeground} />
            </Pressable>
          </View>
        )}
        {isSpeaking && (
          <View
            testID="voice-speaking-status"
            style={[styles.voiceNotice, { backgroundColor: colors.secondary }]}
          >
            <Feather name="volume-2" size={14} color={colors.primary} />
            <Text
              style={[styles.voiceNoticeText, { color: colors.foreground }]}
            >
              Speaking locally
            </Text>
            <Pressable
              testID="stop-speaking"
              accessibilityRole="button"
              accessibilityLabel="Stop spoken response"
              onPress={() => void stopSpeaking()}
              hitSlop={10}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Feather name="square" size={14} color={colors.primary} />
            </Pressable>
          </View>
        )}
        {voiceError && !isListening && (
          <View
            testID="voice-error"
            style={[styles.voiceNotice, { backgroundColor: colors.secondary }]}
          >
            <Feather name="alert-circle" size={14} color={colors.destructive} />
            <Text
              style={[styles.voiceNoticeText, { color: colors.foreground }]}
            >
              {voiceError}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss voice message"
              onPress={dismissVoiceError}
              hitSlop={10}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )}
        <View
          style={[
            styles.composer,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Pressable
            testID="voice-input"
            accessibilityRole="button"
            accessibilityLabel={
              isListening ? 'Finish voice input' : 'Start offline voice input'
            }
            accessibilityState={{ disabled: !settings.voiceInputEnabled }}
            onPress={handleVoiceInput}
            disabled={!settings.voiceInputEnabled || isThinking}
            style={({ pressed }) => [
              styles.voiceButton,
              {
                backgroundColor: isListening
                  ? colors.destructive
                  : colors.secondary,
              },
              (!settings.voiceInputEnabled || isThinking) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {isProcessingVoice ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather
                name={isListening ? 'square' : 'mic'}
                size={17}
                color={
                  isListening
                    ? colors.destructiveForeground
                    : colors.primary
                }
              />
            )}
          </Pressable>
          <TextInput
            testID="chat-input"
            value={draft}
            onChangeText={setDraft}
            placeholder="What’s on your mind?"
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={1200}
            editable={isConversationReady && engineStatus === 'ready'}
            style={[styles.input, { color: colors.cardForeground }]}
            onSubmitEditing={Platform.OS === 'web' ? handleSend : undefined}
            blurOnSubmit={false}
          />
          <Pressable
            testID="send-message"
            accessibilityRole="button"
            accessibilityLabel="Send message"
            onPress={handleSend}
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
          {settings.saveConversations
            ? 'stored locally on this device'
            : 'session only · not saving new messages'}
        </Text>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerSafe: { width: '100%' },
  header: {
    minHeight: 72,
    paddingHorizontal: 22,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCompact: { paddingHorizontal: 14 },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: { width: 32, height: 32, borderRadius: 10 },
  brandMarkCompact: { width: 29, height: 29, borderRadius: 9 },
  wordmark: {
    fontFamily: 'Rubik_600SemiBold',
    fontSize: 16,
    letterSpacing: -0.4,
  },
  headerSubline: {
    fontFamily: 'Rubik_400Regular',
    fontSize: 10,
    letterSpacing: 0.4,
    marginTop: 2,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusPill: {
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: { width: 5, height: 5, borderRadius: 99 },
  statusText: {
    fontFamily: 'Rubik_700Bold',
    fontSize: 9,
    letterSpacing: 1,
  },
  settingsButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1 },
  emptyScroll: { flex: 1 },
  emptyState: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 18,
  },
  emptyStateCompact: { paddingHorizontal: 20 },
  emptyStateShort: { paddingBottom: 16 },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  eyebrow: {
    fontFamily: 'Rubik_700Bold',
    fontSize: 10,
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  heroTitle: {
    fontFamily: 'Rubik_600SemiBold',
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: -1.5,
    marginBottom: 15,
  },
  heroTitleCompact: { fontSize: 34, lineHeight: 38 },
  heroBody: {
    fontFamily: 'Rubik_400Regular',
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
  engineCopy: { flex: 1 },
  engineTitle: {
    fontFamily: 'Rubik_600SemiBold',
    fontSize: 13,
    marginBottom: 3,
  },
  engineName: { flexShrink: 1 },
  engineBody: { fontFamily: 'Rubik_400Regular', fontSize: 11 },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 10,
  },
  stateText: {
    fontFamily: 'Rubik_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  messageList: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18 },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 12,
  },
  messageRowUser: { justifyContent: 'flex-end' },
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
    fontFamily: 'Rubik_400Regular',
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
  speakMessageButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    paddingVertical: 2,
  },
  speakMessageText: {
    fontFamily: 'Rubik_500Medium',
    fontSize: 10,
  },
  dot: { width: 5, height: 5, borderRadius: 99 },
  composerSafe: { borderTopWidth: StyleSheet.hairlineWidth },
  storageNotice: {
    minHeight: 34,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  storageNoticeText: {
    flex: 1,
    fontFamily: 'Rubik_400Regular',
    fontSize: 11,
    lineHeight: 15,
  },
  engineNotice: {
    minHeight: 38,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  engineNoticeText: {
    flex: 1,
    fontFamily: 'Rubik_400Regular',
    fontSize: 11,
    lineHeight: 15,
  },
  composer: {
    minHeight: 52,
    marginTop: 11,
    marginHorizontal: 16,
    borderWidth: 1,
    borderRadius: 19,
    paddingLeft: 7,
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
    fontFamily: 'Rubik_400Regular',
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
  voiceButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  voiceNotice: {
    minHeight: 38,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  voicePulse: { width: 7, height: 7, borderRadius: 99 },
  voiceNoticeText: {
    flex: 1,
    fontFamily: 'Rubik_400Regular',
    fontSize: 11,
    lineHeight: 15,
  },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.96 }] },
  privacyNote: {
    fontFamily: 'Rubik_400Regular',
    fontSize: 10,
    textAlign: 'center',
    letterSpacing: 0.25,
    paddingTop: 8,
    paddingBottom: 8,
  },
});