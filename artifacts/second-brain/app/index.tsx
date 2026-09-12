import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { useApp, type ConversationTurn } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';

function MessageBubble({ item }: { item: ConversationTurn }) {
  const { settings } = useApp();
  const colors = useColors(settings.appearance);
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
}

export default function DemiScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const {
    settings,
    settingsReady,
    profile,
    turns,
    isConversationReady,
    isThinking,
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
    sendMessage,
    storageError,
    voiceError,
  } = useApp();
  const colors = useColors(settings.appearance);
  const [draft, setDraft] = useState('');
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [wasStopped, setWasStopped] = useState(false);
  const sendingVoiceRef = useRef(false);

  const isListening = voiceInputStatus === 'listening';
  const isProcessingVoice = voiceInputStatus === 'checking' || voiceInputStatus === 'processing';

  const visibleTurns = useMemo(() => [...turns].reverse(), [turns]);
  const canSend = draft.trim().length > 0 && !isThinking && isConversationReady && engineStatus === 'ready';

  useEffect(() => {
    if (!voiceTranscript) return;
    setDraft(voiceTranscript);
    clearVoiceTranscript();
  }, [clearVoiceTranscript, voiceTranscript]);

  async function handleSend() {
    if (!canSend) return;
    const message = draft.trim();
    setDraft('');
    setShowKeyboard(false);
    try {
      await sendMessage(message);
    } finally {
      sendingVoiceRef.current = false;
    }
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
      stopVoiceInput();
      return;
    }
    setWasStopped(false);
    void startVoiceInput();
  }

  useEffect(() => {
    if (voiceInputStatus === 'idle' && draft.trim().length > 0 && !isThinking && isConversationReady && engineStatus === 'ready' && !showKeyboard && !sendingVoiceRef.current) {
      sendingVoiceRef.current = true;
      void handleSend();
    }
  }, [voiceInputStatus, draft, isThinking, isConversationReady, engineStatus, showKeyboard]);

  const circleSize = Math.max(
    132,
    Math.min(190, width * 0.42, height * 0.21),
  );
  const centerStageHeight = circleSize + (setupNeeded ? 78 : 48);

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={0}
      style={[styles.screen, { backgroundColor: colors.background }]}
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
                renderItem={({ item }) => <MessageBubble item={item} />}
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
                  isSpeaking ? "Stop speaking" :
                  isThinking ? "Thinking" :
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

              <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
                {voiceError && !isListening ? 'Voice error' : isListening ? 'Listening' : isProcessingVoice ? 'Transcribing' : isThinking ? 'Thinking' : isSpeaking ? 'Speaking' : wasStopped ? 'Stopped' : draft ? 'Draft ready' : setupNeeded ? 'Setup needed' : 'Tap to speak'}
              </Text>

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
              onPress={() => setShowKeyboard(false)}
              style={({ pressed }) => [styles.closeKeyboardButton, pressed && styles.pressed]}
            >
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
            <TextInput
              testID="chat-input"
              value={draft}
              onChangeText={setDraft}
              placeholder="Type to Demi..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={1200}
              editable={isConversationReady && engineStatus === 'ready'}
              style={[styles.input, { color: colors.cardForeground }]}
              onSubmitEditing={Platform.OS === 'web' ? handleSend : undefined}
              blurOnSubmit={false}
              autoFocus
            />
            <Pressable
              accessibilityRole="button"
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
});
