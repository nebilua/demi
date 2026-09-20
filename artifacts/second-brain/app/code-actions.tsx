import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "@/context/AppContext";
import { useTools } from "@/context/ToolContext";
import { useColors } from "@/hooks/useColors";
import { formatSandboxProgramExamples, SANDBOX_LIMITS } from "@/lib/sandboxCode";

const DEFAULT_CODE = '{"version":1,"operation":"count"}';

export default function CodeActionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings, privacyReady, privacyState } = useApp();
  const colors = useColors(settings.appearance);
  const {
    selectedDocument,
    pickDocument,
    clearDocument,
    codeRun,
    codeRunBusy,
    codeRunError,
    runCodeAction,
    cancelCodeAction,
  } = useTools();
  const [code, setCode] = useState(DEFAULT_CODE);
  const [reviewVisible, setReviewVisible] = useState(false);

  const enabled =
    privacyReady &&
    !privacyState.globalPause &&
    privacyState.capabilities["local.code-execution"]?.approval === "approved";

  async function confirmRun() {
    setReviewVisible(false);
    await runCodeAction(code);
  }

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top ? 0 : 67,
          paddingBottom: insets.bottom ? 0 : 34,
        },
      ]}
    >
      <StatusBar style={colors.isDark ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable
          testID="code-actions-back"
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: colors.secondary },
            pressed && styles.pressed,
          ]}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Sandboxed code
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
            reviewed, local, and side-effect free
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.eyebrow, { color: colors.primary }]}>LOCAL CODE ACTIONS</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Run a bounded calculation.
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Demi does not execute JavaScript or shell commands here. You provide a
          small reviewed JSON program, and the pure interpreter can only calculate
          or transform the file you explicitly select.
        </Text>

        {!enabled && (
          <View style={[styles.notice, { backgroundColor: colors.secondary }]}>
            <Feather name="lock" size={15} color={colors.primary} />
            <Text style={[styles.noticeText, { color: colors.foreground }]}>
              Sandboxed code actions are off. Enable “Sandboxed code actions” in
              Settings before running anything.
            </Text>
          </View>
        )}

        <Pressable
          testID="pick-code-input"
          accessibilityRole="button"
          onPress={() => void pickDocument()}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.primary },
            pressed && styles.pressed,
          ]}
        >
          <Feather name="file-plus" size={17} color={colors.primaryForeground} />
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
            {selectedDocument ? "Choose another CSV or JSON file" : "Choose a CSV or JSON file"}
          </Text>
        </Pressable>

        {selectedDocument && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.fileRow}>
              <View style={[styles.fileIcon, { backgroundColor: colors.accent }]}>
                <Feather name="file-text" size={18} color={colors.accentForeground} />
              </View>
              <View style={styles.copy}>
                <Text style={[styles.fileName, { color: colors.cardForeground }]}>
                  {selectedDocument.name}
                </Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  One explicit input · {selectedDocument.content.length.toLocaleString()} characters
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove code action input"
                onPress={clearDocument}
              >
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>
        )}

        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          Sandboxed program
        </Text>
        <TextInput
          testID="sandbox-code-input"
          value={code}
          onChangeText={setCode}
          multiline
          maxLength={SANDBOX_LIMITS.maxCodeChars}
          editable={!codeRunBusy}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={DEFAULT_CODE}
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.codeInput,
            {
              color: colors.cardForeground,
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        />
        <Text style={[styles.help, { color: colors.mutedForeground }]}>
          Supported examples:
          {"\n"}
          {formatSandboxProgramExamples()}
        </Text>

        <Pressable
          testID="review-sandbox-code"
          accessibilityRole="button"
          disabled={codeRunBusy || !selectedDocument || !enabled}
          onPress={() => setReviewVisible(true)}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: enabled ? colors.primary : colors.border },
            (codeRunBusy || !selectedDocument || !enabled) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {codeRunBusy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="shield" size={16} color={enabled ? colors.primary : colors.mutedForeground} />
          )}
          <Text style={[styles.secondaryButtonText, { color: enabled ? colors.primary : colors.mutedForeground }]}>
            {codeRunBusy ? "Running in sandbox…" : "Review and run"}
          </Text>
        </Pressable>

        {codeRunBusy && (
          <Pressable
            testID="cancel-sandbox-code"
            accessibilityRole="button"
            onPress={cancelCodeAction}
            style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
          >
            <Text style={[styles.cancelText, { color: colors.destructive }]}>
              Cancel run
            </Text>
          </Pressable>
        )}

        {codeRunError && (
          <View style={[styles.notice, { backgroundColor: colors.secondary }]}>
            <Feather name="alert-circle" size={15} color={colors.destructive} />
            <Text style={[styles.noticeText, { color: colors.foreground }]}>
              {codeRunError}
            </Text>
          </View>
        )}

        {codeRun && (
          <View style={[styles.result, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.resultHeader}>
              <Text style={[styles.resultTitle, { color: colors.cardForeground }]}>
                Execution result
              </Text>
              <Text style={[styles.status, { color: codeRun.status === "completed" ? colors.primary : colors.destructive }]}>
                {codeRun.status}
              </Text>
            </View>
            <Text style={[styles.resultSummary, { color: colors.mutedForeground }]}>
              {codeRun.summary}
            </Text>
            {codeRun.output ? (
              <Text selectable style={[styles.resultText, { color: colors.cardForeground }]}>
                {codeRun.output}
              </Text>
            ) : null}
            {codeRun.stderr ? (
              <Text style={[styles.errorOutput, { color: colors.destructive }]}>
                {codeRun.stderr}
              </Text>
            ) : null}
            <Text style={[styles.usage, { color: colors.mutedForeground }]}>
              {codeRun.resourceUsage.elapsedMs} ms · {codeRun.resourceUsage.steps.toLocaleString()} steps ·{" "}
              {codeRun.resourceUsage.inputBytes.toLocaleString()} input bytes ·{" "}
              {codeRun.resourceUsage.outputBytes.toLocaleString()} output bytes
            </Text>
            <Text style={[styles.noSideEffects, { color: colors.mutedForeground }]}>
              No files generated. No network, credentials, Android intents, or device services are available.
            </Text>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={reviewVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReviewVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={[styles.reviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.reviewEyebrow, { color: colors.primary }]}>REVIEW BEFORE EXECUTION</Text>
            <Text style={[styles.reviewTitle, { color: colors.cardForeground }]}>
              Run this local action?
            </Text>
            <Text style={[styles.reviewBody, { color: colors.mutedForeground }]}>
              This code and the selected file will stay in the app process. The
              sandbox can only perform the listed pure operation.
            </Text>
            <Text style={[styles.reviewLabel, { color: colors.mutedForeground }]}>Code</Text>
            <Text selectable style={[styles.reviewCode, { color: colors.cardForeground, backgroundColor: colors.background }]}>
              {code}
            </Text>
            <Text style={[styles.reviewLabel, { color: colors.mutedForeground }]}>Input and limits</Text>
            <Text style={[styles.reviewBody, { color: colors.mutedForeground }]}>
              {selectedDocument?.name ?? "No file"} · up to {SANDBOX_LIMITS.maxRows.toLocaleString()} rows ·{" "}
              {SANDBOX_LIMITS.maxExecutionMs} ms · {SANDBOX_LIMITS.maxOutputChars.toLocaleString()} output characters.
              {"\n"}No writes or external side effects are permitted.
            </Text>
            <View style={styles.reviewActions}>
              <Pressable onPress={() => setReviewVisible(false)}>
                <Text style={[styles.actionText, { color: colors.mutedForeground }]}>Not now</Text>
              </Pressable>
              <Pressable testID="confirm-run-sandbox-code" onPress={() => void confirmRun()}>
                <Text style={[styles.actionText, { color: colors.primary }]}>Run locally</Text>
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
  header: { minHeight: 72, paddingHorizontal: 20, paddingVertical: 13, flexDirection: "row", alignItems: "center" },
  iconButton: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, alignItems: "center", marginHorizontal: 10 },
  headerSpacer: { width: 38 },
  headerTitle: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 17 },
  headerSubtitle: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 2 },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32 },
  eyebrow: { fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, letterSpacing: 1.4, marginBottom: 9 },
  title: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 30, lineHeight: 36, letterSpacing: -1, marginBottom: 8 },
  body: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20, marginBottom: 18 },
  notice: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, marginBottom: 14 },
  noticeText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  primaryButton: { borderRadius: 13, minHeight: 48, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, marginBottom: 14 },
  primaryButtonText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 4 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  fileIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1 },
  fileName: { fontFamily: "Inter_500Medium", fontSize: 13 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 3 },
  label: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 16, marginBottom: 7 },
  codeInput: { minHeight: 112, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: "monospace", fontSize: 12, textAlignVertical: "top" },
  help: { fontFamily: "monospace", fontSize: 10, lineHeight: 16, marginTop: 9 },
  secondaryButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, marginTop: 16 },
  secondaryButtonText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  cancelButton: { alignItems: "center", padding: 12 },
  cancelText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  result: { borderRadius: 16, borderWidth: 1, padding: 14, marginTop: 14 },
  resultHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  resultTitle: { fontFamily: "Inter_500Medium", fontSize: 12 },
  status: { fontFamily: "Inter_500Medium", fontSize: 11, textTransform: "uppercase" },
  resultSummary: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 8 },
  resultText: { fontFamily: "monospace", fontSize: 12, lineHeight: 18, marginTop: 12 },
  errorOutput: { fontFamily: "monospace", fontSize: 11, lineHeight: 16, marginTop: 10 },
  usage: { fontFamily: "Inter_400Regular", fontSize: 10, lineHeight: 15, marginTop: 12 },
  noSideEffects: { fontFamily: "Inter_400Regular", fontSize: 10, lineHeight: 15, marginTop: 8 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 22 },
  reviewCard: { width: "100%", maxWidth: 440, borderWidth: 1, borderRadius: 22, padding: 20 },
  reviewEyebrow: { fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, letterSpacing: 1.1 },
  reviewTitle: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 22, marginTop: 8 },
  reviewBody: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, marginTop: 12 },
  reviewLabel: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 16, marginBottom: 6 },
  reviewCode: { fontFamily: "monospace", fontSize: 11, lineHeight: 16, padding: 10, borderRadius: 10 },
  reviewActions: { flexDirection: "row", justifyContent: "flex-end", gap: 20, marginTop: 20 },
  actionText: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 13, padding: 5 },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.78 },
});