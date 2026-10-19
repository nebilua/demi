import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { isCapabilityActive } from "@/lib/privacyCapabilities";
import { supportedScreenResource } from "@/lib/sharedScreenContext";

export default function ScreenAccessScreen() {
  const router = useRouter();
  const app = useApp();
  const colors = useColors(app.settings.appearance);
  const [source, setSource] = useState<"accessibility" | "screenshot" | "resource">("resource");
  const [resource, setResource] = useState<{ name: string; uri: string; mimeType: string | null; size: number | null } | null>(null);
  const [consent, setConsent] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [review, setReview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exclusions, setExclusions] = useState(app.privacyState.screenPolicy.excludedApps.join(", "));
  const approved = isCapabilityActive(app.privacyState, "device.screen-access");
  const active = app.screenSession.status === "active";
  const preview = app.screenPreview;
  const attached = app.screenAttachment;
  const native = Platform.OS === "android";
  const status = !native ? "Android app only" : attached ? "Attached to next local request" : preview ? "Captured · review before sharing" : active ? "Request finished · text discarded" : approved ? "Approved · nothing captured" : app.privacyState.globalPause ? "Paused" : "Off";
  const primary = { backgroundColor: colors.primary };
  const secondary = { backgroundColor: colors.secondary };
  const muted = { color: colors.mutedForeground };
  const foreground = { color: colors.foreground };
  const card = { backgroundColor: colors.card, borderColor: colors.border };
  useEffect(() => {
    if (!preview) setReview(null);
  }, [preview]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active") { setReview(null); setResource(null); setConsent(false); }
    });
    return () => subscription.remove();
  }, []);

  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await operation(); } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This action failed. Try again.");
    } finally { setBusy(false); }
  }

  async function chooseResource() {
    await action(async () => {
      // Permission is rechecked after the picker returns and at actual read time.
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: false, multiple: false,
        type: ["text/plain", "text/markdown", "text/csv", "application/json", "image/png", "image/jpeg"],
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      supportedScreenResource(asset.name, asset.mimeType ?? null);
      setResource({ name: asset.name, uri: asset.uri, mimeType: asset.mimeType ?? null, size: asset.size ?? null });
    });
  }

  async function capture() {
    await action(async () => {
      if (!approved) await app.setCapabilityApproval("device.screen-access", "approved");
      const started = await app.startScreenSession({
        accessibilityText: source === "accessibility",
        screenshot: source === "screenshot",
        selectedResource: source === "resource" ? resource : undefined,
      });
      if (started) { setConsent(false); setReview(null); }
      else setConsent(false); // Provider displays a persistent actionable error.
    });
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to settings" onPress={() => router.canGoBack?.() ? router.back() : router.replace("/settings")} style={styles.icon}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, foreground]}>Screen access</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text testID="screen-status" accessibilityLiveRegion="polite" style={[styles.heading, foreground]}>{status}</Text>
        <Text style={[styles.body, muted]}>{native ? "Share extracted text with one local request. No live vision, automatic actions, cloud processing, or saved chat." : "Capture, selected-file reads, and local OCR need the rebuilt Android app. This preview does not read your screen."}</Text>
        {(error || app.screenSession.status === "error") && (
          <Text testID="screen-error" accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.destructive }]}>
            {error ?? app.screenSession.message}
          </Text>
        )}

        {!active && !preview && !attached && (
          <View style={[styles.card, card]}>
            <Text style={[styles.heading, foreground]}>Source</Text>
            {([
              ["resource", "Selected file or screenshot", "TXT, Markdown, CSV, JSON, PNG, or JPEG."],
              ["accessibility", "Visible text", app.screenAccessStatus.accessibility === "enabled" ? "One snapshot of text Android exposes. Password and editable fields are withheld." : "Enable Demi in Android Accessibility settings first."],
              ["screenshot", "Screenshot OCR", app.screenAccessStatus.screenshotAvailable ? "One visible-screen capture, read on-device. Android may withhold protected content." : "Requires Android 11+ and Demi’s Accessibility service. You can select a screenshot instead."],
            ] as const).map(([value, label, detail]) => (
              <Pressable key={value} testID={`screen-source-${value}`} accessibilityRole="radio" accessibilityState={{ checked: source === value }} onPress={() => { setSource(value); setError(null); }} style={styles.source}>
                <Feather name={source === value ? "check-circle" : "circle"} size={19} color={source === value ? colors.primary : colors.mutedForeground} />
                <View style={styles.copy}>
                  <Text style={[styles.label, foreground]}>{label}</Text>
                  <Text style={[styles.small, muted]}>{detail}</Text>
                </View>
              </Pressable>
            ))}
            {source === "resource" && (
              <Pressable testID="select-screen-resource" accessibilityRole="button" disabled={busy || !native} onPress={() => void chooseResource()} style={[styles.button, secondary]}>
                <Text style={[styles.label, foreground]}>{resource?.name ?? "Choose file"}</Text>
              </Pressable>
            )}
            <Text style={[styles.small, muted]}>English OCR. Snapshots cover the visible screen only. Leaving Demi stops sharing. For another app, take a screenshot yourself and select it here. Exclusions and protected fields cannot be detected in selected files; review them yourself.</Text>
          </View>
        )}

        {preview && (
          <View style={[styles.card, card]}>
            <Text style={[styles.heading, foreground]}>Review text</Text>
            <Text style={[styles.small, muted]}>Up to 6,000 characters. OCR may be incomplete. Remove anything private before sharing. Captures expire after two minutes.</Text>
            <TextInput key={preview.capturedAt} testID="screen-review-text" accessibilityLabel="Review extracted text" value={review ?? preview.text} multiline maxLength={6000} onChangeText={setReview} style={[styles.input, foreground, { borderColor: colors.border }]} />
            <Pressable testID="attach-screen-context" accessibilityRole="button" onPress={() => {
              try {
                app.attachScreenContext(review ?? preview.text);
                setReview(null);
                setResource(null);
                router.replace("/");
              } catch (caught) { setError(caught instanceof Error ? caught.message : "Capture again."); }
            }} style={[styles.button, primary]}>
              <Text style={[styles.label, { color: colors.primaryForeground }]}>Share with next request</Text>
            </Pressable>
          </View>
        )}
        {attached && <Text style={[styles.body, muted]}>Ready in Home. Only your next request can use this text, and only on-device.</Text>}

        {active || preview || attached ? (
          <Pressable testID="stop-screen-session" accessibilityRole="button" onPress={() => void action(async () => { await app.stopScreenSession(); setReview(null); setResource(null); })} style={[styles.button, secondary]}>
            <Text style={[styles.label, foreground]}>Stop and discard</Text>
          </Pressable>
        ) : (
          <Pressable testID="start-screen-session" accessibilityRole="button" disabled={!native || busy || app.privacyState.globalPause || (source === "resource" && !resource)} onPress={() => setConsent(true)} style={[styles.button, primary, (!native || busy || app.privacyState.globalPause || (source === "resource" && !resource)) && styles.disabled]}>
            {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.label, { color: colors.primaryForeground }]}>{approved ? "Capture text" : "Approve and capture"}</Text>}
          </Pressable>
        )}

        <Pressable testID="screen-advanced" accessibilityRole="button" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced(!advanced)} style={styles.source}>
          <Text style={[styles.label, foreground]}>Controls and activity</Text>
          <Feather name={advanced ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
        </Pressable>
        {advanced && <View style={[styles.card, card]}>
          <Text style={[styles.heading, foreground]}>Android permission</Text>
          <Text style={[styles.body, muted]}>{Platform.OS === "android" ? `Accessibility: ${app.screenAccessStatus.accessibility}. App approval: ${approved ? "approved" : "not active"}. They are separate controls.` : "Capture and local OCR require the rebuilt Android app. No microphone or screen is read by this preview."}</Text>
          <Pressable testID="open-accessibility-settings" accessibilityRole="button" onPress={() => void action(app.openAccessibilitySettings)} style={[styles.button, secondary]}>
            <Text style={[styles.label, foreground]}>Android Accessibility settings</Text>
          </Pressable>
          <Text style={[styles.heading, foreground]}>Discard</Text>
          <Text style={[styles.small, muted]}>No captured text or derived reply is written to storage. Stop, pause, revoke, expiry, and backgrounding discard shared data. Replies are visible only until sharing ends.</Text>
          <Pressable testID="screen-retention" accessibilityRole="button" onPress={() => void action(async () => {
            await app.updateScreenPolicy({ retention: app.privacyState.screenPolicy.retention === "discard-immediately" ? "save-only-on-request" : "discard-immediately" });
          })} style={[styles.button, secondary]}>
            <Text style={[styles.label, foreground]}>{app.privacyState.screenPolicy.retention === "discard-immediately" ? "Clear attachment when request starts" : "Keep attachment until request finishes"}</Text>
          </Pressable>
          <Text style={[styles.heading, foreground]}>Excluded apps</Text>
          <Text style={[styles.small, muted]}>Package names or app labels, separated by commas. Applied to live snapshots, not selected files. Saving ends the current share.</Text>
          <TextInput testID="excluded-apps-input" accessibilityLabel="Excluded apps" value={exclusions} onChangeText={setExclusions} style={[styles.input, styles.shortInput, foreground, { borderColor: colors.border }]} />
          <Pressable testID="save-excluded-apps" accessibilityRole="button" onPress={() => void action(async () => { await app.updateScreenPolicy({ excludedApps: exclusions.split(",").map(s => s.trim()).filter(Boolean).slice(0, 20) }); setReview(null); setResource(null); })} style={[styles.button, secondary]}>
            <Text style={[styles.label, foreground]}>Save exclusions</Text>
          </Pressable>
          <Text style={[styles.heading, foreground]}>Activity</Text>
          {app.privacyState.auditEvents.filter(event => event.capabilityId === "device.screen-access").slice(-5).reverse().map(event => (
            <Text key={event.id} style={[styles.small, muted]}>{event.action} · {event.status} · {new Date(event.createdAt).toLocaleTimeString()}</Text>
          ))}
          <Text style={[styles.small, muted]}>Activity contains status only, never captured text or filenames.</Text>
        </View>}
      </ScrollView>
      <Modal visible={consent} transparent animationType="fade" onRequestClose={() => setConsent(false)}>
        <View style={styles.backdrop}>
          <ScrollView style={[styles.modal, card]} contentContainerStyle={{ padding: 20, gap: 16 }}>
            <Text style={[styles.heading, foreground]}>Capture for review?</Text>
            <Text style={[styles.body, muted]}>Approve {source === "resource" ? "only the selected file" : source === "screenshot" ? "one screenshot and local OCR" : "one visible-text snapshot"}. Nothing is attached until you review and share. Up to 6,000 characters, two minutes, no cloud or saved chat. Android Accessibility must be enabled separately for live snapshots.</Text>
            {error && <Text style={[styles.body, { color: colors.destructive }]}>{error}</Text>}
            <Pressable testID="confirm-start-screen-session" disabled={busy} accessibilityRole="button" onPress={() => void capture()} style={[styles.button, primary]}>
              {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.label, { color: colors.primaryForeground }]}>Continue</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConsent(false)} style={[styles.button, secondary]}><Text style={[styles.label, foreground]}>Cancel</Text></Pressable>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 60, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 20 },
  content: { padding: 20, paddingTop: 8, paddingBottom: 40, gap: 16 },
  heading: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  label: { fontFamily: "Inter_500Medium", fontSize: 14, flexShrink: 1 },
  body: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 },
  small: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  card: { padding: 16, borderWidth: 1, borderRadius: 14, gap: 14 },
  source: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, minHeight: 44 },
  copy: { flex: 1, gap: 4 },
  button: { minHeight: 48, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  input: { minHeight: 160, maxHeight: 300, borderWidth: 1, borderRadius: 8, padding: 12, textAlignVertical: "top", fontFamily: "Inter_400Regular", fontSize: 14 },
  shortInput: { minHeight: 48 },
  disabled: { opacity: 0.5 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  modal: { maxHeight: "90%", flexGrow: 0, borderWidth: 1, borderRadius: 16 },
});
