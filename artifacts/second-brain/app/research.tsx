import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "@/context/AppContext";
import { useResearch } from "@/context/ResearchContext";
import { useColors } from "@/hooks/useColors";
import { isCapabilityActive } from "@/lib/privacyCapabilities";
import { validateResearchUrl } from "@/lib/research";

export default function ResearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings, privacyReady, privacyState, engineStatus } = useApp();
  const colors = useColors(settings.appearance);
  const {
    documents,
    selectedIds,
    setSelectedIds,
    pickDocuments,
    archiveDocument,
    deleteDocument,
    runResearch,
    cancelResearch,
    clearResult,
    answer,
    passages,
    busy,
    error,
    routeLabel,
    storageReady,
  } = useResearch();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"local" | "web">("local");
  const [webUrl, setWebUrl] = useState("");
  const [consentVisible, setConsentVisible] = useState(false);

  const activeDocuments = useMemo(
    () => documents.filter((document) => !document.archivedAt),
    [documents],
  );
  const archivedDocuments = useMemo(
    () => documents.filter((document) => Boolean(document.archivedAt)),
    [documents],
  );
  const webEnabled =
    privacyReady && isCapabilityActive(privacyState, "network.web-research");
  const selectedCount = selectedIds.filter((id) =>
    activeDocuments.some((document) => document.id === id),
  ).length;

  function toggleSelected(id: string) {
    setSelectedIds(
      selectedIds.includes(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id],
    );
  }

  async function submitLocal() {
    await runResearch(query, "local");
  }

  function requestWebConsent() {
    const validation = validateResearchUrl(webUrl);
    if (!validation.ok) return;
    setConsentVisible(true);
  }

  async function confirmWebResearch() {
    setConsentVisible(false);
    await runResearch(query, "web", webUrl);
  }

  function confirmDelete(id: string, name: string) {
    Alert.alert("Delete this source?", `${name} will be removed from the encrypted research library.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void deleteDocument(id) },
    ]);
  }

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
          paddingTop: Platform.OS === "web" && !insets.top ? 67 : 0,
          paddingBottom: Platform.OS === "web" && !insets.bottom ? 34 : 0,
        },
      ]}
    >
      <StatusBar style={colors.isDark ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable
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
            Research workspace
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
            local evidence first · no hidden browser
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.eyebrow, { color: colors.primary }]}>PRIVATE RESEARCH</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Ask from sources you choose.
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Files are indexed and stored in the encrypted local research library.
          Source text is treated as untrusted data, never as instructions.
        </Text>

        <View style={[styles.routeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.routeIcon, { backgroundColor: colors.accent }]}>
            <Feather name="shield" size={17} color={colors.accentForeground} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.routeTitle, { color: colors.cardForeground }]}>
              {mode === "local" ? "On-device research" : "Visible web research"}
            </Text>
            <Text style={[styles.routeBody, { color: colors.mutedForeground }]}>
              {mode === "local"
                ? "No network request. Demi reads only the selected active files."
                : "One public HTTPS URL, fetched only after you approve this request. The answer still runs on the on-device model."}
            </Text>
          </View>
        </View>

        <View style={styles.modeRow}>
          {(["local", "web"] as const).map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === option }}
              onPress={() => setMode(option)}
              style={[
                styles.modeButton,
                {
                  backgroundColor: mode === option ? colors.primary : colors.secondary,
                  borderColor: mode === option ? colors.primary : colors.border,
                },
              ]}
            >
              <Feather
                name={option === "local" ? "lock" : "globe"}
                size={14}
                color={mode === option ? colors.primaryForeground : colors.foreground}
              />
              <Text
                style={[
                  styles.modeText,
                  { color: mode === option ? colors.primaryForeground : colors.foreground },
                ]}
              >
                {option === "local" ? "Selected files" : "One web source"}
              </Text>
            </Pressable>
          ))}
        </View>

        {mode === "web" && (
          <View style={[styles.webCard, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
              Allowed source URL
            </Text>
            <TextInput
              accessibilityLabel="Allowed HTTPS source URL"
              value={webUrl}
              onChangeText={setWebUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://example.org/article"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            />
            <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
              Demi fetches this URL only. It will not follow links or send your
              local memories/profile to a remote model.
            </Text>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <View>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Local source library
            </Text>
            <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
              {selectedCount} selected · {activeDocuments.length} active · archived files are excluded
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add local research files"
            onPress={() => void pickDocuments()}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: colors.secondary },
              pressed && styles.pressed,
            ]}
          >
            <Feather name="plus" size={15} color={colors.primary} />
            <Text style={[styles.addText, { color: colors.primary }]}>Add</Text>
          </Pressable>
        </View>

        {activeDocuments.length === 0 ? (
          <View style={[styles.emptyCard, { borderColor: colors.border }]}>
            <Feather name="file-text" size={22} color={colors.primary} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No local sources yet
            </Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Add TXT, Markdown, CSV, or JSON files. Each file is bounded before
              it enters encrypted local storage.
            </Text>
          </View>
        ) : (
          activeDocuments.map((document) => {
            const selected = selectedIds.includes(document.id);
            return (
              <View
                key={document.id}
                style={[styles.sourceCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  onPress={() => toggleSelected(document.id)}
                  style={styles.sourceMain}
                >
                  <View
                    style={[
                      styles.checkbox,
                      {
                        backgroundColor: selected ? colors.primary : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    {selected && <Feather name="check" size={13} color={colors.primaryForeground} />}
                  </View>
                  <View style={styles.copy}>
                    <Text style={[styles.sourceName, { color: colors.cardForeground }]}>
                      {document.name}
                    </Text>
                    <Text style={[styles.sourceMeta, { color: colors.mutedForeground }]}>
                      {document.chunks.length} bounded passage{document.chunks.length === 1 ? "" : "s"} · on device
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.sourceActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Archive ${document.name}`}
                    onPress={() => void archiveDocument(document.id, true)}
                    style={styles.smallAction}
                  >
                    <Feather name="archive" size={15} color={colors.mutedForeground} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${document.name}`}
                    onPress={() => confirmDelete(document.id, document.name)}
                    style={styles.smallAction}
                  >
                    <Feather name="trash-2" size={15} color={colors.destructive} />
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
        {archivedDocuments.length > 0 && (
          <View style={styles.archivedSection}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Archived sources
            </Text>
            {archivedDocuments.map((document) => (
              <View
                key={document.id}
                style={[styles.archivedCard, { borderColor: colors.border }]}
              >
                <View style={styles.copy}>
                  <Text style={[styles.sourceName, { color: colors.foreground }]}>
                    {document.name}
                  </Text>
                  <Text style={[styles.sourceMeta, { color: colors.mutedForeground }]}>
                    excluded from retrieval until restored
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Restore ${document.name}`}
                  onPress={() => void archiveDocument(document.id, false)}
                  style={[styles.restoreButton, { backgroundColor: colors.secondary }]}
                >
                  <Text style={[styles.addText, { color: colors.primary }]}>Restore</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
          Research question
        </Text>
        <TextInput
          accessibilityLabel="Research question"
          value={query}
          onChangeText={setQuery}
          maxLength={500}
          multiline
          placeholder="Summarize, compare, extract a fact, or answer a question…"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.questionInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
        />

        {engineStatus !== "ready" && (
          <Text style={[styles.warning, { color: colors.mutedForeground }]}>
            Load an offline model in Settings before asking Demi to interpret evidence.
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={busy ? "Cancel research" : mode === "local" ? "Research selected files locally" : "Review web research consent"}
          onPress={() => {
            if (busy) {
              cancelResearch();
            } else if (mode === "local") {
              void submitLocal();
            } else {
              requestWebConsent();
            }
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: busy ? colors.secondary : colors.primary },
            pressed && styles.pressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.foreground} />
          ) : (
            <Feather name={mode === "local" ? "search" : "globe"} size={16} color={colors.primaryForeground} />
          )}
          <Text style={[styles.primaryButtonText, { color: busy ? colors.foreground : colors.primaryForeground }]}>
            {busy ? "Cancel research" : mode === "local" ? "Research locally" : "Review before fetching"}
          </Text>
        </Pressable>

        {!webEnabled && mode === "web" && (
          <Text style={[styles.warning, { color: colors.mutedForeground }]}>
            Web research is disabled by default. Enable “Opt-in web research” in
            Settings before approving a request.
          </Text>
        )}

        {error && (
          <View style={[styles.message, { backgroundColor: colors.secondary }]}>
            <Feather name="alert-circle" size={15} color={colors.destructive} />
            <Text style={[styles.messageText, { color: colors.foreground }]}>{error}</Text>
          </View>
        )}

        {answer && (
          <View style={[styles.answerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.answerHeader}>
              <View style={styles.copy}>
                <Text style={[styles.answerTitle, { color: colors.cardForeground }]}>
                  Demi&apos;s interpretation
                </Text>
                <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>
                  {routeLabel}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Forget this research result" onPress={clearResult}>
                <Feather name="x" size={17} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={[styles.answerText, { color: colors.cardForeground }]}>{answer}</Text>
            <Text style={[styles.evidenceTitle, { color: colors.foreground }]}>Evidence used</Text>
            {passages.length === 0 ? (
              <Text style={[styles.noEvidence, { color: colors.mutedForeground }]}>
                No matching source passage was found. This answer is not verified by a source.
              </Text>
            ) : (
              passages.map((passage, index) => (
                <View key={passage.id} style={[styles.evidence, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.evidenceSource, { color: colors.primary }]}>
                    Source {index + 1} · {passage.sourceName}
                  </Text>
                  <Text style={[styles.evidenceExcerpt, { color: colors.mutedForeground }]}>
                    {passage.excerpt}
                  </Text>
                  {passage.uri && (
                    <Text style={[styles.evidenceUri, { color: colors.mutedForeground }]}>{passage.uri}</Text>
                  )}
                </View>
              ))
            )}
            <Text style={[styles.retention, { color: colors.mutedForeground }]}>
              This result is kept only in the current app session. Forget it to
              remove it now; raw web content is never saved to the library.
            </Text>
          </View>
        )}

        {!storageReady && (
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Opening encrypted research storage…
          </Text>
        )}
      </ScrollView>

      <Modal
        visible={consentVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConsentVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.cardForeground }]}>
              Approve one web fetch?
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              Demi will fetch only this public HTTPS source:
            </Text>
            <Text style={[styles.modalUrl, { color: colors.foreground }]}>{webUrl}</Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              The page may be misleading or contain instructions. It will be
              treated as untrusted evidence. The fetched text is sent only to
              the on-device model for this answer and is not retained.
            </Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setConsentVisible(false)}>
                <Text style={[styles.actionText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => void confirmWebResearch()}>
                <Text style={[styles.actionText, { color: colors.primary }]}>Fetch this source</Text>
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
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 48, gap: 12 },
  eyebrow: { fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, letterSpacing: 1.4, marginBottom: 1 },
  title: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 29, lineHeight: 35, letterSpacing: -1 },
  body: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20, marginBottom: 8 },
  routeCard: { borderRadius: 15, borderWidth: 1, padding: 13, flexDirection: "row", gap: 10 },
  routeIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1 },
  routeTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  routeBody: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 3 },
  modeRow: { flexDirection: "row", gap: 8 },
  modeButton: { flex: 1, minHeight: 42, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  modeText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  webCard: { borderRadius: 13, padding: 12 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12, marginTop: 4, marginBottom: 6 },
  input: { minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, fontFamily: "Inter_400Regular", fontSize: 12 },
  helpText: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 7 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 7 },
  sectionTitle: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 16 },
  sectionHint: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 2 },
  addButton: { borderRadius: 10, minHeight: 34, paddingHorizontal: 10, flexDirection: "row", gap: 5, alignItems: "center" },
  addText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  emptyCard: { borderWidth: 1, borderRadius: 15, padding: 22, alignItems: "center" },
  emptyTitle: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 16, marginTop: 8 },
  emptyBody: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 5 },
  sourceCard: { borderRadius: 14, borderWidth: 1, padding: 11, flexDirection: "row", alignItems: "center" },
  sourceMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  checkbox: { width: 23, height: 23, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  sourceName: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  sourceMeta: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 3 },
  sourceActions: { flexDirection: "row", gap: 8, marginLeft: 8 },
  smallAction: { padding: 5 },
  archivedSection: { marginTop: 4, gap: 8 },
  archivedCard: { borderWidth: 1, borderRadius: 13, padding: 11, flexDirection: "row", alignItems: "center" },
  restoreButton: { borderRadius: 9, paddingHorizontal: 9, paddingVertical: 8 },
  questionInput: { minHeight: 84, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 11, fontFamily: "Inter_400Regular", fontSize: 13, textAlignVertical: "top" },
  warning: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16 },
  primaryButton: { minHeight: 47, borderRadius: 13, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, marginTop: 2 },
  primaryButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  message: { borderRadius: 12, padding: 11, flexDirection: "row", gap: 7 },
  messageText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16 },
  answerCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginTop: 3 },
  answerHeader: { flexDirection: "row", alignItems: "flex-start" },
  answerTitle: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 16 },
  routeLabel: { fontFamily: "Inter_400Regular", fontSize: 10, lineHeight: 15, marginTop: 3 },
  answerText: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20, marginTop: 12 },
  evidenceTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12, marginTop: 18, marginBottom: 7 },
  evidence: { borderRadius: 10, padding: 9, marginBottom: 7 },
  evidenceSource: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  evidenceExcerpt: { fontFamily: "Inter_400Regular", fontSize: 10, lineHeight: 15, marginTop: 4 },
  evidenceUri: { fontFamily: "Inter_400Regular", fontSize: 9, marginTop: 4 },
  noEvidence: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16 },
  retention: { fontFamily: "Inter_400Regular", fontSize: 10, lineHeight: 15, marginTop: 8 },
  loadingText: { fontFamily: "Inter_400Regular", fontSize: 11, textAlign: "center", marginTop: 6 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 24 },
  modalCard: { borderRadius: 17, borderWidth: 1, padding: 18 },
  modalTitle: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 18 },
  modalBody: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, marginTop: 10 },
  modalUrl: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 18, marginTop: 8 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 22, marginTop: 20 },
  actionText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  pressed: { opacity: 0.76 },
});