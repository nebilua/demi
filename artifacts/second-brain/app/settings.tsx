import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { PersonalProfileEditor } from '@/components/PersonalProfileEditor';
import { useApp, type Appearance } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';
import { formatBytes, RECOMMENDED_MODEL } from '@/lib/offlineLlm';

const appearanceOptions: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function SectionLabel({ children }: { children: string }) {
  const { settings } = useApp();
  const colors = useColors(settings.appearance);

  return (
    <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
      {children}
    </Text>
  );
}

function SettingRow({
  icon,
  title,
  description,
  children,
  noBorder,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
  children: React.ReactNode;
  noBorder?: boolean;
}) {
  const { settings } = useApp();
  const colors = useColors(settings.appearance);

  return (
    <View style={[styles.settingRow, !noBorder && { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
      <View style={[styles.rowIcon, { backgroundColor: colors.secondary }]}>
        <Feather name={icon} size={17} color={colors.primary} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
          {title}
        </Text>
        <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
          {description}
        </Text>
      </View>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const {
    settings,
    settingsReady,
    updateSettings,
    profile,
    memories,
    storageProtection,
    clearConversation,
    localModel,
    deviceCompatibility,
    engineStatus,
    engineError,
    modelSetupStatus,
    voiceInputAvailable,
    voiceOutputAvailable,
    offlineVoices,
    offlineVoicesLoading,
    refreshOfflineVoices,
    voiceError,
    voiceSetupInProgress,
    importModel,
    downloadRecommendedModel,
    cancelDownload,
    downloadStatus,
    downloadProgress,
    downloadError,
    removeModel,
    installOfflineVoiceModel,
    openVoiceSettings,
    dismissVoiceError,
  } = useApp();
  const colors = useColors(settings.appearance);
  const insets = useSafeAreaInsets();

  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);

  const androidApiLevel = Platform.OS === 'android' && typeof Platform.Version === 'number' ? Platform.Version : null;
  const requiresNewerAndroid = androidApiLevel !== null && androidApiLevel < 33;
  const canSetupSpeech = !voiceInputAvailable && !requiresNewerAndroid && !voiceSetupInProgress;
  const canSetupSpokenReplies = !voiceOutputAvailable;
  const englishOfflineVoices = offlineVoices.filter(
    (voice) => voice.language.toLowerCase().split('-')[0] === 'en',
  );
  const selectedVoiceIsInstalled = englishOfflineVoices.some(
    (voice) => voice.id === settings.preferredVoiceId,
  );

  async function handleClearHistory() {
    setIsClearing(true);
    await clearConversation();
    setIsClearing(false);
    setShowClearConfirm(false);
  }

  if (!settingsReady) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: colors.background }]}>
        <StatusBar style={colors.isDark ? 'light' : 'dark'} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, { backgroundColor: colors.secondary }, pressed && styles.pressed]}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(28, insets.bottom + 28) }]} showsVerticalScrollIndicator={false}>
        <SectionLabel>Personal context</SectionLabel>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.profileSummary}>
            <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
              <Feather name="user" size={17} color={colors.primary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
                {profile.displayName ? profile.displayName : 'No profile'}
              </Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Personal context for offline replies
              </Text>
            </View>
            <Pressable onPress={() => setShowProfileEditor(true)} style={({ pressed }) => [styles.smallButton, { backgroundColor: colors.secondary }, pressed && styles.pressed]}>
              <Text style={[styles.smallButtonText, { color: colors.secondaryForeground }]}>Edit</Text>
            </Pressable>
          </View>
        </View>

        <Pressable onPress={() => router.push('/memories' as any)} style={({ pressed }) => [styles.linkCard, { backgroundColor: colors.card, borderColor: colors.border }, pressed && styles.pressed]}>
          <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
            <Feather name="bookmark" size={17} color={colors.accentForeground} />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>Memory vault</Text>
            <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>{memories.length} saved</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>

        <SectionLabel>Offline setup</SectionLabel>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.readinessItem}>
            <View style={styles.readinessHeader}>
              <Feather name="cpu" size={16} color={localModel ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.readinessTitle, { color: colors.cardForeground }]}>
                1. Local model
              </Text>
              {localModel && <Feather name="check-circle" size={14} color={colors.primary} />}
            </View>

            {!localModel && (downloadStatus === 'idle' || downloadStatus === 'error') && (
              <View style={[styles.downloadBox, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.downloadTitle, { color: colors.cardForeground }]}>{RECOMMENDED_MODEL.name}</Text>
                <Text style={[styles.downloadMeta, { color: colors.mutedForeground }]}>
                  {formatBytes(RECOMMENDED_MODEL.sizeBytes)} · {RECOMMENDED_MODEL.license} · {RECOMMENDED_MODEL.source}
                </Text>
                <View style={styles.downloadActions}>
                  <Pressable testID="download-recommended" accessibilityRole="button" onPress={downloadRecommendedModel} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
                    <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                      {downloadStatus === 'error' ? 'Retry download' : 'Download model'}
                    </Text>
                  </Pressable>
                  <Pressable testID="import-model-manual" accessibilityRole="button" onPress={importModel} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border }, pressed && styles.pressed]}>
                    <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Import GGUF</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {downloadStatus === 'downloading' && (
              <View style={[styles.downloadBox, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.downloadTitle, { color: colors.cardForeground }]}>Downloading...</Text>
                <View style={[styles.progressBar, { backgroundColor: colors.secondary }]}>
                  <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${downloadProgress}%` }]} />
                </View>
                <Pressable testID="cancel-download" accessibilityRole="button" onPress={cancelDownload} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border, marginTop: 12 }, pressed && styles.pressed]}>
                  <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Cancel</Text>
                </Pressable>
              </View>
            )}

            {(downloadStatus === 'validating' || downloadStatus === 'loading' || modelSetupStatus === 'copying' || modelSetupStatus === 'loading' || modelSetupStatus === 'validating') && (
              <View style={[styles.downloadBox, { backgroundColor: colors.secondary }]}>
                <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start' }} />
                <Text style={[styles.downloadMeta, { color: colors.mutedForeground, marginTop: 8 }]}>
                  {downloadStatus === 'validating' ? 'Validating checksum...' : 'Loading local model...'}
                </Text>
              </View>
            )}

            {localModel && (
              <View style={[styles.downloadBox, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.downloadTitle, { color: colors.cardForeground }]}>{localModel.name}</Text>
                <Text style={[styles.downloadMeta, { color: colors.mutedForeground }]}>{formatBytes(localModel.sizeBytes)} · Active</Text>
                <Pressable onPress={removeModel} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border, marginTop: 12 }, pressed && styles.pressed]}>
                  <Text style={[styles.secondaryButtonText, { color: colors.destructive }]}>Remove</Text>
                </Pressable>
              </View>
            )}

            {(downloadError || engineError) && (
              <Text style={[styles.errorText, { color: colors.destructive, marginTop: 8 }]}>
                {downloadError || engineError}
              </Text>
            )}
          </View>
        </View>

        <SectionLabel>Local voice</SectionLabel>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

          <Pressable
            testID="offline-speech-setup"
            accessibilityRole={canSetupSpeech ? 'button' : undefined}
            accessibilityLabel="Set up offline speech input"
            disabled={!canSetupSpeech}
            onPress={() => void installOfflineVoiceModel()}
            style={({ pressed }) => [
              styles.readinessItem,
              canSetupSpeech && pressed && styles.pressedReadiness,
            ]}
          >
            <View style={styles.readinessHeader}>
              <Feather name="mic" size={16} color={voiceInputAvailable ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.readinessTitle, { color: colors.cardForeground }]}>
                2. Speech input
              </Text>
              {voiceInputAvailable && <Feather name="check-circle" size={14} color={colors.primary} />}
              {canSetupSpeech && <Feather name="chevron-right" size={16} color={colors.mutedForeground} />}
              {voiceSetupInProgress && <ActivityIndicator size="small" color={colors.primary} />}
            </View>
            <Text style={[styles.readinessDesc, { color: colors.mutedForeground }]}>
              {voiceInputAvailable ? 'Offline dictation ready.' : requiresNewerAndroid ? 'Requires Android 13+.' : 'Install English offline language pack.'}
            </Text>
          </Pressable>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <Pressable
            testID="offline-tts-setup"
            accessibilityRole={canSetupSpokenReplies ? 'button' : undefined}
            accessibilityLabel="Set up offline spoken replies"
            disabled={!canSetupSpokenReplies}
            onPress={() => void openVoiceSettings()}
            style={({ pressed }) => [
              styles.readinessItem,
              canSetupSpokenReplies && pressed && styles.pressedReadiness,
            ]}
          >
            <View style={styles.readinessHeader}>
              <Feather name="volume-2" size={16} color={voiceOutputAvailable ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.readinessTitle, { color: colors.cardForeground }]}>
                3. Spoken replies
              </Text>
              {voiceOutputAvailable && <Feather name="check-circle" size={14} color={colors.primary} />}
              {canSetupSpokenReplies && <Feather name="chevron-right" size={16} color={colors.mutedForeground} />}
            </View>
            <Text style={[styles.readinessDesc, { color: colors.mutedForeground }]}>
              {voiceOutputAvailable ? 'Offline TTS ready.' : 'Verify or install an offline TTS voice.'}
            </Text>
          </Pressable>

          <View style={[styles.voicePicker, { borderTopColor: colors.border }]}>
            <View style={styles.voicePickerHeader}>
              <View style={styles.rowCopy}>
                <Text style={[styles.readinessTitle, { color: colors.cardForeground }]}>
                  Preferred English voice
                </Text>
                <Text style={[styles.readinessDesc, { color: colors.mutedForeground }]}>
                  Automatic matching is used if the selected voice is unavailable.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh installed offline voices"
                onPress={() => void refreshOfflineVoices()}
                style={({ pressed }) => [
                  styles.refreshButton,
                  { backgroundColor: colors.secondary },
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="refresh-cw" size={15} color={colors.foreground} />
              </Pressable>
            </View>

            {offlineVoicesLoading ? (
              <View style={styles.voiceLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.voiceMeta, { color: colors.mutedForeground }]}>
                  Checking installed offline voices...
                </Text>
              </View>
            ) : englishOfflineVoices.length === 0 ? (
              <Text style={[styles.voiceMeta, { color: colors.mutedForeground }]}>
                No verified English offline voice is installed. Use Spoken replies above to open Android text-to-speech settings.
              </Text>
            ) : (
              <View style={styles.voiceOptions}>
                <Pressable
                  testID="voice-option-automatic"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: !selectedVoiceIsInstalled }}
                  onPress={() => void updateSettings({ preferredVoiceId: null })}
                  style={({ pressed }) => [
                    styles.voiceOption,
                    { borderColor: !selectedVoiceIsInstalled ? colors.primary : colors.border },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.voiceOptionCopy}>
                    <Text style={[styles.voiceOptionTitle, { color: colors.cardForeground }]}>
                      Automatic
                    </Text>
                    <Text style={[styles.voiceMeta, { color: colors.mutedForeground }]}>
                      Match the reply language
                    </Text>
                  </View>
                  {!selectedVoiceIsInstalled && <Feather name="check-circle" size={17} color={colors.primary} />}
                </Pressable>

                {englishOfflineVoices.map((voice) => {
                  const selected = settings.preferredVoiceId === voice.id;
                  return (
                    <Pressable
                      key={voice.id}
                      testID={`voice-option-${voice.id}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => void updateSettings({ preferredVoiceId: voice.id })}
                      style={({ pressed }) => [
                        styles.voiceOption,
                        { borderColor: selected ? colors.primary : colors.border },
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.voiceOptionCopy}>
                        <Text style={[styles.voiceOptionTitle, { color: colors.cardForeground }]}>
                          {voice.name}
                        </Text>
                        <Text style={[styles.voiceMeta, { color: colors.mutedForeground }]}>
                          {voice.language} · {voice.id}
                        </Text>
                      </View>
                      {selected && <Feather name="check-circle" size={17} color={colors.primary} />}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </View>

        <SectionLabel>Preferences</SectionLabel>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow icon="mic" title="Offline voice input" description="Use mic for dictation">
            <Switch value={settings.voiceInputEnabled} onValueChange={(v) => updateSettings({ voiceInputEnabled: v })} trackColor={{ false: colors.secondary, true: colors.accent }} thumbColor={settings.voiceInputEnabled ? colors.accentForeground : colors.mutedForeground} />
          </SettingRow>
          <SettingRow icon="volume-2" title="Spoken replies" description="Read new replies aloud">
            <Switch value={settings.spokenRepliesEnabled} onValueChange={(v) => updateSettings({ spokenRepliesEnabled: v })} trackColor={{ false: colors.secondary, true: colors.accent }} thumbColor={settings.spokenRepliesEnabled ? colors.accentForeground : colors.mutedForeground} />
          </SettingRow>
          <SettingRow icon="save" title="Save history" description="Keep conversations">
            <Switch value={settings.saveConversations} onValueChange={(v) => updateSettings({ saveConversations: v })} trackColor={{ false: colors.secondary, true: colors.accent }} thumbColor={settings.saveConversations ? colors.accentForeground : colors.mutedForeground} />
          </SettingRow>
          <SettingRow icon="smartphone" title="Haptic feedback" description="Light tap on send" noBorder>
            <Switch value={settings.hapticsEnabled} onValueChange={(v) => updateSettings({ hapticsEnabled: v })} trackColor={{ false: colors.secondary, true: colors.accent }} thumbColor={settings.hapticsEnabled ? colors.accentForeground : colors.mutedForeground} />
          </SettingRow>
        </View>

        <SectionLabel>Appearance</SectionLabel>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.segmented, { backgroundColor: colors.secondary }]}>
            {appearanceOptions.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => updateSettings({ appearance: option.value })}
                style={[styles.segment, settings.appearance === option.value && { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={[styles.segmentText, { color: settings.appearance === option.value ? colors.cardForeground : colors.mutedForeground }]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable onPress={() => setShowClearConfirm(true)} style={({ pressed }) => [styles.dangerCard, { backgroundColor: colors.card, borderColor: colors.destructive }, pressed && styles.pressed]}>
          <Feather name="trash-2" size={16} color={colors.destructive} />
          <Text style={[styles.dangerText, { color: colors.destructive }]}>Clear conversation history</Text>
        </Pressable>

      </ScrollView>

      <Modal visible={showClearConfirm} transparent animationType="fade" onRequestClose={() => setShowClearConfirm(false)}>
        <View style={[styles.modalBackdrop, { backgroundColor: colors.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.cardForeground }]}>Clear history?</Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>This removes all past messages. Memories and settings are kept.</Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setShowClearConfirm(false)} style={styles.modalButton}>
                <Text style={[styles.modalButtonText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleClearHistory} style={styles.modalButton}>
                <Text style={[styles.modalButtonText, { color: colors.destructive }]}>Clear</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <PersonalProfileEditor visible={showProfileEditor} mode="settings" onClose={() => setShowProfileEditor(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1 },
  header: { height: 60, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 18 },
  headerSpacer: { width: 36 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 12 },
  sectionLabel: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 1, marginBottom: 8, marginTop: 24, paddingLeft: 4 },
  card: { borderWidth: 1, borderRadius: 20, padding: 16 },
  profileSummary: { flexDirection: 'row', alignItems: 'center' },
  rowIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rowCopy: { flex: 1, justifyContent: 'center' },
  rowTitle: { fontFamily: 'Inter_500Medium', fontSize: 15, marginBottom: 2 },
  rowDescription: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  smallButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  smallButtonText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  linkCard: { marginTop: 12, borderWidth: 1, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center' },
  readinessItem: { paddingVertical: 8 },
  readinessHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  readinessTitle: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  readinessDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  pressedReadiness: { opacity: 0.7 },
  voicePicker: { borderTopWidth: 1, marginTop: 8, paddingTop: 16 },
  voicePickerHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  refreshButton: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  voiceLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  voiceOptions: { gap: 8, marginTop: 12 },
  voiceOption: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  voiceOptionCopy: { flex: 1 },
  voiceOptionTitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 2 },
  voiceMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  downloadBox: { marginTop: 12, padding: 12, borderRadius: 12 },
  downloadTitle: { fontFamily: 'Inter_500Medium', fontSize: 14, marginBottom: 4 },
  downloadMeta: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  downloadActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  primaryButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  secondaryButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  smallPrimaryButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, alignSelf: 'flex-start' },
  smallPrimaryButtonText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  progressBar: { height: 6, borderRadius: 3, marginTop: 12, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  divider: { height: 1, marginVertical: 8 },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  segmented: { flexDirection: 'row', borderRadius: 12, padding: 4 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: 'transparent' },
  segmentText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  dangerCard: { marginTop: 32, padding: 16, borderRadius: 20, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dangerText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 340, borderWidth: 1, borderRadius: 20, padding: 20 },
  modalTitle: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 18, marginBottom: 8 },
  modalBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginBottom: 24 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16 },
  modalButton: { padding: 8 },
  modalButtonText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  pressed: { opacity: 0.7 },
});
