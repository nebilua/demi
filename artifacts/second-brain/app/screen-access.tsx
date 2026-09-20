import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { getCapabilityStatusLabel } from "@/lib/privacyCapabilities";

function ChannelRow({
  icon,
  title,
  detail,
  active,
  colors,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  detail: string;
  active: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.channelRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.channelIcon, { backgroundColor: active ? colors.accent : colors.secondary }]}>
        <Feather name={icon} size={16} color={active ? colors.accentForeground : colors.mutedForeground} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.channelTitle, { color: colors.cardForeground }]}>{title}</Text>
        <Text style={[styles.channelDetail, { color: colors.mutedForeground }]}>{detail}</Text>
      </View>
      <Text style={[styles.channelState, { color: active ? colors.primary : colors.mutedForeground }]}>
        {active ? "Receiving" : "Off"}
      </Text>
    </View>
  );
}

export default function ScreenAccessScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    settings,
    privacyState,
    screenAccessStatus,
    screenSession,
    refreshScreenAccessStatus,
    startScreenSession,
    stopScreenSession,
    openAccessibilitySettings,
    updateScreenPolicy,
    setCapabilityApproval,
  } = useApp();
  const colors = useColors(settings.appearance);
  const [includeAccessibility, setIncludeAccessibility] = useState(false);
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [resource, setResource] = useState<{
    name: string;
    mimeType: string | null;
    size: number | null;
  } | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [showActionPreview, setShowActionPreview] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [excludedAppsDraft, setExcludedAppsDraft] = useState(
    privacyState.screenPolicy.excludedApps.join(", "),
  );
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);

  const screenGrant = privacyState.capabilities["device.screen-access"];
  const hasGrant = screenGrant?.approval === "approved" && !privacyState.globalPause;
  const isActive = screenSession.status === "active";

  useEffect(() => {
    void refreshScreenAccessStatus().catch(() => undefined);
  }, []);

  useEffect(() => {
    setExcludedAppsDraft(privacyState.screenPolicy.excludedApps.join(", "));
  }, [privacyState.screenPolicy.excludedApps]);

  async function chooseResource() {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: false,
      multiple: false,
      type: "*/*",
    });
    if (result.canceled) return;
    const file = result.assets[0];
    if (!file) return;
    setResource({
      name: file.name,
      mimeType: file.mimeType ?? null,
      size: file.size ?? null,
    });
  }

  async function beginSession() {
    setIsStarting(true);
    try {
      const started = await startScreenSession({
        accessibilityText: includeAccessibility,
        screenshot: includeScreenshot,
        selectedResource: resource ?? undefined,
      });
      if (started) setShowConsent(false);
    } finally {
      setIsStarting(false);
    }
  }

  async function saveExcludedApps() {
    const excludedApps = excludedAppsDraft
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);
    await updateScreenPolicy({ excludedApps });
    setPolicyMessage("Excluded-app rules saved for future sessions.");
  }

  const statusDetail =
    Platform.OS !== "android"
      ? "Install the Android build to request screen capture or accessibility access."
      : screenAccessStatus.accessibility === "enabled"
        ? "Demi is enabled in Android Accessibility settings."
        : "Accessibility is separately disabled in Android Settings.";

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
      <StatusBar style={colors.isDark ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Screen access</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: Math.max(28, insets.bottom + 28) }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.heroIcon, { backgroundColor: isActive ? colors.accent : colors.secondary }]}>
            <Feather name={isActive ? "eye" : "eye-off"} size={21} color={isActive ? colors.accentForeground : colors.primary} />
          </View>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>PERMISSIONED SESSION</Text>
          <Text style={[styles.title, { color: colors.cardForeground }]}>
            Understand what is visible, with your permission
          </Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>
            Demi never gets general phone access. Each session names its data sources, asks Android for capture consent, runs locally by default, and stops when you stop it or leave the app.
          </Text>
          <View style={[styles.statusPill, { backgroundColor: isActive ? colors.accent : colors.secondary }]}>
            <View style={[styles.statusDot, { backgroundColor: isActive ? colors.primary : colors.mutedForeground }]} />
            <Text style={[styles.statusPillText, { color: colors.foreground }]}>
              {isActive ? "Session active" : screenSession.status === "starting" ? "Starting session" : "No active session"}
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>What Demi can receive</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ChannelRow
            icon="type"
            title="Accessibility text"
            detail={screenAccessStatus.accessibility === "enabled" ? "Optional; enabled separately in Android Settings" : "Not enabled in Android Settings"}
            active={isActive && screenSession.accessibilityText}
            colors={colors}
          />
          <ChannelRow
            icon="image"
            title="Screenshot pixels"
            detail={screenAccessStatus.mediaProjection === "available" ? "Android MediaProjection consent is active" : "Requires Android’s one-time user-facing consent"}
            active={isActive && screenSession.screenshot}
            colors={colors}
          />
          <ChannelRow
            icon="file"
            title="Selected device resource"
            detail={screenSession.selectedResource?.name ?? resource?.name ?? "Nothing selected"}
            active={isActive && Boolean(screenSession.selectedResource)}
            colors={colors}
          />
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            Password fields, banking content, secure windows, DRM-protected content, and app exclusions may be withheld by Android or this policy. Demi does not bypass those protections.
          </Text>
          {screenAccessStatus.protectedContentState === "unknown" && (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Android does not expose a reliable protected-window signal for every MediaProjection frame; treat screenshot content as potentially incomplete.
            </Text>
          )}
          {screenSession.protectedContent && (
            <Text style={[styles.note, { color: colors.destructive }]}>
              Protected or excluded content was detected and is not available to this session.
            </Text>
          )}
        </View>

        {!hasGrant && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.cardForeground }]}>Screen access is off</Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              Enable the named capability before a session can start. This grant does not enable Android capture or accessibility by itself.
            </Text>
            <Pressable
              testID="enable-screen-access"
              accessibilityRole="button"
              onPress={() => void setCapabilityApproval("device.screen-access", "approved")}
              style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}
            >
              <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Enable screen capability</Text>
            </Pressable>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Session scope</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.optionRow}>
            <View style={styles.copy}>
              <Text style={[styles.cardTitle, { color: colors.cardForeground }]}>Accessibility text</Text>
              <Text style={[styles.optionDetail, { color: colors.mutedForeground }]}>Only visible text exposed by the separately enabled Android service.</Text>
            </View>
            <Switch
              testID="screen-accessibility-toggle"
              value={includeAccessibility}
              disabled={screenAccessStatus.accessibility !== "enabled" || isActive}
              onValueChange={setIncludeAccessibility}
              trackColor={{ false: colors.secondary, true: colors.accent }}
              thumbColor={includeAccessibility ? colors.accentForeground : colors.mutedForeground}
            />
          </View>
          <View style={styles.optionRow}>
            <View style={styles.copy}>
              <Text style={[styles.cardTitle, { color: colors.cardForeground }]}>Screenshot pixels</Text>
              <Text style={[styles.optionDetail, { color: colors.mutedForeground }]}>Downsampled on-device capture; Android asks for consent each time it is needed.</Text>
            </View>
            <Switch
              testID="screenshot-toggle"
              value={includeScreenshot}
              disabled={isActive}
              onValueChange={setIncludeScreenshot}
              trackColor={{ false: colors.secondary, true: colors.accent }}
              thumbColor={includeScreenshot ? colors.accentForeground : colors.mutedForeground}
            />
          </View>
          <Pressable
            testID="select-screen-resource"
            accessibilityRole="button"
            disabled={isActive}
            onPress={() => void chooseResource()}
            style={({ pressed }) => [styles.resourceButton, { borderColor: colors.border }, pressed && styles.pressed]}
          >
            <Feather name="paperclip" size={15} color={colors.primary} />
            <View style={styles.copy}>
              <Text style={[styles.cardTitle, { color: colors.cardForeground }]}>
                {resource ? resource.name : "Select one device resource"}
              </Text>
              <Text style={[styles.optionDetail, { color: colors.mutedForeground }]}>
                The system picker grants only the file you choose; Demi does not scan app storage.
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </Pressable>
          <Text style={[styles.retentionLabel, { color: colors.mutedForeground }]}>Retention: {privacyState.screenPolicy.retention === "discard-immediately" ? "discard immediately" : "save only when you ask"}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={isActive}
            onPress={() => void updateScreenPolicy({
              retention: privacyState.screenPolicy.retention === "discard-immediately" ? "save-only-on-request" : "discard-immediately",
            })}
            style={({ pressed }) => [styles.smallButton, { backgroundColor: colors.secondary }, pressed && styles.pressed]}
          >
            <Text style={[styles.smallButtonText, { color: colors.foreground }]}>Change retention</Text>
          </Pressable>
        </View>

        <View style={styles.actionRow}>
          {!isActive ? (
            <Pressable
              testID="start-screen-session"
              accessibilityRole="button"
              disabled={!hasGrant || isStarting}
              onPress={() => setShowConsent(true)}
              style={({ pressed }) => [styles.primaryButton, { backgroundColor: hasGrant ? colors.primary : colors.secondary }, pressed && styles.pressed]}
            >
              {isStarting ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="play" size={15} color={hasGrant ? colors.primaryForeground : colors.mutedForeground} />}
              <Text style={[styles.primaryButtonText, { color: hasGrant ? colors.primaryForeground : colors.mutedForeground }]}>Start screen-understanding session</Text>
            </Pressable>
          ) : (
            <Pressable
              testID="stop-screen-session"
              accessibilityRole="button"
              accessibilityLabel="Stop screen access now"
              onPress={() => void stopScreenSession("user-stopped")}
              style={({ pressed }) => [styles.killButton, { backgroundColor: colors.destructive }, pressed && styles.pressed]}
            >
              <Feather name="square" size={15} color={colors.destructiveForeground} />
              <Text style={[styles.primaryButtonText, { color: colors.destructiveForeground }]}>Stop now</Text>
            </Pressable>
          )}
        </View>
        {screenSession.message && (
          <View style={[styles.messageBanner, { backgroundColor: colors.secondary }]}>
            <Feather
              name={screenSession.status === "error" ? "alert-circle" : "shield"}
              size={15}
              color={screenSession.status === "error" ? colors.destructive : colors.primary}
            />
            <Text style={[styles.note, styles.messageText, { color: colors.foreground }]}>
              {screenSession.message}
            </Text>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Android controls</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.cardForeground }]}>Accessibility service</Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>{statusDetail} Demi cannot turn this service on silently.</Text>
          <Pressable
            testID="open-accessibility-settings"
            accessibilityRole="button"
            onPress={() => setShowActionPreview(true)}
            style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border }, pressed && styles.pressed]}
          >
            <Feather name="settings" size={15} color={colors.foreground} />
            <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Open Android Accessibility settings</Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Excluded apps</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>
            Add package names or labels separated by commas. Android may still withhold protected content; exclusions are an additional user rule.
          </Text>
          <TextInput
            testID="excluded-apps-input"
            value={excludedAppsDraft}
            onChangeText={setExcludedAppsDraft}
            placeholder="Bank app, com.example.private"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.cardForeground, borderColor: colors.border, backgroundColor: colors.background }]}
            editable={!isActive}
          />
          <Pressable
            testID="save-excluded-apps"
            accessibilityRole="button"
            disabled={isActive}
            onPress={() => void saveExcludedApps()}
            style={({ pressed }) => [styles.smallButton, { backgroundColor: colors.secondary }, pressed && styles.pressed]}
          >
            <Text style={[styles.smallButtonText, { color: colors.foreground }]}>Save exclusions</Text>
          </Pressable>
          {policyMessage && <Text style={[styles.note, { color: colors.primary }]}>{policyMessage}</Text>}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Recent activity</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {privacyState.auditEvents.filter((event) => event.capabilityId === "device.screen-access").slice(-5).reverse().map((event) => (
            <View key={event.id} style={styles.historyRow}>
              <Text style={[styles.historyAction, { color: colors.cardForeground }]}>{event.action}</Text>
              <Text style={[styles.optionDetail, { color: colors.mutedForeground }]}>{event.status} · {new Date(event.createdAt).toLocaleTimeString()}</Text>
            </View>
          ))}
          {privacyState.auditEvents.filter((event) => event.capabilityId === "device.screen-access").length === 0 && (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>No screen activity has been recorded.</Text>
          )}
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {getCapabilityStatusLabel(screenGrant)} · local processing by default · no connector or remote model disclosure has been granted.
          </Text>
        </View>
      </ScrollView>

      <Modal visible={showConsent} transparent animationType="fade" onRequestClose={() => setShowConsent(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>CONFIRM SESSION</Text>
            <Text style={[styles.modalTitle, { color: colors.cardForeground }]}>Start screen understanding?</Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              Demi will receive only the channels selected above. Android will show its own capture consent prompt. Data stays on-device and is discarded when the session ends unless you explicitly save it.
            </Text>
            <Text style={[styles.modalScope, { color: colors.cardForeground }]}>
              {includeAccessibility ? "Accessibility text · " : ""}{includeScreenshot ? "Screenshot pixels · " : ""}{resource ? `Selected resource: ${resource.name}` : "No selected resource"}
            </Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setShowConsent(false)} disabled={isStarting} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border }, pressed && styles.pressed]}>
                <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable testID="confirm-start-screen-session" onPress={() => void beginSession()} disabled={isStarting} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
                {isStarting ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Continue</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showActionPreview} transparent animationType="fade" onRequestClose={() => setShowActionPreview(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>ACTION PREVIEW</Text>
            <Text style={[styles.modalTitle, { color: colors.cardForeground }]}>Open Android accessibility settings</Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              This reversible action leaves the Demi session and opens Android Settings. Demi will not enable the service or change any setting for you.
            </Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setShowActionPreview(false)} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border }, pressed && styles.pressed]}>
                <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => { setShowActionPreview(false); void openAccessibilitySettings(); }} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
                <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Confirm</Text>
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
  header: { height: 60, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 20 },
  headerSpacer: { width: 36 },
  hero: { margin: 20, padding: 18, borderWidth: 1, borderRadius: 20 },
  heroIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  eyebrow: { fontFamily: "Inter_500Medium", fontSize: 10, letterSpacing: 1.1 },
  title: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 24, lineHeight: 29, marginTop: 8 },
  description: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, marginTop: 8 },
  statusPill: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 7, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7, marginTop: 14 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusPillText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  sectionLabel: { fontFamily: "Inter_500Medium", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginHorizontal: 20, marginTop: 18, marginBottom: 8 },
  card: { marginHorizontal: 20, padding: 16, borderWidth: 1, borderRadius: 18 },
  channelRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: 1 },
  channelIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  channelTitle: { fontFamily: "Inter_500Medium", fontSize: 13 },
  channelDetail: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 15, marginTop: 2 },
  channelState: { fontFamily: "Inter_500Medium", fontSize: 10, textTransform: "uppercase" },
  copy: { flex: 1, minWidth: 0 },
  note: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 12 },
  cardTitle: { fontFamily: "Inter_500Medium", fontSize: 14 },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  optionDetail: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 15, marginTop: 3 },
  resourceButton: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 11, marginTop: 8 },
  retentionLabel: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 15 },
  smallButton: { alignSelf: "flex-start", borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8, marginTop: 10 },
  smallButtonText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  actionRow: { marginHorizontal: 20, marginTop: 16 },
  messageBanner: { marginHorizontal: 20, marginTop: 10, borderRadius: 12, padding: 11, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  messageText: { flex: 1, marginTop: 0 },
  primaryButton: { minHeight: 42, borderRadius: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryButtonText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  killButton: { minHeight: 48, borderRadius: 14, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  secondaryButton: { minHeight: 40, borderRadius: 11, borderWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12 },
  secondaryButtonText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 42, paddingHorizontal: 11, marginTop: 12, fontFamily: "Inter_400Regular", fontSize: 12 },
  historyRow: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "transparent" },
  historyAction: { fontFamily: "Inter_500Medium", fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.52)", justifyContent: "center", padding: 20 },
  modalCard: { borderWidth: 1, borderRadius: 20, padding: 18 },
  modalTitle: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 22, marginTop: 7 },
  modalScope: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 18, marginTop: 14 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 18 },
  pressed: { opacity: 0.72 },
});