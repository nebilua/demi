import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PersonalProfileEditor } from '@/components/PersonalProfileEditor';
import { useApp, useChat, type Appearance, type ConversationTurn } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';
import { isCapabilityActive } from '@/lib/privacyCapabilities';
import { recordRuntimeEvent } from '@/lib/runtimeDiagnostics';

const MessageBubble = React.memo(function MessageBubble({
  item,
  appearance,
}: {
  item: ConversationTurn;
  appearance: Appearance;
}) {
  const colors = useColors(appearance);
  const isUser = item.role === 'user';

  return (
    <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
      <View
        style={[
          styles.messageBubble,
          isUser
            ? { backgroundColor: colors.secondary }
            : { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
        ]}
      >
        <Text
          style={[
            styles.messageText,
            { color: isUser ? colors.secondaryForeground : colors.cardForeground },
          ]}
        >
          {item.content}
        </Text>
      </View>
    </View>
  );
}, (previous, next) =>
  previous.item === next.item && previous.appearance === next.appearance
);

export default function DemiScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const {
    settings,
    settingsReady,
    privacyReady,
    privacyState,
    profile,
    localModel,
    engineStatus,
    modelSetupStatus,
    voiceInputStatus,
    voiceTranscript,
    isSpeaking,
    startVoiceInput,
    stopVoiceInput,
    cancelVoiceInput,
    clearVoiceTranscript,
    stopSpeaking,
    storageError,
    cloudFallbackActivity,
    voiceError,
  } = useApp();
  const {
    turns,
    isConversationReady,
    isThinking,
    sendMessage,
    pendingMemoryCandidate,
    saveMemoryCandidate,
    rejectMemoryCandidate,
  } = useChat();
  const colors = useColors(settings.appearance);
  const [draft, setDraft] = useState('');
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [wasStopped, setWasStopped] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memorySaveError, setMemorySaveError] = useState<string | null>(null);
  const [isSavingMemory, setIsSavingMemory] = useState(false);

  const isListening = voiceInputStatus === 'listening';
  const isProcessingVoice = voiceInputStatus === 'checking' || voiceInputStatus === 'processing';

  recordRuntimeEvent('chat.render', { turnCount: turns.length });
  const visibleTurns = useMemo(() => [...turns].reverse(), [turns]);
  const cloudFallbackEnabled =
    privacyReady &&
    isCapabilityActive(privacyState, 'network.remote-inference');
  const canSend =
    draft.trim().length > 0 &&
    !isThinking &&
    isConversationReady &&
    (engineStatus === 'ready' || cloudFallbackEnabled);

  useEffect(() => {
    if (!voiceTranscript) return;
    setDraft(voiceTranscript);
    setShowKeyboard(true);
    setWasStopped(false);
    clearVoiceTranscript();
  }, [clearVoiceTranscript, voiceTranscript]);

  useEffect(() => {
    if (pendingMemoryCandidate?.kind === 'memory') {
      setMemoryDraft(pendingMemoryCandidate.content);
      setMemorySaveError(null);
    }
  }, [pendingMemoryCandidate]);

  async function handleSend() {
    if (!canSend) return;
    const message = draft.trim();
    setDraft('');
    setShowKeyboard(false);
    await sendMessage(message);
  }

  // Setup text for the single prompt
  let setupNeeded = false;
  let setupLabel = '';
  if (engineStatus !== 'ready') {
    setupNeeded = true;
    setupLabel = 'Model setup required';
  } else if (!settings.voiceInputEnabled || voiceInputStatus === 'needs-model' || voiceInputStatus === 'unavailable') {
    setupNeeded = true;
    setupLabel = 'Voice setup required';
  }

  function handleVoiceInput() {
    if (isSpeaking) {
      setWasStopped(true);
      void stopSpeaking();
      return;
    }
    if (isThinking) {
      Alert.alert('Thinking', 'Demi is currently generating a response and cannot be interrupted.');
      return;
    }
    if (setupNeeded) {
      router.push('/settings');
      return;
    }
    if (isListening || isProcessingVoice) {
      setWasStopped(true);
      if (isProcessingVoice) {
        cancelVoiceInput();
      } else {
        stopVoiceInput();
      }
      return;
    }
    setWasStopped(false);
    setDraft('');
    void startVoiceInput();
  }

  const circleSize = Math.max(
    132,
    Math.min(190, width * 0.42, height * 0.21),
  );
  const centerStageHeight = circleSize + (setupNeeded ? 78 : 48);

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={0}
      style={[
        styles.screen,
        { minHeight: height, minWidth: width, backgroundColor: colors.background },
      ]}
    >
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <SafeAreaView
        edges={['top']}
        style={[styles.headerSafe, { backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? 67 : 0 }]}
      >
        <View style={styles.header}>
          <Text style={[styles.wordmark, { color: colors.primary }]}>Demi</Text>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/calendar')}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Feather name="calendar" size={20} color={colors.foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open scheduled work"
              onPress={() => router.push('/scheduled' as never)}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Feather name="clock" size={20} color={colors.foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Feather name="settings" size={20} color={colors.foreground} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <View style={styles.content}>
        {!isConversationReady ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <View style={[styles.historyContainer, { paddingBottom: centerStageHeight }]}>
              <FlatList
                data={visibleTurns}
                inverted
                keyExtractor={(item) => item.id}
                 renderItem={({ item }) => (
                   <MessageBubble item={item} appearance={settings.appearance} />
                 )}
                contentContainerStyle={styles.messageList}
                showsVerticalScrollIndicator={false}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
              />
            </View>

            <View style={[styles.centerStage, { height: centerStageHeight }]}>
              <Pressable
                testID="demi-voice-circle"
                accessibilityRole="button"
                accessibilityLabel={
                  isListening ? "Stop listening" :
                  isProcessingVoice ? "Cancel transcription" :
                  isSpeaking ? "Stop speaking" :
                  isThinking ? "Thinking" :
                  draft ? "Review dictation draft" :
                  setupNeeded ? "Open settings for setup" : "Start voice input"
                }
                onPress={handleVoiceInput}
                style={({ pressed }) => [
                  styles.voiceCircle,
                  {
                    width: circleSize,
                    height: circleSize,
                    borderRadius: circleSize / 2,
                  },
                  { backgroundColor: isListening ? colors.destructive : colors.primary },
                  isThinking && { opacity: 0.6 },
                  pressed && styles.pressedCircle
                ]}
              >
                {isProcessingVoice || isThinking ? (
                  <ActivityIndicator size="large" color={colors.primaryForeground} />
                ) : (
                  <Feather
                    name={isListening || isSpeaking ? 'square' : setupNeeded ? 'settings' : 'mic'}
                    size={36}
                    color={colors.primaryForeground}
                  />
                )}
              </Pressable>

              <Text
                accessibilityLiveRegion="polite"
                style={[styles.statusText, { color: colors.mutedForeground }]}
              >
                {voiceError && !isListening ? 'Voice error' : isListening ? 'Listening' : isProcessingVoice ? 'Transcribing' : isThinking ? 'Thinking' : isSpeaking ? 'Speaking' : draft ? 'Draft ready — review before sending' : wasStopped ? 'Dictation canceled' : setupNeeded ? 'Setup needed' : 'Tap to speak'}
              </Text>
              {cloudFallbackActivity && (
                <Text style={[styles.setupText, { color: colors.mutedForeground }]}>
                  {cloudFallbackActivity.message}
                </Text>
              )}

              {setupNeeded && !isListening && !isThinking && (
                <Pressable
                  onPress={() => router.push('/settings')}
                  style={({ pressed }) => [styles.setupBadge, { backgroundColor: colors.accent }, pressed && styles.pressed]}
                >
                  <Text style={[styles.setupText, { color: colors.accentForeground }]}>{setupLabel}</Text>
                  <Feather name="chevron-right" size={14} color={colors.accentForeground} />
                </Pressable>
              )}
            </View>
          </>
        )}
      </View>

      <SafeAreaView
        edges={['bottom']}
        style={[styles.composerSafe, { backgroundColor: colors.background, paddingBottom: Platform.OS === 'web' ? 34 : 0 }]}
      >
        {showKeyboard ? (
          <View style={[styles.composer, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close message composer"
              onPress={() => setShowKeyboard(false)}
              style={({ pressed }) => [styles.closeKeyboardButton, pressed && styles.pressed]}
            >
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
            <TextInput
              testID="chat-input"
              accessibilityLabel="Message draft"
              value={draft}
              onChangeText={setDraft}
              placeholder="Type to Demi..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={1200}
              editable={isConversationReady && (engineStatus === 'ready' || cloudFallbackEnabled)}
              style={[styles.input, { color: colors.cardForeground }]}
              onSubmitEditing={Platform.OS === 'web' ? handleSend : undefined}
              blurOnSubmit={false}
              autoFocus
            />
            <Pressable
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
              <Feather
                name="arrow-up"
                size={18}
                color={canSend ? colors.primaryForeground : colors.mutedForeground}
              />
            </Pressable>
          </View>
        ) : (
          <View style={styles.bottomBar}>
             <Pressable
              testID="keyboard-toggle"
              accessibilityRole="button"
              accessibilityLabel="Open message composer"
              onPress={() => setShowKeyboard(true)}
              style={({ pressed }) => [styles.keyboardToggle, pressed && styles.pressed]}
             >
               <Feather name="edit-2" size={20} color={colors.mutedForeground} />
             </Pressable>
          </View>
        )}
      </SafeAreaView>
      <PersonalProfileEditor
        visible={settingsReady && !profile.onboardingCompleted}
        mode="onboarding"
      />
      <Modal
        visible={pendingMemoryCandidate !== null}
        transparent
        animationType="fade"
        onRequestClose={rejectMemoryCandidate}
      >
        <View style={styles.candidateBackdrop}>
          <View style={[styles.candidateCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.candidateEyebrow, { color: colors.primary }]}>
              {pendingMemoryCandidate?.kind === 'important-date'
                ? 'IMPORTANT DATE FOUND'
                : 'MEMORY SUGGESTION'}
            </Text>
            <Text style={[styles.candidateTitle, { color: colors.cardForeground }]}>
              {pendingMemoryCandidate?.kind === 'important-date'
                ? 'Keep this date close?'
                : 'Save this for future replies?'}
            </Text>
            {pendingMemoryCandidate?.kind === 'memory' ? (
              <>
                <TextInput
                  testID="memory-candidate-editor"
                  value={memoryDraft}
                  onChangeText={setMemoryDraft}
                  multiline
                  maxLength={240}
                  style={[
                    styles.candidateInput,
                    { color: colors.cardForeground, backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                />
                <Text style={[styles.candidateMeta, { color: colors.mutedForeground }]}>
                  {pendingMemoryCandidate.category.toUpperCase()} · From “{pendingMemoryCandidate.sourceExcerpt}”
                </Text>
                <View style={styles.candidateActions}>
                  <Pressable onPress={rejectMemoryCandidate} disabled={isSavingMemory}>
                    <Text style={[styles.candidateActionText, { color: colors.mutedForeground }]}>Not now</Text>
                  </Pressable>
                  <Pressable
                    testID="save-memory-candidate"
                    onPress={async () => {
                      setIsSavingMemory(true);
                      setMemorySaveError(null);
                      try {
                        await saveMemoryCandidate(memoryDraft);
                      } catch (error) {
                        setMemorySaveError(
                          error instanceof Error
                            ? error.message
                            : 'This memory could not be saved. Try again.',
                        );
                      } finally {
                        setIsSavingMemory(false);
                      }
                    }}
                    disabled={isSavingMemory || !memoryDraft.trim()}
                  >
                    <Text style={[styles.candidateActionText, { color: colors.primary }]}>
                      {isSavingMemory ? 'Saving…' : 'Save memory'}
                    </Text>
                  </Pressable>
                </View>
                {memorySaveError && (
                  <Text style={[styles.candidateError, { color: colors.destructive }]}>
                    {memorySaveError}
                  </Text>
                )}
              </>
            ) : pendingMemoryCandidate?.kind === 'important-date' ? (
              <>
                <Text style={[styles.candidateDate, { color: colors.cardForeground }]}>
                  {pendingMemoryCandidate.eventName} · {pendingMemoryCandidate.label}
                </Text>
                <Text style={[styles.candidateMeta, { color: colors.mutedForeground }]}>
                  {pendingMemoryCandidate.date}
                  {pendingMemoryCandidate.time ? ` · ${pendingMemoryCandidate.time}` : ''}
                  {pendingMemoryCandidate.notes ? ` · ${pendingMemoryCandidate.notes}` : ''}
                </Text>
                <Text style={[styles.candidateSource, { color: colors.mutedForeground }]}>
                  From “{pendingMemoryCandidate.sourceExcerpt}”. Nothing is saved until you confirm it in the calendar editor.
                </Text>
                <View style={styles.candidateActions}>
                  <Pressable onPress={rejectMemoryCandidate}>
                    <Text style={[styles.candidateActionText, { color: colors.mutedForeground }]}>Dismiss</Text>
                  </Pressable>
                  <Pressable
                    testID="review-date-candidate"
                    onPress={() => {
                      const candidate = pendingMemoryCandidate;
                      rejectMemoryCandidate();
                      router.push({
                        pathname: '/calendar/edit',
                        params: {
                          label: candidate.label,
                          eventName: candidate.eventName,
                          date: candidate.date,
                          time: candidate.time ?? '',
                          notes: candidate.notes,
                        },
                      });
                    }}
                  >
                    <Text style={[styles.candidateActionText, { color: colors.primary }]}>Review date</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerSafe: { width: '100%', zIndex: 10 },
  header: {
    height: 60,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordmark: {
    fontFamily: 'SpaceGrotesk_600SemiBold',
    fontSize: 22,
    letterSpacing: -0.5,
  },
  headerActions: { flexDirection: 'row', gap: 16 },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1, position: 'relative' },
  historyContainer: {
    flex: 1,
  },
  messageList: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  messageRowUser: { justifyContent: 'flex-end' },
  messageBubble: {
    maxWidth: '85%',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  messageText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
  },
  centerStage: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'box-none',
  },
  voiceCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    pointerEvents: 'auto',
  },
  statusText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    marginTop: 20,
    letterSpacing: 0.3,
  },
  setupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 12,
    gap: 6,
    pointerEvents: 'auto',
  },
  setupText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  composerSafe: { width: '100%' },
  bottomBar: {
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardToggle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    minHeight: 60,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 24,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  closeKeyboardButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    paddingTop: 8,
    paddingBottom: 8,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 21,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.7 },
  pressedCircle: { transform: [{ scale: 0.94 }] },
  candidateBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  candidateCard: {
    width: '100%',
    maxWidth: 440,
    borderWidth: 1,
    borderRadius: 22,
    padding: 20,
  },
  candidateEyebrow: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.1 },
  candidateTitle: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 22, marginTop: 8 },
  candidateInput: { minHeight: 72, borderWidth: 1, borderRadius: 12, padding: 11, marginTop: 16, fontFamily: 'Inter_400Regular', fontSize: 14 },
  candidateDate: { fontFamily: 'Inter_500Medium', fontSize: 15, marginTop: 16 },
  candidateMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 9 },
  candidateError: { fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16, marginTop: 10 },
  candidateSource: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginTop: 14 },
  candidateActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginTop: 20 },
  candidateActionText: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 13, padding: 5 },
});
