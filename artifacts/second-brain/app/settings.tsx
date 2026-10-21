import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { PersonalProfileEditor } from "@/components/PersonalProfileEditor";
import { useApp, useChat, type Appearance } from "@/context/AppContext";
import { useLocalDataTransfer } from "@/context/LocalDataTransferContext";
import { useColors } from "@/hooks/useColors";
import { formatBytes, RECOMMENDED_MODEL } from "@/lib/offlineLlm";
import type { LocalStorageUsage, StorageMetric } from "@/lib/localStorageUsage";
import { voiceMatchesLanguage } from "@/lib/offlineVoice";
import {
  CAPABILITY_DEFINITIONS,
  createDefaultPrivacyState,
  getCapabilityStatusLabel,
  isCapabilityActive,
  type CapabilityApproval,
  type CapabilityDefinition,
  type CapabilityId,
  type PrivacyState,
} from "@/lib/privacyCapabilities";
import { TOOL_REGISTRY } from "@/lib/toolRegistry";
import { getRuntimeDiagnostics, type RuntimeMetric } from "@/lib/runtimeDiagnostics";
import type { InferenceBenchmarkSummary } from "@/lib/modelBenchmark";

const appearanceOptions: { value: Appearance; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const speechRateOptions = [
  { value: 0.82, label: "Slower" },
  { value: 0.92, label: "Natural" },
  { value: 1.05, label: "Faster" },
];

const settingsCategories = [
  {
    id: "memory",
    title: "Memory",
    description: "Profile, saved memories, and conversation history",
    icon: "bookmark",
  },
  {
    id: "ui",
    title: "UI",
    description: "Appearance and interface preferences",
    icon: "sliders",
  },
  {
    id: "model",
    title: "Model",
    description: "On-device model setup and device storage",
    icon: "cpu",
  },
  {
    id: "voice",
    title: "Voice",
    description: "Offline speech setup and spoken reply preferences",
    icon: "volume-2",
  },
  {
    id: "permissions",
    title: "Advanced Permissions",
    description: "Network access, system permissions, and approvals",
    icon: "shield",
  },
] as const;

type SettingsCategory = (typeof settingsCategories)[number]["id"];

function SettingRow({
  icon,
  title,
  description,
  children,
  noBorder,
  compact = false,
  paddingBottom,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
  children: React.ReactNode;
  noBorder?: boolean;
  compact?: boolean;
  paddingBottom?: number;
}) {
  const { settings } = useApp();
  const colors = useColors(settings.appearance);

  return (
    <View
      style={[
        styles.settingRow,
        compact && styles.compactSettingRow,
        paddingBottom !== undefined && { paddingBottom },
        !noBorder && { borderBottomColor: colors.border, borderBottomWidth: 1 },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: colors.secondary }]}>
        <Feather name={icon} size={17} color={colors.primary} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
          {title}
        </Text>
        <Text
          style={[styles.rowDescription, { color: colors.mutedForeground }]}
        >
          {description}
        </Text>
      </View>
      {children}
    </View>
  );
}

