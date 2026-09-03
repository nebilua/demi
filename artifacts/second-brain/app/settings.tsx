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
} from 'react-native-safe-area-context';
import { useApp, type Appearance } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';

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
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const { settings } = useApp();
  const colors = useColors(settings.appearance);

  return (
    <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
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
    savedTurnCount,
    clearConversation,
  } = useApp();
  const colors = useColors(settings.appearance);
  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
          paddingTop: Platform.OS === 'web' ? 67 : 0,
          paddingBottom: Platform.OS === 'web' ? 34 : 0,
        },
      ]}
    >
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable
          testID="settings-back"
          accessibilityRole="button"
          accessibilityLabel="Back to chat"
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: colors.secondary },
            pressed && styles.pressed,
          ]}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerTitleGroup}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Settings
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
            shape your private space
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            YOUR CONTROL CENTER
          </Text>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>
            Make it yours.
          </Text>
          <Text style={[styles.pageDescription, { color: colors.mutedForeground }]}>
            Everything here stays on this device. No account or cloud connection
            is required.
          </Text>
        </View>

        <SectionLabel>APPEARANCE</SectionLabel>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.cardHeading}>
            <View style={[styles.rowIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="sun" size={17} color={colors.primary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
                Theme
              </Text>
              <Text
                style={[styles.rowDescription, { color: colors.mutedForeground }]}
              >
                Choose how Second Brain looks
              </Text>
            </View>
          </View>
          <View style={[styles.segmented, { backgroundColor: colors.secondary }]}>
            {appearanceOptions.map((option) => {
              const selected = settings.appearance === option.value;
              return (
                <Pressable
                  key={option.value}
                  testID={`appearance-${option.value}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => updateSettings({ appearance: option.value })}
                  style={[
                    styles.segment,
                    selected && {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      {
                        color: selected
                          ? colors.cardForeground
                          : colors.mutedForeground,
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <SectionLabel>CONVERSATION</SectionLabel>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <SettingRow
            icon="save"
            title="Save conversations"
            description={
              settings.saveConversations
                ? 'New messages are saved on this device'
                : 'New messages disappear when this session ends'
            }
          >
            <Switch
              testID="save-conversations"
              value={settings.saveConversations}
              onValueChange={(value) =>
                updateSettings({ saveConversations: value })
              }
              trackColor={{ false: colors.secondary, true: colors.accent }}
              thumbColor={
                settings.saveConversations
                  ? colors.accentForeground
                  : colors.mutedForeground
              }
              ios_backgroundColor={colors.secondary}
            />
          </SettingRow>
          <SettingRow
            icon="volume-2"
            title="Haptic feedback"
            description="A light tap confirms your messages"
          >
            <Switch
              testID="haptics"
              value={settings.hapticsEnabled}
              onValueChange={(value) =>
                updateSettings({ hapticsEnabled: value })
              }
              trackColor={{ false: colors.secondary, true: colors.accent }}
              thumbColor={
                settings.hapticsEnabled
                  ? colors.accentForeground
                  : colors.mutedForeground
              }
              ios_backgroundColor={colors.secondary}
            />
          </SettingRow>
        </View>

        <SectionLabel>LOCAL ENGINE</SectionLabel>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.engineRow}>
            <View style={[styles.engineIcon, { backgroundColor: colors.accent }]}>
              <Feather name="cpu" size={19} color={colors.primary} />
            </View>
            <View style={styles.rowCopy}>
              <View style={styles.engineTitleLine}>
                <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
                  On-device preview engine
                </Text>
                <View style={[styles.availablePill, { backgroundColor: colors.accent }]}>
                  <Text
                    style={[
                      styles.availableText,
                      { color: colors.accentForeground },
                    ]}
                  >
                    ACTIVE
                  </Text>
                </View>
              </View>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Runs locally without network access
              </Text>
            </View>
          </View>
          <View style={[styles.infoRow, { backgroundColor: colors.secondary }]}>
            <Feather name="info" size={14} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              The Expo preview uses a lightweight local adapter. Native GGUF
              model loading will be added for the Android build.
            </Text>
          </View>
        </View>

        <SectionLabel>LOCAL DATA</SectionLabel>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.storageSummary}>
            <View style={[styles.rowIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="database" size={17} color={colors.primary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
                Saved conversation
              </Text>
              <Text
                style={[styles.rowDescription, { color: colors.mutedForeground }]}
              >
                {savedTurnCount === 0
                  ? 'No messages stored yet'
                  : `${savedTurnCount} ${
                      savedTurnCount === 1 ? 'message' : 'messages'
                    } stored on this device`}
              </Text>
            </View>
          </View>
          <Pressable
            testID="clear-history"
            accessibilityRole="button"
            accessibilityLabel="Clear conversation history"
            onPress={() => setShowClearConfirm(true)}
            disabled={isClearing || savedTurnCount === 0}
            style={({ pressed }) => [
              styles.clearButton,
              { borderColor: colors.destructive },
              (isClearing || savedTurnCount === 0) && styles.disabled,
              pressed && savedTurnCount > 0 && styles.pressed,
            ]}
          >
            {isClearing ? (
              <ActivityIndicator size="small" color={colors.destructive} />
            ) : (
              <Feather name="trash-2" size={15} color={colors.destructive} />
            )}
            <Text
              style={[
                styles.clearText,
                {
                  color:
                    savedTurnCount === 0
                      ? colors.mutedForeground
                      : colors.destructive,
                },
              ]}
            >
              Clear history
            </Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Feather name="lock" size={13} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            Second Brain is local-first by design.
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={showClearConfirm}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowClearConfirm(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.confirmCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View
              style={[
                styles.confirmIcon,
                { backgroundColor: colors.secondary },
              ]}
            >
              <Feather name="trash-2" size={20} color={colors.destructive} />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.cardForeground }]}>
              Clear conversation history?
            </Text>
            <Text
              style={[
                styles.confirmDescription,
                { color: colors.mutedForeground },
              ]}
            >
              This permanently removes the saved conversation from this device.
              It cannot be undone.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                testID="cancel-clear-history"
                accessibilityRole="button"
                onPress={() => setShowClearConfirm(false)}
                style={({ pressed }) => [
                  styles.confirmButton,
                  { backgroundColor: colors.secondary },
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.confirmButtonText,
                    { color: colors.secondaryForeground },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                testID="confirm-clear-history"
                accessibilityRole="button"
                onPress={handleClearHistory}
                disabled={isClearing}
                style={({ pressed }) => [
                  styles.confirmButton,
                  { backgroundColor: colors.destructive },
                  pressed && styles.pressed,
                ]}
              >
                {isClearing ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.destructiveForeground}
                  />
                ) : (
                  <Text
                    style={[
                      styles.confirmButtonText,
                      { color: colors.destructiveForeground },
                    ]}
                  >
                    Clear history
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    minHeight: 72,
    paddingHorizontal: 20,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleGroup: { flex: 1, alignItems: 'center', marginHorizontal: 12 },
  headerTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    marginTop: 2,
  },
  headerSpacer: { width: 38 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 28 },
  intro: { paddingTop: 14, paddingBottom: 25 },
  eyebrow: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: 9,
  },
  pageTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -1.1,
    marginBottom: 8,
  },
  pageDescription: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 340,
  },
  sectionLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    letterSpacing: 1.25,
    marginBottom: 9,
    marginTop: 4,
  },
  card: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 5,
    marginBottom: 23,
  },
  cardHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
  },
  settingRow: {
    minHeight: 70,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  rowCopy: { flex: 1 },
  rowTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
  },
  rowDescription: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  segmented: {
    borderRadius: 12,
    padding: 3,
    flexDirection: 'row',
    marginBottom: 9,
  },
  segment: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 9,
    paddingVertical: 9,
    alignItems: 'center',
  },
  segmentText: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  engineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
  },
  engineIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  engineTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  availablePill: {
    borderRadius: 99,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  availableText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 8,
    letterSpacing: 0.8,
  },
  infoRow: {
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  infoText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    lineHeight: 15,
  },
  storageSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
  },
  clearButton: {
    minHeight: 41,
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  clearText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  disabled: { opacity: 0.5 },
  footer: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 8,
  },
  footerText: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.66)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 370,
    borderWidth: 1,
    borderRadius: 22,
    padding: 20,
  },
  confirmIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 17,
  },
  confirmTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  confirmDescription: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 20,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});