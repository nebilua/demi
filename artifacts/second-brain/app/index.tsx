import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import Animated, {
  FadeInDown,
  FadeInUp,
  FadeOutDown,
  LinearTransition,
} from 'react-native-reanimated';
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
import { useTools } from '@/context/ToolContext';
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
        {item.localDocument ? (
          <>
            <Text
              testID="local-document-processed-label"
              style={[styles.localDocumentLabel, { color: colors.primary }]}
            >
              Processed on this device · {item.localDocument.documentName}
            </Text>
            <Text style={[styles.localDocumentHeading, { color: colors.mutedForeground }]}>
              Request
            </Text>
            <Text
              testID="local-document-instruction"
              style={[styles.messageText, { color: colors.cardForeground }]}
            >
              {item.localDocument.instruction}
            </Text>
            <Text style={[styles.localDocumentHeading, { color: colors.mutedForeground }]}>
              Local result
            </Text>
            <Text
              testID="local-document-result"
              selectable
              style={[styles.messageText, { color: colors.cardForeground }]}
            >
              {item.content}
            </Text>
          </>
        ) : (
          <Text
            style={[
              styles.messageText,
              { color: isUser ? colors.secondaryForeground : colors.cardForeground },
            ]}
          >
            {item.content}
          </Text>
        )}
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
    screenAttachment,
    discardScreenContext,
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
  const {
    selectedDocument,
    documentBusy,
    documentError,
    documentNotice,
    pickDocument,
    transformDocument,
    clearDocument,
  } = useTools();
  const colors = useColors(settings.appearance);
  const [draft, setDraft] = useState('');
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [showHomeTools, setShowHomeTools] = useState(false);
  const [documentRequestError, setDocumentRequestError] = useState<string | null>(null);
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
  const canUseSelectedDocument =
    privacyReady &&
    engineStatus === 'ready' &&
    isCapabilityActive(privacyState, 'local.files') &&
    isCapabilityActive(privacyState, 'local.inference');
  const canSend =
    draft.trim().length > 0 &&
    !isThinking &&
    !documentBusy &&
    isConversationReady &&
    (selectedDocument
      ? canUseSelectedDocument
      : engineStatus === 'ready' || cloudFallbackEnabled);

  useEffect(() => {
    if (!voiceTranscript) return;
    setDraft(voiceTranscript);
    setShowKeyboard(true);
    setWasStopped(false);
    clearVoiceTranscript();
  }, [clearVoiceTranscript, voiceTranscript]);

  useEffect(() => () => cancelVoiceInput(), []);

  useEffect(() => {
    if (pendingMemoryCandidate?.kind === 'memory') {
      setMemoryDraft(pendingMemoryCandidate.content);
      setMemorySaveError(null);
    }
  }, [pendingMemoryCandidate]);

  async function handleSend() {
    if (!canSend) return;
    if (selectedDocument && screenAttachment) {
      setDocumentRequestError(
        'A screen text share is also waiting for your next request. Remove or use one attachment at a time.',
      );
      return;
    }
    setDocumentRequestError(null);
    const message = draft.trim();
    setDraft('');
    setShowKeyboard(false);
    if (selectedDocument) {
      await transformDocument(message, true);
    } else {
      await sendMessage(message);
    }
  }

  // Setup text for the single prompt
  let setupNeeded = false;
  let setupLabel = '';
  let setupDescription = '';
  if (!settings.voiceInputEnabled || voiceInputStatus === 'unavailable') {
    setupNeeded = true;
    setupLabel = 'Voice setup required';
    setupDescription = 'Review offline voice controls and bundled speech setup.';
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
    void startVoiceInput();
  }

  const circleSize = Math.max(
    132,
    Math.min(190, width * 0.42, height * 0.21),
  );
  const centerStageHeight = circleSize + (setupNeeded ? 92 : 52);

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
              testID="open-calendar"
              accessibilityRole="button"
              accessibilityLabel="Open important dates"
              onPress={() => router.push('/calendar')}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Feather name="calendar" size={20} color={colors.foreground} />
            </Pressable>
            <Pressable
              testID="open-scheduled-work"
              accessibilityRole="button"
              accessibilityLabel="Open scheduled work"
              onPress={() => router.push('/scheduled' as never)}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Feather name="clock" size={20} color={colors.foreground} />
            </Pressable>
            <Pressable
              testID="open-settings"
              accessibilityRole="button"
              accessibilityLabel="Open settings"
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

            <View testID="home-voice-stage" style={[styles.centerStage, { height: centerStageHeight }]}>
              <Pressable
                testID="demi-voice-circle"
                accessibilityRole="button"
                accessibilityLabel={
                  isListening ? "Stop listening" :
                  isProcessingVoice ? "Cancel transcription" :
                  isSpeaking ? "Stop speaking" :
                  isThinking ? "Thinking" :
                  draft ? "Review dictation draft" :
                  setupNeeded ? engineStatus === 'ready' ? "Open settings for voice setup" : "Open Settings" : "Start voice input"
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

              {!(setupNeeded && engineStatus !== 'ready') && (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.statusText, { color: colors.mutedForeground }]}
                >
                  {isListening ? 'Listening' : isProcessingVoice ? 'Transcribing' : isThinking ? 'Thinking' : isSpeaking ? 'Speaking' : draft ? 'Draft ready — review before sending' : wasStopped ? 'Dictation canceled' : setupNeeded ? 'Setup needed' : 'Tap to speak'}
                </Text>
              )}
              {cloudFallbackActivity && (
                <Text style={[styles.setupText, { color: colors.mutedForeground }]}>
                  {cloudFallbackActivity.message}
                </Text>
              )}

              {setupNeeded && engineStatus === 'ready' && !isListening && !isThinking && (
                <Pressable
                  testID="home-setup-prompt"
                  accessibilityRole="button"
                  accessibilityLabel={`${setupLabel}. ${setupDescription}`}
                  accessibilityHint="Open Settings to complete setup."
                  onPress={() => router.push('/settings')}
                  style={({ pressed }) => [
                    styles.setupBadge,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.setupBadgeIcon,
                      { backgroundColor: colors.accent },
                    ]}
                  >
                    <Feather
                      name={engineStatus === 'ready' ? 'volume-2' : 'cpu'}
                      size={16}
                      color={colors.accentForeground}
                    />
                  </View>
                  <View style={styles.setupBadgeCopy}>
                    <Text
                      style={[
                        styles.setupBadgeTitle,
                        { color: colors.cardForeground },
                      ]}
                    >
                      {setupLabel}
                    </Text>
                    <Text
                      style={[
                        styles.setupBadgeDescription,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {setupDescription}
                    </Text>
                  </View>
                  <Feather
                    name="chevron-right"
                    size={17}
                    color={colors.mutedForeground}
                  />
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
        {voiceError && !isListening && (
          <Pressable accessibilityRole="button" accessibilityLabel="Open voice settings" onPress={() => router.push('/settings')}>
            <Text testID="home-voice-error" accessibilityLiveRegion="assertive" style={{ color: colors.destructive, fontSize: 13, lineHeight: 18, marginHorizontal: 20, marginVertical: 8 }}>
              {voiceError} Open Voice in Settings for setup or repair.
            </Text>
          </Pressable>
        )}
        {storageError && <Text accessibilityLiveRegion="assertive" style={[styles.setupText, { color: colors.destructive, marginHorizontal: 20 }]}>{storageError}</Text>}
        {selectedDocument && (
          <View
            testID="home-document-attachment"
            style={[styles.documentAttachment, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="file-text" size={17} color={colors.primary} />
            <View style={styles.documentAttachmentCopy}>
              <Text
                accessibilityLabel={`Attached document: ${selectedDocument.name}`}
                numberOfLines={1}
                style={[styles.documentAttachmentName, { color: colors.cardForeground }]}
              >
                {selectedDocument.name}
              </Text>
              <Text style={[styles.documentAttachmentMeta, { color: colors.mutedForeground }]}>
                Used only when you send · processed on this device
              </Text>
              {!canUseSelectedDocument && (
                <Text style={[styles.documentAttachmentMeta, { color: colors.destructive }]}>
                  Load the local model and enable local file access to use this document.
                </Text>
              )}
            </View>
            <Pressable
              testID="replace-home-document"
              accessibilityRole="button"
              accessibilityLabel="Replace attached document"
              onPress={() => void pickDocument()}
              style={({ pressed }) => [styles.composerIconButton, pressed && styles.pressed]}
            >
              <Feather name="refresh-cw" size={17} color={colors.mutedForeground} />
            </Pressable>
            <Pressable
              testID="remove-home-document"
              accessibilityRole="button"
              accessibilityLabel="Remove attached document"
              onPress={() => {
                clearDocument();
                setDocumentRequestError(null);
              }}
              style={({ pressed }) => [styles.composerIconButton, pressed && styles.pressed]}
            >
              <Feather name="x" size={19} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )}
        {documentNotice && (
          <Text testID="home-document-notice" accessibilityLiveRegion="polite" style={[styles.setupText, { color: colors.mutedForeground, marginHorizontal: 20, marginBottom: 8 }]}>
            {documentNotice}
          </Text>
        )}
        {documentError && (
          <Text testID="home-document-error" accessibilityLiveRegion="assertive" style={[styles.setupText, { color: colors.destructive, marginHorizontal: 20, marginBottom: 8 }]}>
            {documentError}
          </Text>
        )}
        {documentRequestError && (
          <Text testID="home-document-request-error" accessibilityLiveRegion="assertive" style={[styles.setupText, { color: colors.destructive, marginHorizontal: 20, marginBottom: 8 }]}>
            {documentRequestError}
          </Text>
        )}
        {documentBusy && (
          <View testID="home-document-progress" accessibilityLiveRegion="polite" style={styles.documentProgress}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.documentAttachmentMeta, { color: colors.mutedForeground }]}>
              Working on this document on your device…
            </Text>
          </View>
        )}
        {screenAttachment && (
          <View style={{ paddingHorizontal: 20, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable accessibilityRole="button" onPress={() => router.push('/screen-access')} style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontSize: 13 }}>Shared text · next request is local only</Text>
            </Pressable>
            <Pressable testID="discard-shared-screen" accessibilityRole="button" accessibilityLabel="Discard shared text" onPress={() => {
              discardScreenContext();
              setDocumentRequestError(null);
            }}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )}
        {showKeyboard ? (
          <Animated.View
            testID="chat-composer-container"
            entering={FadeInUp.duration(220)}
            exiting={FadeOutDown.duration(150)}
            layout={LinearTransition.duration(180)}
            style={[styles.composer, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close message composer"
              onPress={() => setShowKeyboard(false)}
              style={({ pressed }) => [styles.closeKeyboardButton, pressed && styles.pressed]}
            >
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
            <Pressable
              testID="attach-home-document"
              accessibilityRole="button"
              accessibilityLabel="Attach a local document"
              accessibilityHint="Opens Android’s system file picker. The selected document is only used when you send a request."
              onPress={() => void pickDocument()}
              style={({ pressed }) => [styles.composerIconButton, pressed && styles.pressed]}
            >
              <Feather name="paperclip" size={18} color={colors.mutedForeground} />
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
              editable={isConversationReady && (selectedDocument ? canUseSelectedDocument : engineStatus === 'ready' || cloudFallbackEnabled)}
              selectionColor={colors.primary}
              textAlignVertical="top"
              style={[styles.input, { color: colors.cardForeground }]}
              onSubmitEditing={Platform.OS === 'web' ? handleSend : undefined}
              blurOnSubmit={false}
              autoFocus
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={selectedDocument ? "Send request using attached document locally" : "Send message"}
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
          </Animated.View>
        ) : (
          <Animated.View
            testID="chat-composer-collapsed"
            entering={FadeInDown.duration(180)}
            exiting={FadeOutDown.duration(130)}
            layout={LinearTransition.duration(180)}
            style={styles.bottomBar}
          >
             <Pressable
              testID="keyboard-toggle"
              accessibilityRole="button"
              accessibilityLabel="Open message composer"
              onPress={() => setShowKeyboard(true)}
              style={({ pressed }) => [styles.keyboardToggle, pressed && styles.pressed]}
             >
               <Feather name="edit-2" size={20} color={colors.mutedForeground} />
             </Pressable>
             <Pressable
              testID="attach-home-document"
              accessibilityRole="button"
              accessibilityLabel="Attach a local document"
              accessibilityHint="Opens Android’s system file picker. The selected document is only used when you send a request."
              onPress={() => void pickDocument()}
              style={({ pressed }) => [styles.keyboardToggle, pressed && styles.pressed]}
             >
               <Feather name="paperclip" size={20} color={colors.mutedForeground} />
             </Pressable>
             <Pressable
              testID="open-home-tools"
              accessibilityRole="button"
              accessibilityLabel="Open Home tools"
              onPress={() => setShowHomeTools(true)}
              style={({ pressed }) => [styles.keyboardToggle, pressed && styles.pressed]}
             >
               <Feather name="grid" size={20} color={colors.mutedForeground} />
             </Pressable>
          </Animated.View>
        )}
      </SafeAreaView>
      <PersonalProfileEditor
        visible={settingsReady && !profile.onboardingCompleted}
        mode="onboarding"
      />
      <Modal
        visible={showHomeTools}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHomeTools(false)}
      >
        <View style={styles.toolsBackdrop}>
          <View style={[styles.toolsSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.toolsHeader}>
              <View style={styles.toolsHeaderCopy}>
                <Text style={[styles.toolsTitle, { color: colors.cardForeground }]}>Home tools</Text>
                <Text style={[styles.toolsDescription, { color: colors.mutedForeground }]}>
                  Choose only what you want Demi to use.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close Home tools"
                onPress={() => setShowHomeTools(false)}
                style={({ pressed }) => [styles.composerIconButton, pressed && styles.pressed]}
              >
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <Pressable
              testID="home-tools-choose-document"
              accessibilityRole="button"
              accessibilityLabel={selectedDocument ? "Replace attached local document" : "Choose a local document"}
              onPress={() => {
                setShowHomeTools(false);
                void pickDocument();
              }}
              style={({ pressed }) => [styles.toolMenuRow, { borderColor: colors.border }, pressed && styles.pressed]}
            >
              <Feather name="file-plus" size={19} color={colors.primary} />
              <View style={styles.toolsHeaderCopy}>
                <Text style={[styles.toolMenuTitle, { color: colors.cardForeground }]}>
                  {selectedDocument ? "Replace attached document" : "Choose a document"}
                </Text>
                <Text style={[styles.toolMenuDescription, { color: colors.mutedForeground }]}>
                  Text, Markdown, CSV, or JSON · read locally, only when sent
                </Text>
              </View>
              <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
            </Pressable>
            <Pressable
              testID="home-tools-screen-access"
              accessibilityRole="button"
              accessibilityLabel="Open permissioned screen access"
              accessibilityHint="Choose a capture source, review the extracted text, then explicitly share it with a local request."
              onPress={() => {
                setShowHomeTools(false);
                router.push('/screen-access');
              }}
              style={({ pressed }) => [styles.toolMenuRow, { borderColor: colors.border }, pressed && styles.pressed]}
            >
              <Feather name="eye" size={19} color={colors.primary} />
              <View style={styles.toolsHeaderCopy}>
                <Text style={[styles.toolMenuTitle, { color: colors.cardForeground }]}>Screen access</Text>
                <Text style={[styles.toolMenuDescription, { color: colors.mutedForeground }]}>
                  Permissioned capture, text review, and explicit sharing
                </Text>
              </View>
              <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
            </Pressable>
            <View style={[styles.advancedToolsBlock, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.advancedToolsTitle, { color: colors.cardForeground }]}>Advanced tools</Text>
              <Text style={[styles.toolMenuDescription, { color: colors.mutedForeground }]}>
                Optional bounded CSV/JSON calculations. Not JavaScript or shell, and not needed for ordinary chat.
              </Text>
              <Pressable
                testID="home-tools-sandbox"
                accessibilityRole="button"
                accessibilityLabel="Open advanced sandboxed code actions"
                accessibilityHint="Optional bounded CSV or JSON operations. Ordinary chat does not need this tool."
                onPress={() => {
                  setShowHomeTools(false);
                  router.push('/code-actions' as never);
                }}
                style={({ pressed }) => [styles.advancedToolLink, pressed && styles.pressed]}
              >
                <Feather name="code" size={17} color={colors.primary} />
                <Text style={[styles.toolMenuTitle, { color: colors.primary }]}>Sandboxed code actions</Text>
                <Feather name="chevron-right" size={17} color={colors.primary} />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  localDocumentLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 8,
  },
  localDocumentHeading: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
    marginBottom: 2,
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
    width: '88%',
    maxWidth: 340,
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    gap: 10,
    pointerEvents: 'auto',
  },
  setupBadgeIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupBadgeCopy: { flex: 1 },
  setupBadgeTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
  },
  setupBadgeDescription: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 1,
  },
  setupText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  composerSafe: { width: '100%' },
  composerIconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentAttachment: {
    minHeight: 58,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  documentAttachmentCopy: { flex: 1, minWidth: 0 },
  documentAttachmentName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    lineHeight: 17,
  },
  documentAttachmentMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  documentProgress: {
    marginHorizontal: 20,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bottomBar: {
    height: 60,
    flexDirection: 'row',
    gap: 8,
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
  toolsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    padding: 12,
  },
  toolsSheet: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    gap: 10,
  },
  toolsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  toolsHeaderCopy: { flex: 1 },
  toolsTitle: {
    fontFamily: 'SpaceGrotesk_600SemiBold',
    fontSize: 21,
  },
  toolsDescription: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  toolMenuRow: {
    minHeight: 64,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  toolMenuTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  toolMenuDescription: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  advancedToolsBlock: {
    borderRadius: 15,
    padding: 12,
    gap: 8,
    marginTop: 4,
  },
  advancedToolsTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  advancedToolLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