function CollapsibleSection({
  sectionTestID,
  icon,
  title,
  summary,
  expanded,
  onToggle,
  children,
  compact = false,
}: {
  sectionTestID: string;
  icon: keyof typeof Feather.glyphMap;
  title: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  compact?: boolean;
}) {
  const { settings } = useApp();
  const colors = useColors(settings.appearance);

  return (
    <View
      style={[
        styles.collapsibleSection,
        compact && styles.compactCollapsibleSection,
      ]}
    >
      <Pressable
        testID={sectionTestID}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${expanded ? "collapse" : "expand"}`}
        accessibilityHint={
          expanded
            ? `Double tap to collapse ${title.toLowerCase()}.`
            : `Double tap to expand ${title.toLowerCase()}.`
        }
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.collapsibleHeader,
          { backgroundColor: colors.card, borderColor: colors.border },
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.rowIcon, { backgroundColor: colors.secondary }]}>
          <Feather name={icon} size={17} color={colors.primary} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
            {title}
          </Text>
          <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
            {summary}
          </Text>
        </View>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.mutedForeground}
        />
      </Pressable>
      {expanded && <View style={styles.collapsibleBody}>{children}</View>}
    </View>
  );
}

function formatStorageBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function storageMetricText(metric: StorageMetric | null | undefined) {
  if (!metric || metric.bytes === null) return "Unavailable";
  return `${formatStorageBytes(metric.bytes)}${metric.status === "estimated" ? " estimated" : ""}`;
}

function formatStorageUpdatedAt(timestamp: number | null | undefined) {
  if (typeof timestamp !== "number") return null;
  return new Date(timestamp).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PrivacyCapabilityRow({
  definition,
  grant,
  globalPause,
  onApprovalChange,
  colors,
}: {
  definition: CapabilityDefinition;
  grant: PrivacyState["capabilities"][CapabilityId];
  globalPause: boolean;
  onApprovalChange: (
    capabilityId: CapabilityId,
    approval: CapabilityApproval,
  ) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const app = useApp();
  const [androidPermission, setAndroidPermission] = useState("Checking");
  useEffect(() => {
    const refresh = async () => {
      if (Platform.OS !== "android") { setAndroidPermission("Android app only"); return; }
      const permission = definition.id === "local.voice-input"
        ? PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
        : definition.id === "local.notifications" && Number(Platform.Version) >= 33
          ? PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS : null;
      if (!permission) return;
      try { setAndroidPermission(await PermissionsAndroid.check(permission) ? "Allowed" : "Not allowed"); }
      catch { setAndroidPermission("Unavailable"); }
    };
    void refresh();
    if (Platform.OS !== "android") return;
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void refresh(); });
    return () => subscription.remove();
  }, [definition.id]);
  const isNetwork = definition.kind === "network";
  // No on-device contacts reader is implemented, so approval would grant nothing.
  const isUnavailable = definition.id === "local.contacts" || definition.id === "network.connectors";
  const isWebResearch = definition.id === "network.web-research";
  const canChange =
    !isUnavailable &&
    (!isNetwork ||
    definition.id === "network.model-download" ||
    definition.id === "network.connectors" ||
    definition.id === "network.web-research" ||
    definition.id === "network.remote-inference");
  const nextApproval: CapabilityApproval =
    grant.approval === "approved" ? "paused" : "approved";

  return (
    <View style={[styles.privacyCapabilityRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.rowIcon, { backgroundColor: colors.secondary }]}>
        <Feather
          name={isNetwork ? "globe" : definition.kind === "system" ? "shield" : "lock"}
          size={16}
          color={isNetwork ? colors.mutedForeground : colors.primary}
        />
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.privacyTitleLine}>
          <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
            {definition.name}
          </Text>
          <Text
            style={[
              styles.privacyStatus,
              {
                color:
                  grant.approval === "approved" && !globalPause
                    ? colors.primary
                    : colors.mutedForeground,
              },
            ]}
          >
            {isUnavailable
              ? "Unavailable"
              : globalPause
              ? "Paused globally"
              : `App: ${getCapabilityStatusLabel(grant)}`}
          </Text>
        </View>
        <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
          {definition.purpose}
        </Text>
        {isUnavailable && (
          <Text
            testID={`privacy-${definition.id}-unavailable`}
            style={[styles.privacyScope, { color: colors.mutedForeground }]}
          >
            {definition.id === "local.contacts" ? "Demi cannot read contacts in this build. App approval cannot enable it." : "No supported connector is connected in this build."}
          </Text>
        )}
        {(definition.id === "local.voice-input" || definition.id === "local.notifications") && <>
          <Text testID={`android-permission-${definition.id}`} style={[styles.privacyScope, { color: colors.mutedForeground }]}>Android permission: {androidPermission}</Text>
          {Platform.OS === "android" && androidPermission === "Not allowed" && <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}><Text style={[styles.privacyScope, { color: colors.primary }]}>Android app settings</Text></Pressable>}
        </>}
        {definition.id === "device.screen-access" && <Text style={[styles.privacyScope, { color: colors.mutedForeground }]}>Android Accessibility: {app.screenAccessStatus?.accessibility ?? "unavailable"} · Capture requires review and sharing.</Text>}
        {definition.id === "local.files" && <Text style={[styles.privacyScope, { color: colors.mutedForeground }]}>Android access: system picker for each selected file, not all storage.</Text>}
        <Pressable
          testID={`privacy-${definition.id}-details`}
          accessibilityRole="button"
          accessibilityState={{ expanded: showDetails }}
          accessibilityLabel={`${showDetails ? "Hide" : "Show"} ${definition.name} details`}
          onPress={() => setShowDetails((v) => !v)}
          style={({ pressed }) => [{ alignSelf: "flex-start", marginTop: 6 }, pressed && styles.pressed]}
        >
          <Text style={[styles.privacyScope, { color: colors.primary, marginTop: 0 }]}>
            {showDetails ? "Hide details" : "Details"}
          </Text>
        </Pressable>
        {showDetails && (<>
        <Text style={[styles.privacyScope, { color: colors.mutedForeground }]}>
          Scope: {definition.scope}
        </Text>
        <Text style={[styles.privacyScope, { color: colors.mutedForeground }]}>
          {isNetwork
            ? definition.id === "network.model-download"
              ? "Network: required · off by default · only the named model file is downloaded"
              : isWebResearch
                ? "Network: required · only one user-approved public URL is fetched"
                : definition.id === "network.remote-inference"
                  ? "Network: required · only after local failure or device limits · server-managed provider"
              : "Network: required · off by default · nothing leaves this device"
            : `Network: ${definition.networkUse === "never" ? "never" : "only with a future explicit approval"}`}
        </Text>
        <Text style={[styles.privacyScope, { color: colors.mutedForeground }]}>
          Approval duration:{" "}
          {grant.lifetime === "until-revoked"
            ? "until revoked"
            : grant.lifetime === "24-hours"
              ? "24 hours"
              : grant.lifetime === "7-days"
                ? "7 days"
                : "current session"}
          {definition.requiresDestructiveConfirmation
            ? " · destructive actions require confirmation"
            : ""}
        </Text>
        </>)}
        {canChange && (
          <View style={styles.privacyActions}>
            <Pressable
              testID={`privacy-${definition.id}-toggle`}
              accessibilityRole="button"
              accessibilityLabel={`${nextApproval === "approved" ? "Enable" : "Pause"} ${definition.name}`}
              onPress={() => onApprovalChange(definition.id, nextApproval)}
              style={({ pressed }) => [
                styles.privacyActionButton,
                { backgroundColor: colors.secondary },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.privacyActionText, { color: colors.foreground }]}>
                {nextApproval === "approved"
                  ? grant.approval === "revoked" || grant.approval === "expired"
                    ? "Enable"
                    : "Resume"
                  : "Pause"}
              </Text>
            </Pressable>
            {grant.approval !== "revoked" && (
              <Pressable
                testID={`privacy-${definition.id}-revoke`}
                accessibilityRole="button"
                accessibilityLabel={`Revoke ${definition.name}`}
                onPress={() => onApprovalChange(definition.id, "revoked")}
                style={({ pressed }) => [
                  styles.privacyActionButton,
                  { borderColor: colors.border, borderWidth: 1 },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.privacyActionText, { color: colors.destructive }]}>
                  Revoke
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function StorageUsageRow({
  label,
  detail,
  metric,
  colors,
}: {
  label: string;
  detail?: string;
  metric: StorageMetric | null | undefined;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.storageRow}>
      <View style={styles.rowCopy}>
        <Text
          style={[styles.storageRowLabel, { color: colors.cardForeground }]}
        >
          {label}
        </Text>
        {detail && (
          <Text
            style={[styles.storageRowDetail, { color: colors.mutedForeground }]}
          >
            {detail}
          </Text>
        )}
      </View>
      <Text style={[styles.storageRowValue, { color: colors.mutedForeground }]}>
        {storageMetricText(metric)}
      </Text>
    </View>
  );
}

function StorageUsageCard({
  usage,
  colors,
  onRefresh,
  onReclaim,
  isReclaiming,
  reclaimMessage,
  modelOperationInProgress,
  isRefreshing,
}: {
  usage: LocalStorageUsage | null;
  colors: ReturnType<typeof useColors>;
  onRefresh: () => void;
  onReclaim: () => void;
  isReclaiming: boolean;
  reclaimMessage: string | null;
  modelOperationInProgress: boolean;
  isRefreshing: boolean;
}) {
  const canReclaim =
    Platform.OS !== "web" &&
    !modelOperationInProgress &&
    usage?.reclaimableModels.bytes !== null &&
    (usage?.reclaimableModels.fileCount ?? 0) > 0;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.storageHeader}>
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
            Local storage
          </Text>
          <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
            {Platform.OS === "web"
              ? "Device storage measurements are available in the installed Android app."
              : usage
                ? usage.total.bytes === null
                  ? "Some local data could not be measured."
                  : `${formatStorageBytes(usage.total.bytes)} tracked on this device${usage.total.status === "estimated" ? " · some values estimated" : ""}`
                : "Checking app-managed storage..."}
          </Text>
        </View>
        <Pressable
          testID="refresh-storage-usage"
          accessibilityRole="button"
          accessibilityLabel={
            isRefreshing
              ? "Refreshing local storage usage"
              : "Refresh local storage usage"
          }
          accessibilityState={{ disabled: isRefreshing }}
          disabled={isRefreshing}
          onPress={onRefresh}
          style={({ pressed }) => [
            styles.refreshButton,
            { backgroundColor: colors.secondary },
            pressed && styles.pressed,
          ]}
        >
          {isRefreshing ? (
            <ActivityIndicator
              testID="storage-refresh-indicator"
              size="small"
              color={colors.foreground}
            />
          ) : (
            <Feather name="refresh-cw" size={15} color={colors.foreground} />
          )}
        </Pressable>
      </View>

      <>
          {usage && (
            <View style={styles.storageRows}>
              {formatStorageUpdatedAt(usage.measuredAt) && (
                <Text
                  testID="storage-usage-last-updated"
                  style={[
                    styles.storageLastUpdated,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Last updated locally{" "}
                  {formatStorageUpdatedAt(usage.measuredAt)}
                </Text>
              )}
              <StorageUsageRow
                label="Active model"
                metric={usage.activeModel}
                colors={colors}
              />
              <StorageUsageRow
                label="Reclaimable model files"
                detail={
                  usage.reclaimableModels.bytes === null
                    ? "Active model is never included"
                    : usage.reclaimableModels.fileCount === 0
                      ? "No inactive model files found"
                      : `${usage.reclaimableModels.fileCount} inactive file${usage.reclaimableModels.fileCount === 1 ? "" : "s"} · active model excluded`
                }
                metric={usage.reclaimableModels}
                colors={colors}
              />
              {canReclaim && usage && (
                <Pressable
                  testID="reclaim-model-files"
                  accessibilityRole="button"
                  accessibilityLabel="Reclaim inactive model files"
                  disabled={isReclaiming}
                  onPress={onReclaim}
                  style={({ pressed }) => [
                    styles.storageAction,
                    { borderColor: colors.border },
                    pressed && styles.pressed,
                  ]}
                >
                  {isReclaiming ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Feather name="trash-2" size={14} color={colors.primary} />
                  )}
                  <View style={styles.rowCopy}>
                    <Text
                      style={[
                        styles.storageActionTitle,
                        { color: colors.primary },
                      ]}
                    >
                      Reclaim inactive model files
                    </Text>
                    <Text
                      style={[
                        styles.storageRowDetail,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      Remove about{" "}
                      {formatStorageBytes(usage.reclaimableModels.bytes ?? 0)}{" "}
                      while keeping the active model and memories
                    </Text>
                  </View>
                  <Feather
                    name="chevron-right"
                    size={16}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              )}
              <StorageUsageRow
                label="Conversations"
                detail="Encrypted local record"
                metric={usage.conversations}
                colors={colors}
              />
              <StorageUsageRow
                label="Memories"
                detail="Encrypted local record"
                metric={usage.memories}
                colors={colors}
              />
              <StorageUsageRow
                label="Privacy & agent state"
                detail="Encrypted grants, traces, and audit events"
                metric={usage.privacyState}
                colors={colors}
              />
              <StorageUsageRow
                label="Settings & profile"
                detail="Local preferences and profile"
                metric={usage.settingsAndProfile}
                colors={colors}
              />
              <StorageUsageRow
                label="App files"
                detail="Files outside model storage"
                metric={usage.appFiles}
                colors={colors}
              />
              <StorageUsageRow
                label="Temporary files"
                detail="Cache files that the OS may reclaim"
                metric={usage.temporaryFiles}
                colors={colors}
              />
              <View
                style={[styles.storageDivider, { backgroundColor: colors.border }]}
              />
              <StorageUsageRow
                label="Free device storage"
                detail={
                  usage.freeDevice.bytes === null
                    ? "Unavailable in browser preview"
                    : "Reported by the device"
                }
                metric={usage.freeDevice}
                colors={colors}
              />
            </View>
          )}

          <Text style={[styles.storageNote, { color: colors.mutedForeground }]}>
            {Platform.OS === "web"
              ? "The browser preview does not report device disk usage or Android secure-store sizes. Use the installed Android app for those measurements."
              : "Secure-store values are estimates because Android encrypts them internally."}{" "}
            Inactive model files are identified only; this screen never deletes
            active models or saved memories.
          </Text>
          {reclaimMessage && (
            <Text
              style={[
                styles.storageNote,
                {
                  color: reclaimMessage.includes("could not")
                    ? colors.destructive
                    : colors.primary,
                },
              ]}
            >
              {reclaimMessage}
            </Text>
          )}
      </>
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
    privacyReady,
    privacyState,
    setCapabilityApproval,
    setGlobalPrivacyPause,
    clearPrivacyState,
    storageError,
    localModel,
    deviceCompatibility,
    engineStatus,
    engineError,
    runtimeDetails,
    voiceInputStatus,
    modelSetupStatus,
    voiceInputAvailable,
    voiceOutputAvailable,
    offlineVoices,
    offlineVoicesLoading,
    refreshOfflineVoices,
    voiceError,
    voiceSetupMessage,
    voiceSetupInProgress,
    voiceSelfTestResult,
    voiceSelfTestRunning,
    voiceSelfTestSpeechStatus,
    runVoiceSelfTest,
    stopVoiceSelfTest,
    playVoiceSelfTestSample,
    stopVoiceSelfTestSample,
    importModel,
    downloadRecommendedModel,
    cancelDownload,
    downloadStatus,
    downloadProgress,
    downloadError,
    removeModel,
    prepareBundledVoiceModels,
    dismissVoiceError,
    storageUsage,
    storageUsageRefreshing,
    refreshStorageUsage,
    reclaimUnusedModelFiles,
  } = useApp();
  const { clearConversation, benchmarkLocalModel } = useChat();
  const {
    status: localDataTransferStatus,
    message: localDataTransferMessage,
    importSummary: localDataImportSummary,
    exportLocalData,
    chooseImportFile,
    confirmImport,
    cancelTransfer,
  } = useLocalDataTransfer();
  const colors = useColors(settings.appearance);
  const insets = useSafeAreaInsets();

  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showReclaimConfirm, setShowReclaimConfirm] = useState(false);
  const [isReclaimingModels, setIsReclaimingModels] = useState(false);
  const [showRemoveModelConfirm, setShowRemoveModelConfirm] = useState(false);
  const [showModelDownloadConfirm, setShowModelDownloadConfirm] =
    useState(false);
  const [modelDownloadAuthorizationPending, setModelDownloadAuthorizationPending] =
    useState(false);
  const [modelDownloadApprovalError, setModelDownloadApprovalError] =
    useState<string | null>(null);
  const [modelReclaimMessage, setModelReclaimMessage] = useState<string | null>(
    null,
  );
  const [showPrivacyClearConfirm, setShowPrivacyClearConfirm] = useState(false);
  const [isClearingPrivacy, setIsClearingPrivacy] = useState(false);
  const [privacyDetailsExpanded, setPrivacyDetailsExpanded] = useState(false);
  const [showRuntimeDiagnostics, setShowRuntimeDiagnostics] = useState(false);
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetric[]>([]);
  const [isModelBenchmarking, setIsModelBenchmarking] = useState(false);
  const [modelBenchmarkResult, setModelBenchmarkResult] =
    useState<InferenceBenchmarkSummary | null>(null);
  const [modelBenchmarkError, setModelBenchmarkError] = useState<string | null>(
    null,
  );
  const [activeCategory, setActiveCategory] = useState<SettingsCategory | null>(
    null,
  );
  const [deviceFootprintExpanded, setDeviceFootprintExpanded] = useState(false);
  const [offlineSetupExpanded, setOfflineSetupExpanded] = useState(false);
  const [localVoiceExpanded, setLocalVoiceExpanded] = useState(false);
  const [localRecoveryExpanded, setLocalRecoveryExpanded] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const safePrivacyState = privacyState ?? createDefaultPrivacyState(0);

  useEffect(() => {
    if (
      !modelDownloadAuthorizationPending ||
      !isCapabilityActive(privacyState, "network.model-download")
    ) {
      return;
    }
    setModelDownloadAuthorizationPending(false);
    void downloadRecommendedModel();
  }, [
    downloadRecommendedModel,
    modelDownloadAuthorizationPending,
    privacyState,
  ]);

  const canSetupSpeech =
    Platform.OS === "android" &&
    voiceInputStatus === "needs-model" &&
    !voiceSetupInProgress;
  const canSetupSpokenReplies =
    Platform.OS === "android" &&
    !voiceOutputAvailable &&
    !voiceSetupInProgress;
  const matchingOfflineVoices = offlineVoices.filter((voice) =>
    voiceMatchesLanguage(voice.language, settings.voiceLanguage),
  );
  const selectedVoiceIsInstalled = matchingOfflineVoices.some(
    (voice) => voice.id === settings.preferredVoiceId,
  );
  const modelStatusMessage =
    engineStatus === "unsupported"
      ? "Use the installed Android app for local replies."
      : engineStatus === "no-model"
        ? "Import or download a model in Model setup & diagnostics."
        : engineStatus === "loading"
          ? "Keep Demi open until loading finishes."
          : engineStatus === "error"
            ? "Retry setup or import a smaller model."
            : "Replies run on this device.";
  const modelStatusColor =
    engineStatus === "ready"
      ? colors.primary
      : engineStatus === "error"
        ? colors.destructive
        : colors.mutedForeground;

  async function handleClearHistory() {
    setIsClearing(true);
    try {
      await clearConversation();
      setShowClearConfirm(false);
    } catch {
      // Keep the confirmation open so a failed clear is not reported as success.
    } finally {
      setIsClearing(false);
    }
  }

  async function handleRemoveModel() {
    try {
      await removeModel();
      setShowRemoveModelConfirm(false);
    } catch {
      // Keep the confirmation open so a failed removal is not reported as success.
    }
  }

  function requestRecommendedDownload() {
    setModelDownloadApprovalError(null);
    if (!privacyReady) {
      setModelDownloadApprovalError(
        "Privacy settings are still opening. Try again in a moment.",
      );
      return;
    }
    if (safePrivacyState.globalPause) {
      setModelDownloadApprovalError(
        "Privacy pause is active. Resume approved actions in Advanced Permissions before downloading a model.",
      );
      return;
    }
    if (isCapabilityActive(privacyState, "network.model-download")) {
      void downloadRecommendedModel();
      return;
    }
    setShowModelDownloadConfirm(true);
  }

  async function confirmModelDownloadApproval() {
    if (!privacyReady || !setCapabilityApproval) {
      setModelDownloadApprovalError(
        "The local approval could not be saved. Try again when privacy settings are ready.",
      );
      return;
    }
    if (safePrivacyState.globalPause) {
      setModelDownloadApprovalError(
        "Privacy pause is active. Resume approved actions in Advanced Permissions before downloading a model.",
      );
      return;
    }
    try {
      await setCapabilityApproval("network.model-download", "approved");
      setModelDownloadAuthorizationPending(true);
      setShowModelDownloadConfirm(false);
    } catch {
      setModelDownloadApprovalError(
        "The download approval could not be saved on this device. No model download was started.",
      );
    }
  }

  async function handleReclaimModels() {
    if (
      !storageUsage ||
      storageUsage.reclaimableModels.bytes === null ||
      storageUsage.reclaimableModels.fileCount === 0
    ) {
      return;
    }

    setIsReclaimingModels(true);
    setModelReclaimMessage(null);
    try {
      const result = await reclaimUnusedModelFiles();
      refreshStorageUsage();
      if (result.status === "unavailable") {
        setModelReclaimMessage(
          result.deletedFiles > 0
            ? `Removed ${result.deletedFiles} file${result.deletedFiles === 1 ? "" : "s"} before the model folder became unavailable. Remaining files were not confirmed; try again later.`
            : "Demi could not inspect the model folder. No files were confirmed as removed; try again later.",
        );
        return;
      }
      if (result.failedFiles > 0) {
        setModelReclaimMessage(
          `Removed ${result.deletedFiles} file${result.deletedFiles === 1 ? "" : "s"}; ${result.failedFiles} could not be removed. Try again.`,
        );
        return;
      }
      setShowReclaimConfirm(false);
      setModelReclaimMessage(
        `Removed ${result.deletedFiles} inactive model file${result.deletedFiles === 1 ? "" : "s"}. The active model and memories were kept.`,
      );
    } catch {
      setModelReclaimMessage(
        "Inactive model files could not be reclaimed. Nothing else was changed; try again.",
      );
    } finally {
      setIsReclaimingModels(false);
    }
  }

  async function handleClearPrivacyState() {
    setIsClearingPrivacy(true);
    try {
      await clearPrivacyState?.();
      setShowPrivacyClearConfirm(false);
    } catch {
      // Keep the confirmation open so a failed clear is not reported as success.
    } finally {
      setIsClearingPrivacy(false);
    }
  }

  async function runModelSpeedTest() {
    if (isModelBenchmarking || engineStatus !== "ready") return;
    setIsModelBenchmarking(true);
    setModelBenchmarkError(null);
    setModelBenchmarkResult(null);
    try {
      const result = await benchmarkLocalModel();
      setModelBenchmarkResult(result);
      setRuntimeMetrics(
        getRuntimeDiagnostics()
          .filter((metric) =>
            ["inference.load", "inference.completion", "inference.failure"].includes(
              metric.name,
            ),
          )
          .slice(-6)
          .reverse(),
      );
    } catch (error) {
      setModelBenchmarkError(
        error instanceof Error
          ? error.message
          : "The local model speed test did not finish.",
      );
    } finally {
      setIsModelBenchmarking(false);
    }
  }

  if (!settingsReady) {
    return (
      <View
        style={[styles.loadingScreen, { backgroundColor: colors.background }]}
      >
        <StatusBar style={colors.isDark ? "light" : "dark"} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <StatusBar style={colors.isDark ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable
          testID="settings-back"
          accessibilityRole="button"
          accessibilityLabel={
            "Go back"
          }
          onPress={() => router.canGoBack?.() ? router.back() : router.replace("/")}
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: colors.secondary },
            pressed && styles.pressed,
          ]}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>
        {activeCategory === "permissions" ? null : (
          <Text
            testID="settings-header-title"
            style={[styles.headerTitle, { color: colors.foreground }]}
          >
            {activeCategory
              ? settingsCategories.find(
                  (category) => category.id === activeCategory,
                )?.title
              : "Settings"}
          </Text>
        )}
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(28, insets.bottom + 28) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {!activeCategory ? (
          <View style={styles.categoryList}>
            {settingsCategories.map((category) => (
              <Pressable
                key={category.id}
                testID={`settings-category-${category.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Open ${category.title} settings`}
                onPress={() => setActiveCategory(category.id)}
                style={({ pressed }) => [
                  styles.categoryEntry,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
                  <Feather
                    name={category.icon}
                    size={17}
                    color={colors.accentForeground}
                  />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
                    {category.title}
                  </Text>
                  <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                    {category.description}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        ) : (
          <>
            <Pressable
              testID="settings-browse-categories"
              accessibilityRole="button"
              accessibilityLabel="Browse settings categories"
              onPress={() => setActiveCategory(null)}
              style={({ pressed }) => [
                styles.categoryBrowse,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="grid" size={14} color={colors.primary} />
              <Text style={[styles.categoryBrowseText, { color: colors.primary }]}>
                Browse categories
              </Text>
            </Pressable>
        {storageError && (
          <View
            style={[styles.errorBanner, { backgroundColor: colors.secondary }]}
          >
            <Feather name="alert-circle" size={14} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.foreground }]}>
              {storageError}
            </Text>
          </View>
        )}
          </>
        )}
        {activeCategory === "voice" && (
        <View
          testID="voice-controls-card"
          style={[
            styles.card,
            styles.voiceControlsCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <SettingRow
            icon="mic"
            title="Voice input"
            description="Dictate locally with the bundled model"
            compact
          >
            <Switch
              testID="voice-input-setting"
              accessibilityRole="switch"
              accessibilityLabel="Voice input"
              accessibilityHint="Turn offline dictation on or off."
              accessibilityState={{ checked: settings.voiceInputEnabled }}
              value={settings.voiceInputEnabled}
              onValueChange={(v) => updateSettings({ voiceInputEnabled: v })}
              trackColor={{ false: colors.secondary, true: colors.accent }}
              thumbColor={
                settings.voiceInputEnabled
                  ? colors.accentForeground
                  : colors.mutedForeground
              }
            />
          </SettingRow>
          <SettingRow
            icon="volume-2"
            title="Spoken replies"
            description="Read replies aloud with the bundled voice"
            compact
            paddingBottom={16}
          >
            <Switch
              testID="spoken-replies-setting"
              accessibilityRole="switch"
              accessibilityLabel="Spoken replies"
              accessibilityHint="Turn spoken replies on or off."
              accessibilityState={{ checked: settings.spokenRepliesEnabled }}
              value={settings.spokenRepliesEnabled}
              onValueChange={(v) => updateSettings({ spokenRepliesEnabled: v })}
              trackColor={{ false: colors.secondary, true: colors.accent }}
              thumbColor={
                settings.spokenRepliesEnabled
                  ? colors.accentForeground
                  : colors.mutedForeground
              }
            />
          </SettingRow>
        </View>
        )}
        {activeCategory === "ui" && (
        <View
          style={[
            styles.appearanceCard,
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.rowTitle, { color: colors.cardForeground, marginBottom: 10 }]}>
            Appearance
          </Text>
          <View style={[styles.segmented, { backgroundColor: colors.secondary }]}>
            {appearanceOptions.map((option) => (
              <Pressable
                key={option.value}
                testID={`appearance-option-${option.value}`}
                accessibilityRole="radio"
                accessibilityLabel={`${option.label} appearance`}
                accessibilityHint="Choose how Demi looks."
                accessibilityState={{ selected: settings.appearance === option.value }}
                onPress={() => updateSettings({ appearance: option.value })}
                style={[
                  styles.segment,
                  settings.appearance === option.value && {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    {
                      color:
                        settings.appearance === option.value
                          ? colors.cardForeground
                          : colors.mutedForeground,
                    },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        )}
        {activeCategory === "permissions" && (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.privacyPauseRow}>
            <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
              <Feather
                name={safePrivacyState.globalPause ? "pause-circle" : "shield"}
                size={17}
                color={safePrivacyState.globalPause ? colors.destructive : colors.primary}
              />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
                Pause approved actions
              </Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Pause approved local and network actions until resumed.
              </Text>
            </View>
            <Switch
              testID="privacy-global-pause"
              accessibilityRole="switch"
              accessibilityLabel="Pause approved actions"
              accessibilityHint="Pause approved local and network actions until resumed."
              accessibilityState={{ checked: safePrivacyState.globalPause }}
              value={safePrivacyState.globalPause}
              onValueChange={(value) => void setGlobalPrivacyPause?.(value)}
              trackColor={{ false: colors.secondary, true: colors.accent }}
              thumbColor={
                safePrivacyState.globalPause
                  ? colors.accentForeground
                  : colors.mutedForeground
              }
            />
          </View>
        </View>
        )}

        {activeCategory === "model" && (
        <View
          testID="model-status-summary"
          style={[
            styles.modelStatusSummary,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
            <Feather
              name="cpu"
              size={17}
              color={engineStatus === "ready" ? colors.primary : colors.mutedForeground}
            />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
              Local model
            </Text>
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.rowDescription, { color: modelStatusColor }]}
            >
              {engineStatus === "ready"
                ? localModel?.name ?? "Ready for private replies"
                : engineStatus === "no-model"
                  ? "Not installed"
                  : engineStatus === "loading"
                    ? "Loading"
                    : engineStatus === "error"
                      ? "Needs attention"
                      : "Unavailable in browser preview"}
            </Text>
            <Text style={[styles.modelStatusDetail, { color: colors.mutedForeground }]}>
              {modelStatusMessage}
            </Text>
          </View>
        </View>
        )}

        {activeCategory === "memory" && (
        <View
          testID="memory-history-card"
          style={[
            styles.card,
            styles.memoryHistoryCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <SettingRow
            icon="save"
            title="Save history"
            description="Keep conversations on this device"
            noBorder
          >
            <Switch
              testID="save-history-setting"
              accessibilityRole="switch"
              accessibilityLabel="Save conversation history"
              accessibilityHint="Choose whether Demi keeps conversation history."
              accessibilityState={{ checked: settings.saveConversations }}
              value={settings.saveConversations}
              onValueChange={(v) => updateSettings({ saveConversations: v })}
              trackColor={{ false: colors.secondary, true: colors.accent }}
              thumbColor={
                settings.saveConversations
                  ? colors.accentForeground
                  : colors.mutedForeground
              }
            />
          </SettingRow>
          <Pressable
            testID="clear-conversation-history"
            accessibilityRole="button"
            accessibilityLabel="Clear conversation history"
            accessibilityHint="Review a confirmation before history is removed."
            onPress={() => setShowClearConfirm(true)}
            style={({ pressed }) => [
              styles.historyClearAction,
              { borderTopColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <Feather name="trash-2" size={16} color={colors.destructive} />
            <Text style={[styles.dangerText, { color: colors.destructive }]}>
              Clear conversation history
            </Text>
          </Pressable>
        </View>
        )}

        {activeCategory === "permissions" && (
        <CollapsibleSection
          sectionTestID="settings-group-privacy"
          icon="shield"
          title="Privacy & permissions"
          summary="Review access, recent activity, and local tool access"
          expanded={privacyDetailsExpanded}
          onToggle={() => setPrivacyDetailsExpanded((expanded) => !expanded)}
        >
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.privacyDisclosure, { color: colors.mutedForeground }]}>
            {privacyReady
              ? Platform.OS === "android"
                ? "Capability grants, connector references, schedules, tool traces, and audit events are kept in the Android encrypted local agent record."
                : "Capability grants, connector references, schedules, tool traces, and audit events are kept in local preview storage here; this preview does not have Android Keystore protection."
              : "Opening the encrypted local capability record..."}
          </Text>
          <Text style={[styles.privacyDisclosure, { color: colors.mutedForeground }]}>
            Android secure storage protects saved records at rest. It does not encrypt model prompts or transient process memory while Demi is running.
          </Text>
          {CAPABILITY_DEFINITIONS.filter(
            (definition) =>
              ![
                "network.model-download",
              ].some((excludedId) => excludedId === definition.id),
          ).map((definition) => (
            <PrivacyCapabilityRow
              key={definition.id}
              definition={definition}
              grant={safePrivacyState.capabilities[definition.id]}
              globalPause={safePrivacyState.globalPause}
              onApprovalChange={(capabilityId, approval) =>
                void setCapabilityApproval?.(capabilityId, approval).catch(() => undefined)
              }
              colors={colors}
            />
          ))}
          <Pressable
            testID="open-screen-access"
            accessibilityRole="button"
            onPress={() => router.push("/screen-access" as never)}
            style={({ pressed }) => [
              styles.privacyToolLink,
              { borderColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <Feather name="eye" size={15} color={colors.primary} />
            <View style={styles.rowCopy}>
              <Text style={[styles.privacyActionText, { color: colors.cardForeground }]}>
                Open permissioned screen access
              </Text>
              <Text style={[styles.privacyScope, { color: colors.mutedForeground }]}>
                Start a visible Android session with screenshot, accessibility, or one selected resource.
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            testID="open-local-documents"
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/documents" } as never)}
            style={({ pressed }) => [
              styles.privacyToolLink,
              { backgroundColor: colors.secondary },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
              <Feather name="file-text" size={16} color={colors.accentForeground} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
                Work with a selected document
              </Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Pick a text, Markdown, CSV, or JSON file and summarize or transform it locally.
              </Text>
            </View>
            <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            testID="open-sandbox-code-actions"
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/code-actions" } as never)}
            style={({ pressed }) => [
              styles.privacyToolLink,
              { backgroundColor: colors.secondary },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
              <Feather name="code" size={16} color={colors.accentForeground} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
                Sandboxed code actions
              </Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Run reviewed calculations or transformations on selected CSV and JSON files. Off by default; no writes or network.
              </Text>
            </View>
            <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            testID="open-private-research"
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/research" } as never)}
            style={({ pressed }) => [
              styles.privacyToolLink,
              { backgroundColor: colors.secondary },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
              <Feather name="search" size={16} color={colors.accentForeground} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
                Private research workspace
              </Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Ask questions over encrypted local files, with optional one-source web research.
              </Text>
            </View>
            <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
          </Pressable>
          <View style={styles.connectorHeader}>
            <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
              Optional network connectors
            </Text>
            <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
              Read-only by default. A connector must be connected separately, and every request shows its records, scope, and network status first.
            </Text>
          </View>
          {TOOL_REGISTRY.filter((tool) => tool.source === "connector").map((tool) => (
            <View key={tool.id} style={[styles.connectorRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.rowIcon, { backgroundColor: colors.secondary }]}>
                <Feather name="globe" size={16} color={colors.mutedForeground} />
              </View>
              <View style={styles.rowCopy}>
                <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
                  {tool.name}
                </Text>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                  {tool.description}
                </Text>
                <Text style={[styles.privacyScope, { color: colors.mutedForeground }]}>
                  Not connected · network required · no writes supported
                </Text>
              </View>
            </View>
          ))}
          <View style={styles.privacyHistoryHeader}>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
                Action history
              </Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Recent capability decisions are recorded without storing raw prompts or secrets.
              </Text>
            </View>
          </View>
          {safePrivacyState.auditEvents.length === 0 ? (
            <Text style={[styles.privacyEmpty, { color: colors.mutedForeground }]}>
              No privileged actions recorded yet.
            </Text>
          ) : (
            safePrivacyState.auditEvents
              .slice(-5)
              .reverse()
              .map((event) => (
                <View key={event.id} style={styles.privacyHistoryRow}>
                  <View style={styles.rowCopy}>
                    <Text style={[styles.privacyHistoryAction, { color: colors.cardForeground }]}>
                      {event.action}
                    </Text>
                    <Text style={[styles.privacyScope, { color: colors.mutedForeground }]}>
                      {event.summary}
                    </Text>
                  </View>
                  <Text style={[styles.privacyStatus, { color: colors.mutedForeground }]}>
                    {event.status}
                  </Text>
                </View>
              ))
          )}
          <View style={styles.privacyHistoryHeader}>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
                Tool activity
              </Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Tool calls show their source and result without retaining document text or secrets.
              </Text>
            </View>
          </View>
          {safePrivacyState.traces.length === 0 ? (
            <Text style={[styles.privacyEmpty, { color: colors.mutedForeground }]}>
              No local tool calls recorded yet.
            </Text>
          ) : (
            safePrivacyState.traces
              .slice(-5)
              .reverse()
              .map((trace) => (
                <View key={trace.id} style={styles.privacyHistoryRow}>
                  <View style={styles.rowCopy}>
                    <Text style={[styles.privacyHistoryAction, { color: colors.cardForeground }]}>
                      {trace.phase} · {trace.capabilityId}
                    </Text>
                    <Text style={[styles.privacyScope, { color: colors.mutedForeground }]}>
                      {trace.summary}
                    </Text>
                  </View>
                  <Text style={[styles.privacyStatus, { color: colors.mutedForeground }]}>
                    {trace.status}
                  </Text>
                </View>
              ))
          )}
          <Pressable
            testID="clear-privacy-state"
            accessibilityRole="button"
            onPress={() => setShowPrivacyClearConfirm(true)}
            style={({ pressed }) => [
              styles.privacyClearButton,
              { borderColor: colors.destructive },
              pressed && styles.pressed,
            ]}
          >
            <Feather name="trash-2" size={14} color={colors.destructive} />
            <Text style={[styles.privacyActionText, { color: colors.destructive }]}>
              Clear capability data
            </Text>
          </Pressable>
          <Text style={[styles.privacyDisclosure, { color: colors.mutedForeground }]}>
            Clearing removes saved grants, connector references, schedules, traces, and action history. Local-only defaults remain available; network capabilities stay off.
          </Text>
        </View>
        </CollapsibleSection>
        )}
        {activeCategory === "memory" && (
        <>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.profileSummary}>
            <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
              <Feather name="user" size={17} color={colors.primary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
                {profile.displayName ? profile.displayName : "No profile"}
              </Text>
              <Text
                style={[
                  styles.rowDescription,
                  { color: colors.mutedForeground },
                ]}
              >
                Personal context for offline replies
              </Text>
            </View>
            <Pressable
              onPress={() => setShowProfileEditor(true)}
              style={({ pressed }) => [
                styles.smallButton,
                { backgroundColor: colors.secondary },
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.smallButtonText,
                  { color: colors.secondaryForeground },
                ]}
              >
                Edit
              </Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          onPress={() => router.push("/memories" as any)}
          style={({ pressed }) => [
            styles.linkCard,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
            <Feather
              name="bookmark"
              size={17}
              color={colors.accentForeground}
            />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: colors.cardForeground }]}>
              Memory vault
            </Text>
            <Text
              style={[styles.rowDescription, { color: colors.mutedForeground }]}
            >
              {memories.length} saved
            </Text>
          </View>
          <Feather
            name="chevron-right"
            size={18}
            color={colors.mutedForeground}
          />
        </Pressable>
        </>
        )}

        {activeCategory === "model" && (
        <CollapsibleSection
          sectionTestID="settings-group-device-footprint"
          icon="hard-drive"
          title="Device storage"
          summary="Check local storage and inactive model files"
          expanded={deviceFootprintExpanded}
          onToggle={() => setDeviceFootprintExpanded((expanded) => !expanded)}
        >
          <StorageUsageCard
            usage={storageUsage}
            colors={colors}
            onRefresh={refreshStorageUsage}
            onReclaim={() => setShowReclaimConfirm(true)}
            isReclaiming={isReclaimingModels}
            reclaimMessage={modelReclaimMessage}
            isRefreshing={storageUsageRefreshing}
            modelOperationInProgress={
              modelSetupStatus !== "idle" ||
              (downloadStatus !== "idle" && downloadStatus !== "error")
            }
          />
        </CollapsibleSection>
        )}

        {activeCategory === "memory" && (
        <CollapsibleSection
          sectionTestID="settings-group-local-recovery"
          icon="download"
          title="Local recovery"
          summary="Export or replace the supported data stored on this device"
          expanded={localRecoveryExpanded}
          onToggle={() => setLocalRecoveryExpanded((expanded) => !expanded)}
        >
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.readinessDesc, { color: colors.mutedForeground }]}>
              Export creates a verified JSON package without uploading anything.
              It includes conversations, approved memories, your profile, important
              dates, research documents, and scheduled work.
            </Text>
            <Text
              style={[
                styles.readinessDesc,
                { color: colors.mutedForeground, marginTop: 8 },
              ]}
            >
              Model files, Android Keystore keys, privacy/audit records, notification
              registrations, credentials, and connector secrets are never included.
              Import replaces those supported categories only.
            </Text>
            <Text
              style={[
                styles.readinessDesc,
                { color: colors.destructive, marginTop: 8 },
              ]}
            >
              The export is not encrypted by Demi. Anyone with the file can read
              its contents, so store it somewhere you trust.
            </Text>
            <View style={styles.downloadActions}>
              <Pressable
                testID="export-local-data"
                accessibilityRole="button"
                accessibilityLabel="Export local data"
                disabled={localDataTransferStatus === "exporting" || localDataTransferStatus === "importing"}
                onPress={() => void exportLocalData()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.primary },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                  Export local data
                </Text>
              </Pressable>
              <Pressable
                testID="import-local-data"
                accessibilityRole="button"
                accessibilityLabel="Choose a local data export to import"
                disabled={localDataTransferStatus === "exporting" || localDataTransferStatus === "importing"}
                onPress={async () => {
                  await chooseImportFile();
                  setShowImportConfirm(true);
                }}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { borderColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>
                  Import package
                </Text>
              </Pressable>
            </View>
            {(localDataTransferStatus === "exporting" ||
              localDataTransferStatus === "importing") && (
              <View style={styles.transferStatus}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.readinessDesc, { color: colors.mutedForeground, flex: 1 }]}>
                  {localDataTransferMessage ?? "Working with local data…"}
                </Text>
                <Pressable
                  testID="cancel-local-data-transfer"
                  accessibilityRole="button"
                  accessibilityLabel="Cancel local data transfer"
                  onPress={cancelTransfer}
                  style={styles.modalButton}
                >
                  <Text style={[styles.modalButtonText, { color: colors.mutedForeground }]}>
                    Cancel
                  </Text>
                </Pressable>
              </View>
            )}
            {localDataTransferMessage &&
              localDataTransferStatus !== "exporting" &&
              localDataTransferStatus !== "importing" && (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.transferMessage,
                    {
                      color:
                        localDataTransferStatus === "error"
                          ? colors.destructive
                          : colors.mutedForeground,
                    },
                  ]}
                >
                  {localDataTransferMessage}
                </Text>
              )}
          </View>
        </CollapsibleSection>
        )}

        {activeCategory === "model" && (
        <CollapsibleSection
          sectionTestID="settings-group-offline-setup"
          icon="cpu"
          title="Model setup & diagnostics"
          summary="Install and manage the on-device model"
          expanded={offlineSetupExpanded}
          onToggle={() => setOfflineSetupExpanded((expanded) => !expanded)}
        >
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.readinessItem}>
            <View style={styles.readinessHeader}>
              <Feather
                name="cpu"
                size={16}
                color={localModel ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.readinessTitle,
                  { color: colors.cardForeground },
                ]}
              >
                Local model
              </Text>
              {localModel && (
                <Feather name="check-circle" size={14} color={colors.primary} />
              )}
            </View>
            <View
              style={[
                styles.diagnosticBox,
                { backgroundColor: colors.secondary },
              ]}
            >
              <Text
                style={[styles.diagnosticTitle, { color: modelStatusColor }]}
              >
                {engineStatus === "ready"
                  ? "Ready for private replies"
                  : "Setup status"}
              </Text>
              <Text
                style={[
                  styles.readinessDesc,
                  { color: colors.mutedForeground },
                ]}
              >
                {modelStatusMessage}
              </Text>
            </View>
            <View
              style={[
                styles.diagnosticBox,
                { backgroundColor: colors.secondary, marginTop: 8 },
              ]}
            >
              <Text
                style={[
                  styles.diagnosticTitle,
                  { color: colors.cardForeground },
                ]}
              >
                Device fit
              </Text>
              <Text
                style={[
                  styles.readinessDesc,
                  { color: colors.mutedForeground },
                ]}
              >
                {deviceCompatibility.architectureSupported
                  ? "Supported architecture"
                  : "Unsupported architecture"}{" "}
                · {deviceCompatibility.memoryLabel} · context{" "}
                {deviceCompatibility.contextSize}
              </Text>
              <Text
                style={[
                  styles.readinessDesc,
                  { color: colors.mutedForeground, marginTop: 4 },
                ]}
              >
                {deviceCompatibility.recommendation}
              </Text>
            </View>

            {!localModel &&
              (downloadStatus === "idle" || downloadStatus === "error") && (
                <View
                  style={[
                    styles.downloadBox,
                    { backgroundColor: colors.secondary },
                  ]}
                >
                  <Text
                    style={[
                      styles.downloadTitle,
                      { color: colors.cardForeground },
                    ]}
                  >
                    {RECOMMENDED_MODEL.name}
                  </Text>
                  <Text
                    style={[
                      styles.downloadMeta,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {formatBytes(RECOMMENDED_MODEL.sizeBytes)} ·{" "}
                    {RECOMMENDED_MODEL.license} · {RECOMMENDED_MODEL.source}
                  </Text>
                  <View style={styles.downloadActions}>
                    <Pressable
                      testID="download-recommended"
                      accessibilityRole="button"
                      accessibilityLabel="Download recommended model"
                      onPress={requestRecommendedDownload}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.primary },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.primaryButtonText,
                          { color: colors.primaryForeground },
                        ]}
                      >
                        {downloadStatus === "error"
                          ? "Retry download"
                          : "Download model"}
                      </Text>
                    </Pressable>
                    <Pressable
                      testID="import-model-manual"
                      accessibilityRole="button"
                      onPress={importModel}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        { borderColor: colors.border },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.secondaryButtonText,
                          { color: colors.foreground },
                        ]}
                      >
                        Import GGUF
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}

            {downloadStatus === "downloading" && (
              <View
                style={[
                  styles.downloadBox,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <Text
                  style={[
                    styles.downloadTitle,
                    { color: colors.cardForeground },
                  ]}
                >
                  Downloading...
                </Text>
                <View
                  style={[
                    styles.progressBar,
                    { backgroundColor: colors.secondary },
                  ]}
                >
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: colors.primary,
                        width: `${downloadProgress}%`,
                      },
                    ]}
                  />
                </View>
                <Pressable
                  testID="cancel-download"
                  accessibilityRole="button"
                  onPress={cancelDownload}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    { borderColor: colors.border, marginTop: 12 },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.secondaryButtonText,
                      { color: colors.foreground },
                    ]}
                  >
                    Cancel
                  </Text>
                </Pressable>
              </View>
            )}

            {(downloadStatus === "validating" ||
              downloadStatus === "loading" ||
              modelSetupStatus === "copying" ||
              modelSetupStatus === "loading" ||
              modelSetupStatus === "validating") && (
              <View
                style={[
                  styles.downloadBox,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <ActivityIndicator
                  color={colors.primary}
                  style={{ alignSelf: "flex-start" }}
                />
                <Text
                  style={[
                    styles.downloadMeta,
                    { color: colors.mutedForeground, marginTop: 8 },
                  ]}
                >
                  {downloadStatus === "validating"
                    ? "Validating checksum..."
                    : "Loading local model..."}
                </Text>
              </View>
            )}

            {localModel && (
              <View
                style={[
                  styles.downloadBox,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <Text
                  style={[
                    styles.downloadTitle,
                    { color: colors.cardForeground },
                  ]}
                >
                  {localModel.name}
                </Text>
                <Text
                  style={[
                    styles.downloadMeta,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {formatBytes(localModel.sizeBytes)} · Active
                </Text>
                <Text
                  style={[
                    styles.downloadMeta,
                    { color: colors.mutedForeground, marginTop: 5 },
                  ]}
                >
                  {deviceCompatibility.deviceName} ·{" "}
                  {deviceCompatibility.memoryLabel} · context{" "}
                  {deviceCompatibility.contextSize}
                </Text>
                {runtimeDetails && (
                  <Text
                    style={[
                      styles.downloadMeta,
                      { color: colors.mutedForeground, marginTop: 5 },
                    ]}
                  >
                    Runtime: {runtimeDetails.modelDescription} ·{" "}
                    {runtimeDetails.gpuEnabled ? "GPU enabled" : "CPU only"}
                  </Text>
                )}
                <Pressable
                  testID="remove-local-model"
                  accessibilityRole="button"
                  accessibilityLabel="Remove local model"
                  onPress={() => setShowRemoveModelConfirm(true)}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    { borderColor: colors.border, marginTop: 12 },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.secondaryButtonText,
                      { color: colors.destructive },
                    ]}
                  >
                    Remove model
                  </Text>
                </Pressable>
              </View>
            )}

            <Pressable testID="toggle-runtime-diagnostics" accessibilityRole="button" accessibilityState={{ expanded: showRuntimeDiagnostics }} onPress={() => {
              setShowRuntimeDiagnostics(!showRuntimeDiagnostics);
              setRuntimeMetrics(getRuntimeDiagnostics().filter(metric => ['inference.load', 'inference.completion', 'inference.failure'].includes(metric.name)).slice(-6).reverse());
            }} style={[styles.secondaryButton, { borderColor: colors.border }]}>
              <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>{showRuntimeDiagnostics ? "Hide diagnostics" : "Diagnostics"}</Text>
            </Pressable>
            {showRuntimeDiagnostics && <View style={[styles.diagnosticBox, { backgroundColor: colors.secondary, marginTop: 12 }]}>
              <Text style={[styles.readinessDesc, { color: colors.mutedForeground }]}>Local timings only. No prompts, model paths, or generated text are saved. The speed test uses a fixed prompt without your profile or memories, one warm-up, and three measured replies.</Text>
              <Pressable
                testID="run-local-model-speed-test"
                accessibilityRole="button"
                disabled={isModelBenchmarking || engineStatus !== "ready"}
                onPress={() => void runModelSpeedTest()}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  {
                    borderColor: colors.border,
                    marginTop: 10,
                    opacity:
                      isModelBenchmarking || engineStatus !== "ready" ? 0.5 : 1,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>
                  {isModelBenchmarking ? "Running local speed test…" : "Run local speed test"}
                </Text>
              </Pressable>
              {modelBenchmarkResult && (
                <Text style={[styles.readinessDesc, { color: colors.foreground, marginTop: 8 }]}>
                  Median of {modelBenchmarkResult.sampleCount}: first token {Math.round(modelBenchmarkResult.medianFirstTokenMs)} ms · {modelBenchmarkResult.medianTokensPerSecond.toFixed(1)} tokens/s · total {Math.round(modelBenchmarkResult.medianDurationMs)} ms.
                </Text>
              )}
              {modelBenchmarkError && (
                <Text style={[styles.readinessDesc, { color: colors.destructive, marginTop: 8 }]}>
                  {modelBenchmarkError}
                </Text>
              )}
              {runtimeMetrics.length === 0 && <Text style={[styles.readinessDesc, { color: colors.mutedForeground }]}>No native measurements in this session.</Text>}
              {runtimeMetrics.map((metric, index) => <Text key={`${metric.recordedAt}-${index}`} style={[styles.readinessDesc, { color: colors.foreground, marginTop: 8 }]}>
                {metric.name === 'inference.load' ? `Load: ${Math.round(metric.durationMs ?? 0)} ms · context ${metric.details?.contextTokens ?? "?"} · ${metric.details?.threads ?? "?"} CPU threads · batch ${metric.details?.batchSize ?? "?"} · GPU layers ${metric.details?.gpuLayers ?? "?"} · ${metric.details?.gpuEnabled ? "GPU active" : "CPU only"}` :
                  metric.name === 'inference.failure' ? `Stopped: ${metric.details?.category ?? "runtime"} · ${metric.details?.phase ?? "completion"} · ${metric.details?.durationMs ?? 0} ms` :
                    `First token: ${metric.details?.firstTokenMs ?? "?"} ms · ${Number(metric.details?.tokensPerSecond ?? 0).toFixed(1)} tokens/s · input ${metric.details?.inputTokens ?? "?"} · output reserve ${metric.details?.outputReserve ?? "?"}`}
              </Text>)}
              <Pressable accessibilityRole="button" onPress={() => setRuntimeMetrics(getRuntimeDiagnostics().filter(metric => ['inference.load', 'inference.completion', 'inference.failure'].includes(metric.name)).slice(-6).reverse())}>
                <Text style={[styles.privacyScope, { color: colors.primary }]}>Refresh</Text>
              </Pressable>
            </View>}

            {(modelDownloadApprovalError || downloadError || engineError) && (
              <Text
                style={[
                  styles.errorText,
                  { color: colors.destructive, marginTop: 8 },
                ]}
              >
                {modelDownloadApprovalError || downloadError || engineError}
              </Text>
            )}
          </View>
        </View>
        </CollapsibleSection>
        )}

        {activeCategory === "voice" && (
        <CollapsibleSection
          sectionTestID="settings-group-local-voice"
          icon="volume-2"
          title="Voice setup"
          summary="Readiness, tests, and preferences"
          expanded={localVoiceExpanded}
          onToggle={() => setLocalVoiceExpanded((expanded) => !expanded)}
          compact
        >
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View testID="voice-readiness" style={styles.readinessItem}>
            <View style={styles.readinessHeader}>
              <Feather
                name="mic"
                size={16}
                color={voiceInputAvailable ? colors.primary : colors.mutedForeground}
              />
              <Text style={[styles.readinessTitle, { color: colors.cardForeground }]}>
                Voice input
              </Text>
              {voiceInputAvailable && (
                <Feather name="check-circle" size={14} color={colors.primary} />
              )}
            </View>
            <Text style={[styles.readinessDesc, { color: colors.mutedForeground }]}>
              {voiceInputAvailable
                ? "Ready"
                : Platform.OS !== "android"
                  ? "Android app only"
                  : "Not prepared"}
            </Text>
            <View testID="offline-tts-setup" style={[styles.readinessHeader, { marginTop: 10 }]}>
              <Feather
                name="volume-2"
                size={16}
                color={voiceOutputAvailable ? colors.primary : colors.mutedForeground}
              />
              <Text style={[styles.readinessTitle, { color: colors.cardForeground }]}>
                Spoken replies
              </Text>
              {voiceOutputAvailable && (
                <Feather name="check-circle" size={14} color={colors.primary} />
              )}
            </View>
            <Text style={[styles.readinessDesc, { color: colors.mutedForeground }]}>
              {voiceOutputAvailable
                ? "Ready"
                : Platform.OS !== "android"
                  ? "Android app only"
                  : "Not prepared"}
            </Text>
            {(canSetupSpeech || canSetupSpokenReplies || voiceSetupInProgress) && (
              <Pressable
                testID="offline-speech-setup"
                accessibilityRole="button"
                accessibilityLabel="Prepare bundled offline voice"
                accessibilityState={{ disabled: voiceSetupInProgress }}
                disabled={voiceSetupInProgress}
                onPress={() => void prepareBundledVoiceModels()}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { borderColor: colors.border, marginTop: 12 },
                  pressed && styles.pressed,
                ]}
              >
                {voiceSetupInProgress ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[styles.secondaryButtonText, { color: colors.cardForeground }]}>
                    Prepare voice
                  </Text>
                )}
              </Pressable>
            )}
          </View>

          <View style={[styles.voicePicker, { borderTopColor: colors.border }]}>
            <View style={styles.voicePickerHeader}>
              <View style={styles.rowCopy}>
                <Text
                  style={[
                    styles.readinessTitle,
                    { color: colors.cardForeground },
                  ]}
                >
                  Bundled English voice
                </Text>
                <Text
                  style={[
                    styles.readinessDesc,
                    { color: colors.mutedForeground },
                  ]}
                >
                  The app includes one US English voice; it works without Android speech services.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh bundled offline voice"
                onPress={() => void refreshOfflineVoices()}
                style={({ pressed }) => [
                  styles.refreshButton,
                  { backgroundColor: colors.secondary },
                  pressed && styles.pressed,
                ]}
              >
                <Feather
                  name="refresh-cw"
                  size={15}
                  color={colors.foreground}
                />
              </Pressable>
            </View>

            {offlineVoicesLoading ? (
              <View style={styles.voiceLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text
                  style={[styles.voiceMeta, { color: colors.mutedForeground }]}
                >
                  Checking bundled offline voice...
                </Text>
              </View>
            ) : matchingOfflineVoices.length === 0 ? (
              <Text
                style={[styles.voiceMeta, { color: colors.mutedForeground }]}
              >
                {Platform.OS !== "android"
                  ? "The bundled voice is available in the installed Android app."
                  : "The bundled English voice is not ready. Use Prepare voice above."}
              </Text>
            ) : (
              <View style={styles.voiceOptions}>
                <Pressable
                  testID="voice-option-automatic"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: !selectedVoiceIsInstalled }}
                  onPress={() =>
                    void updateSettings({ preferredVoiceId: null })
                  }
                  style={({ pressed }) => [
                    styles.voiceOption,
                    {
                      borderColor: !selectedVoiceIsInstalled
                        ? colors.primary
                        : colors.border,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.voiceOptionCopy}>
                    <Text
                      style={[
                        styles.voiceOptionTitle,
                        { color: colors.cardForeground },
                      ]}
                    >
                      Automatic
                    </Text>
                    <Text
                      style={[
                        styles.voiceMeta,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      Match the reply language
                    </Text>
                  </View>
                  {!selectedVoiceIsInstalled && (
                    <Feather
                      name="check-circle"
                      size={17}
                      color={colors.primary}
                    />
                  )}
                </Pressable>

                {matchingOfflineVoices.map((voice) => {
                  const selected = settings.preferredVoiceId === voice.id;
                  return (
                    <Pressable
                      key={voice.id}
                      testID={`voice-option-${voice.id}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() =>
                        void updateSettings({ preferredVoiceId: voice.id })
                      }
                      style={({ pressed }) => [
                        styles.voiceOption,
                        {
                          borderColor: selected
                            ? colors.primary
                            : colors.border,
                        },
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.voiceOptionCopy}>
                        <Text
                          style={[
                            styles.voiceOptionTitle,
                            { color: colors.cardForeground },
                          ]}
                        >
                          {voice.name}
                        </Text>
                        <Text
                          style={[
                            styles.voiceMeta,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {voice.language} · {voice.id}
                        </Text>
                      </View>
                      {selected && (
                        <Feather
                          name="check-circle"
                          size={17}
                          color={colors.primary}
                        />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
          {(voiceError || voiceSetupMessage) && (
            <View
              accessibilityLiveRegion="polite"
              accessibilityRole={voiceError ? "alert" : "text"}
              style={styles.voiceStatusMessage}
            >
              <Text
                style={[
                  styles.errorText,
                  {
                    color: voiceError
                      ? colors.destructive
                      : colors.mutedForeground,
                    marginTop: 10,
                  },
                ]}
              >
                {voiceError || voiceSetupMessage}
              </Text>
              {voiceError && (
                <Pressable
                  testID="refresh-offline-voice-status"
                  accessibilityRole="button"
                  accessibilityLabel="Retry offline voice checks"
                  onPress={() => {
                    dismissVoiceError();
                    if (voiceInputStatus === "needs-model") {
                      void prepareBundledVoiceModels();
                    } else {
                      void refreshOfflineVoices();
                    }
                  }}
                  style={({ pressed }) => [
                    styles.voiceRetryButton,
                    { borderColor: colors.border },
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="refresh-cw" size={14} color={colors.primary} />
                  <Text
                    style={[
                      styles.voiceRetryText,
                      { color: colors.primary },
                    ]}
                  >
                    Retry voice checks
                  </Text>
                </Pressable>
              )}
            </View>
          )}
          {voiceInputStatus === "needs-model" &&
            !voiceError &&
            !voiceSetupMessage && (
              <Text
                style={[
                  styles.errorText,
                  { color: colors.destructive, marginTop: 10 },
                ]}
              >
                Bundled {settings.voiceLanguage} speech models are not ready.
                Use Prepare voice above.
              </Text>
            )}
          <View
            style={[
              styles.voiceSelfTest,
              { backgroundColor: colors.secondary },
            ]}
          >
            <View style={styles.voicePickerHeader}>
              <View style={styles.rowCopy}>
                <Text
                  style={[
                    styles.readinessTitle,
                    { color: colors.cardForeground },
                  ]}
                >
                  Voice self-test
                </Text>
                <Text
                  style={[styles.voiceMeta, { color: colors.mutedForeground }]}
                >
                  Check the microphone and play a short sample before relying on
                  voice controls.
                </Text>
              </View>
              <Feather name="shield" size={17} color={colors.primary} />
            </View>
            {Platform.OS !== "android" ? (
              <Text
                style={[
                  styles.voiceMeta,
                  { color: colors.mutedForeground, marginTop: 12 },
                ]}
              >
                Available in the installed Android app. The browser preview
                never requests microphone access or plays speech.
              </Text>
            ) : (
              <View style={styles.selfTestActions}>
                <Pressable
                  testID="voice-recognition-self-test"
                  accessibilityRole="button"
                  accessibilityLabel={
                    voiceSelfTestRunning
                      ? "Stop and transcribe microphone test"
                      : "Test microphone recognition"
                  }
                  onPress={() => {
                    if (voiceSelfTestRunning) stopVoiceSelfTest();
                    else void runVoiceSelfTest();
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: colors.primary, flex: 1 },
                    pressed && styles.pressed,
                  ]}
                >
                  {voiceSelfTestRunning ? (
                    <Text
                      style={[
                        styles.primaryButtonText,
                        { color: colors.primaryForeground },
                      ]}
                    >
                      Stop and transcribe
                    </Text>
                  ) : (
                    <Text
                      style={[
                        styles.primaryButtonText,
                        { color: colors.primaryForeground },
                      ]}
                    >
                      Test microphone
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  testID="voice-tts-self-test"
                  accessibilityRole="button"
                  accessibilityLabel={
                    voiceSelfTestSpeechStatus === "speaking"
                      ? "Stop local speech sample"
                      : "Play local speech sample"
                  }
                  onPress={() => {
                    if (voiceSelfTestSpeechStatus === "speaking") {
                      void stopVoiceSelfTestSample();
                    } else {
                      void playVoiceSelfTestSample();
                    }
                  }}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    { borderColor: colors.border, flex: 1 },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.secondaryButtonText,
                      { color: colors.cardForeground },
                    ]}
                  >
                    {voiceSelfTestSpeechStatus === "speaking"
                      ? "Stop sample"
                      : "Play sample"}
                  </Text>
                </Pressable>
              </View>
            )}
            {voiceSelfTestResult && (
              <View
                accessibilityLiveRegion="polite"
                style={[
                  styles.selfTestResult,
                  {
                    backgroundColor:
                      voiceSelfTestResult.outcome === "passed"
                        ? colors.background
                        : colors.card,
                  },
                ]}
              >
                <View style={styles.readinessHeader}>
                  <Feather
                    name={
                      voiceSelfTestResult.outcome === "passed"
                        ? "check-circle"
                        : voiceSelfTestResult.outcome === "running"
                          ? "loader"
                          : "alert-circle"
                    }
                    size={15}
                    color={
                      voiceSelfTestResult.outcome === "passed"
                        ? colors.primary
                        : voiceSelfTestResult.outcome === "running"
                          ? colors.mutedForeground
                          : colors.destructive
                    }
                  />
                  <Text
                    style={[
                      styles.voiceOptionTitle,
                      { color: colors.cardForeground },
                    ]}
                  >
                    {voiceSelfTestResult.title}
                  </Text>
                </View>
                <Text
                  style={[styles.voiceMeta, { color: colors.mutedForeground }]}
                >
                  {voiceSelfTestResult.detail}
                </Text>
                <Text
                  style={[
                    styles.selfTestNextAction,
                    { color: colors.cardForeground },
                  ]}
                >
                  Next: {voiceSelfTestResult.nextAction}
                </Text>
              </View>
            )}
          </View>
          <View
            style={[styles.voicePreferences, { borderTopColor: colors.border }]}
          >
            <Text
              style={[styles.readinessTitle, { color: colors.cardForeground }]}
            >
              Voice language
            </Text>
            <Text
              style={[
                styles.readinessDesc,
                { color: colors.mutedForeground, marginTop: 6 },
              ]}
            >
              English (US) is bundled with the Android app. Other speech languages are not included yet.
            </Text>
            <Text
              style={[
                styles.speechRateTitle,
                { color: colors.cardForeground, marginTop: 14 },
              ]}
            >
              Spoken reply speed
            </Text>
            <View
              style={[styles.segmented, { backgroundColor: colors.secondary }]}
            >
              {speechRateOptions.map((option) => (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: settings.speechRate === option.value,
                  }}
                  onPress={() =>
                    void updateSettings({ speechRate: option.value })
                  }
                  style={[
                    styles.segment,
                    settings.speechRate === option.value && {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      {
                        color:
                          settings.speechRate === option.value
                            ? colors.cardForeground
                            : colors.mutedForeground,
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
        </CollapsibleSection>
        )}

        {activeCategory === "ui" && (
        <View
          testID="haptic-feedback-card"
          style={[
            styles.card,
            styles.hapticsCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <SettingRow
            icon="smartphone"
            title="Haptic feedback"
            description="Light tap on send"
            noBorder
          >
            <Switch
              testID="haptic-feedback-setting"
              accessibilityRole="switch"
              accessibilityLabel="Haptic feedback"
              accessibilityHint="Turn light send feedback on or off."
              accessibilityState={{ checked: settings.hapticsEnabled }}
              value={settings.hapticsEnabled}
              onValueChange={(v) => updateSettings({ hapticsEnabled: v })}
              trackColor={{ false: colors.secondary, true: colors.accent }}
              thumbColor={
                settings.hapticsEnabled
                  ? colors.accentForeground
                  : colors.mutedForeground
              }
            />
          </SettingRow>
        </View>
        )}
      </ScrollView>

      <Modal
        visible={showClearConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowClearConfirm(false)}
      >
        <View
          style={[
            styles.modalBackdrop,
            {
              backgroundColor: colors.isDark
                ? "rgba(255,255,255,0.1)"
                : "rgba(0,0,0,0.5)",
            },
          ]}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.cardForeground }]}>
              Clear history?
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              This removes all past messages. Memories and settings are kept.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                testID="cancel-clear-conversation"
                accessibilityRole="button"
                accessibilityLabel="Cancel clearing conversation history"
                onPress={() => setShowClearConfirm(false)}
                style={styles.modalButton}
              >
                <Text
                  style={[
                    styles.modalButtonText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                testID="confirm-clear-conversation"
                accessibilityRole="button"
                accessibilityLabel="Confirm clear conversation history"
                onPress={handleClearHistory}
                style={styles.modalButton}
              >
                <Text
                  style={[
                    styles.modalButtonText,
                    { color: colors.destructive },
                  ]}
                >
                  Clear
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={
          showImportConfirm &&
          localDataTransferStatus === "awaiting-confirmation" &&
          localDataImportSummary !== null
        }
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowImportConfirm(false);
          cancelTransfer();
        }}
      >
        <View
          style={[
            styles.modalBackdrop,
            {
              backgroundColor: colors.isDark
                ? "rgba(255,255,255,0.1)"
                : "rgba(0,0,0,0.5)",
            },
          ]}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.cardForeground }]}>
              Replace local data?
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              This verified package will replace the supported local categories.
              Model files, privacy state, audit history, credentials, and device
              keys are not touched.
            </Text>
            {localDataImportSummary && (
              <Text style={[styles.modalBody, { color: colors.cardForeground }]}>
                {localDataImportSummary.conversations} conversations ·{" "}
                {localDataImportSummary.memories} memories ·{" "}
                {localDataImportSummary.importantDates} important dates ·{" "}
                {localDataImportSummary.research} research documents ·{" "}
                {localDataImportSummary.scheduledJobs} scheduled jobs
                {"\n"}Profile: {localDataImportSummary.profile ? "included" : "empty"} ·{" "}
                {localDataImportSummary.bytes.toLocaleString()} bytes verified
              </Text>
            )}
            <View style={styles.modalActions}>
              <Pressable
                testID="cancel-import-local-data"
                accessibilityRole="button"
                accessibilityLabel="Cancel local data import"
                onPress={() => {
                  setShowImportConfirm(false);
                  cancelTransfer();
                }}
                style={styles.modalButton}
              >
                <Text style={[styles.modalButtonText, { color: colors.mutedForeground }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                testID="confirm-import-local-data"
                accessibilityRole="button"
                accessibilityLabel="Confirm replace local data"
                onPress={() => {
                  setShowImportConfirm(false);
                  void confirmImport();
                }}
                style={styles.modalButton}
              >
                <Text style={[styles.modalButtonText, { color: colors.primary }]}>
                  Replace
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showModelDownloadConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModelDownloadConfirm(false)}
      >
        <View
          style={[
            styles.modalBackdrop,
            {
              backgroundColor: colors.isDark
                ? "rgba(255,255,255,0.1)"
                : "rgba(0,0,0,0.5)",
            },
          ]}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.cardForeground }]}>
              Allow this model download?
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              Demi will connect to the model&apos;s published source to download
              only the recommended model file and verify its checksum. No
              conversations, memories, or profile information will be sent.
              This network approval lasts 24 hours.
            </Text>
            {modelDownloadApprovalError && (
              <Text style={[styles.modalBody, { color: colors.destructive }]}>
                {modelDownloadApprovalError}
              </Text>
            )}
            <View style={styles.modalActions}>
              <Pressable
                testID="cancel-model-download-approval"
                accessibilityRole="button"
                accessibilityLabel="Cancel model download approval"
                onPress={() => setShowModelDownloadConfirm(false)}
                style={styles.modalButton}
              >
                <Text
                  style={[
                    styles.modalButtonText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                testID="confirm-model-download-approval"
                accessibilityRole="button"
                accessibilityLabel="Approve and download model"
                onPress={() => void confirmModelDownloadApproval()}
                style={styles.modalButton}
              >
                <Text
                  style={[styles.modalButtonText, { color: colors.primary }]}
                >
                  Allow &amp; download
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showRemoveModelConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRemoveModelConfirm(false)}
      >
        <View
          style={[
            styles.modalBackdrop,
            {
              backgroundColor: colors.isDark
                ? "rgba(255,255,255,0.1)"
                : "rgba(0,0,0,0.5)",
            },
          ]}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.cardForeground }]}>
              Remove local model?
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              Remove {localModel?.name ?? "this model"} from this device. Saved
              conversations and memories will be kept.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                testID="cancel-remove-local-model"
                accessibilityRole="button"
                accessibilityLabel="Cancel removing local model"
                onPress={() => setShowRemoveModelConfirm(false)}
                style={styles.modalButton}
              >
                <Text
                  style={[
                    styles.modalButtonText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                testID="confirm-remove-local-model"
                accessibilityRole="button"
                accessibilityLabel="Confirm remove local model"
                onPress={() => void handleRemoveModel()}
                style={styles.modalButton}
              >
                <Text
                  style={[styles.modalButtonText, { color: colors.destructive }]}
                >
                  Remove
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showReclaimConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isReclaimingModels) setShowReclaimConfirm(false);
        }}
      >
        <View
          style={[
            styles.modalBackdrop,
            {
              backgroundColor: colors.isDark
                ? "rgba(255,255,255,0.1)"
                : "rgba(0,0,0,0.5)",
            },
          ]}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.cardForeground }]}>
              Reclaim inactive models?
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              Remove {storageUsage?.reclaimableModels.fileCount ?? 0} inactive
              model file
              {storageUsage?.reclaimableModels.fileCount === 1 ? "" : "s"}{" "}
              (about{" "}
              {formatStorageBytes(storageUsage?.reclaimableModels.bytes ?? 0)}).
              The active model and encrypted memories will be kept.
            </Text>
            {modelReclaimMessage && (
              <Text style={[styles.modalBody, { color: colors.destructive }]}>
                {modelReclaimMessage}
              </Text>
            )}
            <View style={styles.modalActions}>
              <Pressable
                testID="cancel-reclaim-model-files"
                disabled={isReclaimingModels}
                onPress={() => setShowReclaimConfirm(false)}
                style={styles.modalButton}
              >
                <Text
                  style={[
                    styles.modalButtonText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                testID="confirm-reclaim-model-files"
                disabled={isReclaimingModels}
                onPress={() => void handleReclaimModels()}
                style={styles.modalButton}
              >
                {isReclaimingModels ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text
                    style={[styles.modalButtonText, { color: colors.primary }]}
                  >
                    Reclaim
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showPrivacyClearConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isClearingPrivacy) setShowPrivacyClearConfirm(false);
        }}
      >
        <View
          style={[
            styles.modalBackdrop,
            {
              backgroundColor: colors.isDark
                ? "rgba(255,255,255,0.1)"
                : "rgba(0,0,0,0.5)",
            },
          ]}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.cardForeground }]}>
              Clear capability data?
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              This removes capability grants, connector references, schedules, tool traces, and action history from Demi&apos;s encrypted local record. It does not remove conversations, memories, or models. Network capabilities remain off.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                testID="cancel-clear-privacy-state"
                disabled={isClearingPrivacy}
                onPress={() => setShowPrivacyClearConfirm(false)}
                style={styles.modalButton}
              >
                <Text style={[styles.modalButtonText, { color: colors.mutedForeground }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                testID="confirm-clear-privacy-state"
                disabled={isClearingPrivacy}
                onPress={() => void handleClearPrivacyState()}
                style={styles.modalButton}
              >
                {isClearingPrivacy ? (
                  <ActivityIndicator size="small" color={colors.destructive} />
                ) : (
                  <Text style={[styles.modalButtonText, { color: colors.destructive }]}>
                    Clear
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <PersonalProfileEditor
        visible={showProfileEditor}
        mode="settings"
        onClose={() => setShowProfileEditor(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center" },
  screen: { flex: 1 },
  header: {
    height: 60,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 18 },
  headerSpacer: { width: 36 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 12 },
  categoryList: { gap: 10, paddingTop: 4 },
  categoryEntry: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  categoryBrowse: {
    minHeight: 32,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 4,
    marginBottom: 4,
  },
  categoryBrowseText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 12,
    marginBottom: 8,
  },
  errorText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 16,
  },
  diagnosticBox: { padding: 10, borderRadius: 10 },
  diagnosticTitle: {
    fontFamily: "SpaceGrotesk_600SemiBold",
    fontSize: 12,
    marginBottom: 3,
  },
  card: { borderWidth: 1, borderRadius: 20, padding: 16 },
  memoryHistoryCard: { marginBottom: 12 },
  appearanceCard: { marginTop: 0 },
  collapsibleSection: { marginTop: 20 },
  compactCollapsibleSection: { marginTop: 12 },
  collapsibleHeader: {
    minHeight: 68,
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  collapsibleBody: { marginTop: 8 },
  modelStatusSummary: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  modelStatusDetail: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },
  profileSummary: { flexDirection: "row", alignItems: "center" },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  rowCopy: { flex: 1, justifyContent: "center" },
  rowTitle: { fontFamily: "Inter_500Medium", fontSize: 15, marginBottom: 2 },
  rowDescription: { fontFamily: "Inter_400Regular", fontSize: 12 },
  privacyToolLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 13,
    padding: 10,
    marginTop: 10,
  },
  connectorHeader: { paddingTop: 18, paddingBottom: 8 },
  connectorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  smallButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  smallButtonText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  linkCard: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  storageHeader: { flexDirection: "row", alignItems: "center" },
  storageHeaderToggle: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  storageRows: { marginTop: 16, gap: 12 },
  storageRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  storageRowLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    marginBottom: 2,
  },
  storageRowDetail: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 15,
  },
  storageRowValue: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    textAlign: "right",
  },
  storageLastUpdated: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 15,
  },
  storageDivider: { height: 1, marginVertical: 2 },
  storageNote: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 16,
  },
  storageAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  storageActionTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    marginBottom: 2,
  },
  privacyPauseRow: { flexDirection: "row", alignItems: "center" },
  privacyDisclosure: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 12,
  },
  privacyCapabilityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  privacyTitleLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 2,
  },
  privacyStatus: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  privacyScope: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },
  privacyActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  privacyActionButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
  },
  privacyActionText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  privacyHistoryHeader: { paddingTop: 16 },
  privacyHistoryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "transparent",
  },
  privacyHistoryAction: { fontFamily: "Inter_500Medium", fontSize: 12 },
  privacyEmpty: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    paddingVertical: 12,
  },
  privacyClearButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 10,
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 12,
  },
  readinessItem: { paddingVertical: 8 },
  readinessHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  readinessTitle: { fontFamily: "Inter_500Medium", fontSize: 15 },
  speechRateTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    marginBottom: 8,
  },
  readinessDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },
  pressedReadiness: { opacity: 0.7 },
  voicePicker: { borderTopWidth: 1, marginTop: 8, paddingTop: 16 },
  voicePreferences: { borderTopWidth: 1, marginTop: 16, paddingTop: 16 },
  voicePickerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  refreshButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  voiceStatusMessage: { marginTop: 2 },
  voiceRetryButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 8,
  },
  voiceRetryText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  voiceOptions: { gap: 8, marginTop: 12 },
  voiceSelfTest: { marginTop: 16, padding: 12, borderRadius: 14 },
  selfTestActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  selfTestResult: { marginTop: 12, padding: 10, borderRadius: 10 },
  selfTestNextAction: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
  voiceOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  voiceOptionCopy: { flex: 1 },
  voiceOptionTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    marginBottom: 2,
  },
  voiceMeta: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16 },
  downloadBox: { marginTop: 12, padding: 12, borderRadius: 12 },
  downloadTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    marginBottom: 4,
  },
  downloadMeta: { fontFamily: "Inter_400Regular", fontSize: 12 },
  downloadActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  transferStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  transferMessage: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 14,
  },
  primaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  secondaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  smallPrimaryButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  smallPrimaryButtonText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  progressBar: {
    height: 6,
    borderRadius: 3,
    marginTop: 12,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 3 },
  divider: { height: 1, marginVertical: 8 },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  compactSettingRow: { paddingVertical: 8 },
  voiceControlsCard: { paddingTop: 4, paddingBottom: 0 },
  hapticsCard: { marginTop: 12 },
  segmented: { flexDirection: "row", borderRadius: 12, padding: 4 },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  segmentText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  historyClearAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 10,
  },
  dangerText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 340,
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontFamily: "SpaceGrotesk_600SemiBold",
    fontSize: 18,
    marginBottom: 8,
  },
  modalBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 16 },
  modalButton: { padding: 8 },
  modalButtonText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  pressed: { opacity: 0.7 },
});
