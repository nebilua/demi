import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "@/context/AppContext";
import { useTools } from "@/context/ToolContext";
import { useColors } from "@/hooks/useColors";

export default function DocumentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings } = useApp();
  const colors = useColors(settings.appearance);
  const {
    selectedDocument,
    documentResult,
    documentBusy,
    documentError,
    documentPreflight,
    pickDocument,
    transformDocument,
    clearDocument,
  } = useTools();
  const [instruction, setInstruction] = useState(
    "Summarize this document in concise bullet points.",
  );

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
          testID="documents-back"
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
            Local documents
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
            selected files stay on this device
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>
          Private tools
        </Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Work with a document.
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Demi reads only the file you choose through Android&apos;s picker. It
          does not upload the file or search other folders.
        </Text>

        <Pressable
          testID="pick-local-document"
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
            {selectedDocument ? "Choose another document" : "Choose a document"}
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
                  {selectedDocument.mimeType} · {selectedDocument.content.length.toLocaleString()} characters read locally
                </Text>
              </View>
              <Pressable
                testID="clear-local-document"
                accessibilityRole="button"
                accessibilityLabel="Remove selected document"
                onPress={clearDocument}
              >
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {documentPreflight && (
              <View style={[styles.preflight, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.preflightTitle, { color: colors.cardForeground }]}>
                  Before Demi runs this tool
                </Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  Source: {documentPreflight.source} · {documentPreflight.network}
                </Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  Scope: {documentPreflight.scope}
                </Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  Data label: {documentPreflight.sensitivity} · {documentPreflight.confirmation}
                </Text>
              </View>
            )}
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              What should Demi do?
            </Text>
            <TextInput
              testID="document-instruction"
              value={instruction}
              onChangeText={setInstruction}
              multiline
              maxLength={400}
              placeholder="Summarize, extract action items, rewrite…"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                {
                  color: colors.cardForeground,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            />
            <Pressable
              testID="transform-local-document"
              accessibilityRole="button"
              disabled={documentBusy}
              onPress={() => void transformDocument(instruction)}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: colors.primary },
                pressed && styles.pressed,
              ]}
            >
              {documentBusy ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="cpu" size={16} color={colors.primary} />
              )}
              <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>
                {documentBusy ? "Working on device…" : "Run locally"}
              </Text>
            </Pressable>
          </View>
        )}

        {documentError && (
          <View style={[styles.message, { backgroundColor: colors.secondary }]}>
            <Feather name="alert-circle" size={15} color={colors.destructive} />
            <Text style={[styles.messageText, { color: colors.foreground }]}>
              {documentError}
            </Text>
          </View>
        )}
        {documentResult && (
          <View style={[styles.result, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.resultTitle, { color: colors.cardForeground }]}>
              Local result
            </Text>
            <Text style={[styles.resultText, { color: colors.cardForeground }]}>
              {documentResult}
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    minHeight: 72,
    paddingHorizontal: 20,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: { flex: 1, alignItems: "center", marginHorizontal: 10 },
  headerSpacer: { width: 38 },
  headerTitle: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 17 },
  headerSubtitle: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 2 },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32 },
  eyebrow: {
    fontFamily: "SpaceGrotesk_700Bold",
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: 9,
  },
  title: {
    fontFamily: "SpaceGrotesk_600SemiBold",
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -1,
    marginBottom: 8,
  },
  body: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20, marginBottom: 22 },
  primaryButton: {
    borderRadius: 13,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  primaryButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  fileIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1 },
  fileName: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 3 },
  preflight: { borderRadius: 12, padding: 11, marginTop: 14 },
  preflightTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12, marginBottom: 3 },
  label: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 16, marginBottom: 7 },
  input: {
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlignVertical: "top",
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  secondaryButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  message: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, marginTop: 14 },
  messageText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  result: { borderRadius: 16, borderWidth: 1, padding: 14, marginTop: 14 },
  resultTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12, marginBottom: 8 },
  resultText: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20 },
  pressed: { opacity: 0.78 },
});