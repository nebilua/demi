import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RuntimeMetric } from "@/lib/runtimeDiagnostics";
import {
  createPrivacySafeBugReport,
  serializePrivacySafeBugReport,
} from "@/lib/bugReport";
import type { useColors } from "@/hooks/useColors";

type Colors = ReturnType<typeof useColors>;

export function BugReportExport({
  visible,
  onClose,
  metrics,
  modelStatus,
  colors,
}: {
  visible: boolean;
  onClose: () => void;
  metrics: RuntimeMetric[];
  modelStatus: string;
  colors: Colors;
}) {
  const [isSharing, setIsSharing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const report = useMemo(
    () =>
      createPrivacySafeBugReport({
        appVersion: Constants.expoConfig?.version,
        appBuild:
          Constants.nativeBuildVersion ??
          Constants.expoConfig?.android?.versionCode,
        platform: Platform.OS,
        osVersion: Platform.Version,
        modelStatus,
        metrics,
      }),
    [metrics, modelStatus],
  );

  async function handleShareReport() {
    if (isSharing) return;
    setIsSharing(true);
    setMessage(null);

    let reportUri: string | null = null;
    try {
      const reportText = serializePrivacySafeBugReport(report);
      if (Platform.OS === "web") {
        if (typeof document === "undefined" || typeof URL === "undefined") {
          throw new Error("Browser download is unavailable.");
        }
        const blob = new Blob([reportText], { type: "application/json" });
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = "demi-bug-report.json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        setMessage("The report was downloaded by this browser. Demi did not upload it.");
        return;
      }

      if (!FileSystem.cacheDirectory) {
        throw new Error("Temporary storage is unavailable.");
      }
      reportUri = `${FileSystem.cacheDirectory}demi-bug-report-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(reportUri, reportText, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error("The system share menu is unavailable.");
      }
      await Sharing.shareAsync(reportUri, {
        dialogTitle: "Share privacy-safe Demi bug report",
        mimeType: "application/json",
      });
      setMessage("The system share menu closed. Demi did not upload this report.");
    } catch {
      setMessage(
        "The report could not be prepared for sharing. Nothing was uploaded; try again.",
      );
    } finally {
      if (reportUri) {
        try {
          await FileSystem.deleteAsync(reportUri, { idempotent: true });
        } catch {
          // A leftover report contains only the fields shown in the preview.
        }
      }
      setIsSharing(false);
    }
  }

  const eventSummary =
    report.diagnostics.events.length === 0
      ? "No supported model timing events this session"
      : report.diagnostics.events
          .map((event) => {
            const elapsed =
              event.ageMinutes === null
                ? ""
                : ` · ${event.ageMinutes} min ago`;
            const duration =
              event.durationMs === null ? "" : ` · ${event.durationMs} ms`;
            return `${event.category}${duration}${elapsed}`;
          })
          .join("\n");

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View
          testID="bug-report-preview"
          accessibilityViewIsModal
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.title, { color: colors.cardForeground }]}>
            Review bug report
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            This report stays on your device until you choose a destination in
            the system share menu. Demi does not upload it.
          </Text>
          <ScrollView style={styles.preview}>
            <Text style={[styles.sectionTitle, { color: colors.cardForeground }]}>
              Included
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              App: {report.app.name} {report.app.version ?? "version unavailable"}
              {report.app.build ? ` · build ${report.app.build}` : ""}
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Device: {report.device.platform} · OS{" "}
              {report.device.osVersion ?? "version unavailable"}
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Model status: {report.diagnostics.modelStatus}
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Recent model event categories and timings:
              {"\n"}
              {eventSummary}
            </Text>
            <Text style={[styles.sectionTitle, styles.privacyTitle, { color: colors.cardForeground }]}>
              Never included
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Chats, prompts, memories, document contents, model names or paths,
              credentials, and raw error messages.
            </Text>
          </ScrollView>
          {message && (
            <Text
              testID="bug-report-share-message"
              accessibilityRole="alert"
              style={[
                styles.message,
                {
                  color: message.startsWith("The report could not be")
                    ? colors.destructive
                    : colors.primary,
                },
              ]}
            >
              {message}
            </Text>
          )}
          <View style={styles.actions}>
            <Pressable
              testID="cancel-bug-report"
              accessibilityRole="button"
              disabled={isSharing}
              onPress={onClose}
              style={({ pressed }) => [
                styles.button,
                { borderColor: colors.border },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.foreground }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              testID="share-bug-report"
              accessibilityRole="button"
              disabled={isSharing}
              onPress={handleShareReport}
              style={({ pressed }) => [
                styles.button,
                styles.primaryButton,
                { backgroundColor: colors.primary },
                (pressed || isSharing) && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                {isSharing ? "Preparing…" : "Share or save"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  card: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "90%",
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
  },
  title: {
    fontFamily: "SpaceGrotesk_700Bold",
    fontSize: 19,
    marginBottom: 8,
  },
  sectionTitle: {
    fontFamily: "SpaceGrotesk_600SemiBold",
    fontSize: 14,
    marginBottom: 6,
  },
  privacyTitle: { marginTop: 16 },
  body: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
  },
  preview: { flexShrink: 1, marginTop: 10 },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 14,
  },
  button: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  primaryButton: { borderColor: "transparent" },
  buttonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  message: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  pressed: { opacity: 0.72 },
});
