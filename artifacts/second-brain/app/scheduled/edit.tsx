import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useApp } from '@/context/AppContext';
import { useScheduledJobs } from '@/context/ScheduledJobsContext';
import { useColors } from '@/hooks/useColors';
import {
  type JobSource,
  type MonitorOperator,
  type MonitorTarget,
  type ScheduledJobDraft,
} from '@/lib/scheduledJobs';

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function Toggle({
  selected,
  label,
  description,
  onPress,
  colors,
}: {
  selected: boolean;
  label: string;
  description: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sourceRow,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.accent : colors.card,
        },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.check, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : 'transparent' }]}>
        {selected && <Feather name="check" size={13} color={colors.primaryForeground} />}
      </View>
      <View style={styles.sourceCopy}>
        <Text style={[styles.sourceTitle, { color: colors.cardForeground }]}>{label}</Text>
        <Text style={[styles.sourceDescription, { color: colors.mutedForeground }]}>{description}</Text>
      </View>
    </Pressable>
  );
}

function Choice({
  label,
  selected,
  onPress,
  colors,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: selected ? colors.primary : colors.secondary,
          borderColor: selected ? colors.primary : colors.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.choiceText, { color: selected ? colors.primaryForeground : colors.secondaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

export default function ScheduledJobEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { settings, privacyState } = useApp();
  const { jobs, findJob, saveJob } = useScheduledJobs();
  const colors = useColors(settings.appearance);
  const existing = id ? findJob(id) : undefined;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'digest' | 'monitor'>('digest');
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('daily');
  const [time, setTime] = useState('08:00');
  const [weekday, setWeekday] = useState(1);
  const [prompt, setPrompt] = useState('');
  const [memoriesSelected, setMemoriesSelected] = useState(true);
  const [calendarSelected, setCalendarSelected] = useState(false);
  const [fileSource, setFileSource] = useState<Extract<JobSource, { kind: 'file' }> | null>(null);
  const [connectorIds, setConnectorIds] = useState<string[]>([]);
  const [monitorTarget, setMonitorTarget] = useState<MonitorTarget>('memory-count');
  const [monitorOperator, setMonitorOperator] = useState<MonitorOperator>('changes');
  const [threshold, setThreshold] = useState('1');
  const [notificationPolicy, setNotificationPolicy] = useState<'silent' | 'generic'>('generic');
  const [retentionDays, setRetentionDays] = useState<7 | 30>(30);
  const [budget, setBudget] = useState<30 | 60>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadedId = existing?.id;

  useEffect(() => {
    if (!existing || loadedId === undefined) return;
    setName(existing.name);
    setKind(existing.kind);
    setCadence(existing.cadence);
    setTime(existing.time);
    setWeekday(existing.weekday);
    setPrompt(existing.prompt);
    setMemoriesSelected(existing.sources.some((source) => source.kind === 'memories'));
    setCalendarSelected(existing.sources.some((source) => source.kind === 'calendar'));
    setFileSource(existing.sources.find((source): source is Extract<JobSource, { kind: 'file' }> => source.kind === 'file') ?? null);
    setConnectorIds(
      existing.sources
        .filter((source): source is Extract<JobSource, { kind: 'connector' }> => source.kind === 'connector')
        .map((source) => source.id),
    );
    setMonitorTarget(existing.monitor?.target ?? 'memory-count');
    setMonitorOperator(existing.monitor?.operator ?? 'changes');
    setThreshold(String(existing.monitor?.threshold ?? 1));
    setNotificationPolicy(existing.notificationPolicy);
    setRetentionDays(existing.retentionDays);
    setBudget(existing.executionBudgetSeconds);
  }, [loadedId]);

  const selectedSources = useMemo(() => {
    const sources: JobSource[] = [];
    if (memoriesSelected) sources.push({ kind: 'memories' });
    if (calendarSelected) sources.push({ kind: 'calendar' });
    if (fileSource) sources.push(fileSource);
    for (const connector of privacyState.connectorReferences) {
      if (connectorIds.includes(connector.id)) {
        sources.push({
          kind: 'connector',
          id: connector.id,
          label: connector.label,
          provider: connector.provider,
        });
      }
    }
    return sources;
  }, [memoriesSelected, calendarSelected, fileSource, connectorIds, privacyState.connectorReferences]);

  async function pickFile() {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'text/markdown', 'text/csv', 'application/json'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const content = await FileSystem.readAsStringAsync(asset.uri);
      if (!content.trim()) throw new Error('The selected file is empty.');
      setFileSource({
        kind: 'file',
        id: createId(),
        name: asset.name.slice(0, 120),
        mimeType: asset.mimeType ?? 'text/plain',
        content: content.slice(0, 120_000),
        sizeBytes: asset.size ?? content.length,
        selectedAt: Date.now(),
      });
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'The local file could not be read.');
    }
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const draft: ScheduledJobDraft = {
      name,
      kind,
      cadence,
      time,
      weekday,
      prompt,
      sources: selectedSources,
      monitor:
        kind === 'monitor'
          ? {
              target: monitorTarget,
              operator: monitorOperator,
              threshold: Number(threshold) || 0,
            }
          : null,
      notificationPolicy,
      retentionDays,
      executionBudgetSeconds: budget,
    };
    try {
      await saveJob(draft, id);
      router.replace('/scheduled' as never);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'This scheduled job could not be saved.');
    } finally {
      setBusy(false);
    }
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
          testID="scheduled-edit-back"
          accessibilityRole="button"
          accessibilityLabel="Back to scheduled work"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.secondary }, pressed && styles.pressed]}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>{id ? 'Edit scheduled work' : 'New scheduled work'}</Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>explicit sources, bounded runtime</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.eyebrow, { color: colors.primary }]}>Define the job</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>What should Demi check?</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Every run uses only the sources you select. No cloud scheduler or unrestricted tool access is used.
        </Text>

        {error && (
          <View style={[styles.errorBanner, { backgroundColor: colors.secondary }]}>
            <Feather name="alert-circle" size={15} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.foreground }]}>{error}</Text>
          </View>
        )}

        <Text style={[styles.label, { color: colors.mutedForeground }]}>Job type</Text>
        <View style={styles.choiceRow}>
          <Choice label="Morning digest" selected={kind === 'digest'} onPress={() => setKind('digest')} colors={colors} />
          <Choice label="Monitor" selected={kind === 'monitor'} onPress={() => setKind('monitor')} colors={colors} />
        </View>

        <Text style={[styles.label, { color: colors.mutedForeground }]}>Name</Text>
        <TextInput
          testID="scheduled-job-name"
          value={name}
          onChangeText={setName}
          maxLength={80}
          placeholder={kind === 'digest' ? 'Morning check-in' : 'Watch my reminders'}
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.cardForeground, backgroundColor: colors.card, borderColor: colors.border }]}
        />

        <View style={styles.twoColumns}>
          <View style={styles.column}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Time</Text>
            <TextInput
              testID="scheduled-job-time"
              value={time}
              onChangeText={setTime}
              maxLength={5}
              placeholder="08:00"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numbers-and-punctuation"
              style={[styles.input, { color: colors.cardForeground, backgroundColor: colors.card, borderColor: colors.border }]}
            />
          </View>
          <View style={styles.column}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Repeats</Text>
            <View style={styles.choiceRow}>
              <Choice label="Daily" selected={cadence === 'daily'} onPress={() => setCadence('daily')} colors={colors} />
              <Choice label="Weekly" selected={cadence === 'weekly'} onPress={() => setCadence('weekly')} colors={colors} />
            </View>
          </View>
        </View>

        {cadence === 'weekly' && (
          <>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Day</Text>
            <View style={styles.weekRow}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, index) => (
                <Choice key={label} label={label} selected={weekday === index} onPress={() => setWeekday(index)} colors={colors} />
              ))}
            </View>
          </>
        )}

        <Text style={[styles.label, { color: colors.mutedForeground }]}>Approved sources</Text>
        <Toggle
          selected={memoriesSelected}
          label="Approved memories"
          description="Only memories you have explicitly saved; archived memories are skipped."
          onPress={() => setMemoriesSelected((value) => !value)}
          colors={colors}
        />
        <Toggle
          selected={calendarSelected}
          label="Local reminders"
          description="Demi's saved reminders and upcoming dates; no system calendar access."
          onPress={() => setCalendarSelected((value) => !value)}
          colors={colors}
        />
        <View style={styles.fileSourceWrap}>
          <Toggle
            selected={!!fileSource}
            label={fileSource ? fileSource.name : 'Selected local file'}
            description="Pick a text, Markdown, CSV, or JSON file. Its content stays encrypted locally with this job."
            onPress={() => void pickFile()}
            colors={colors}
          />
          {fileSource && (
            <Pressable accessibilityRole="button" accessibilityLabel="Remove selected scheduled file" onPress={() => setFileSource(null)} style={({ pressed }) => [styles.removeFile, pressed && styles.pressed]}>
              <Feather name="x" size={14} color={colors.destructive} />
              <Text style={[styles.removeFileText, { color: colors.destructive }]}>Remove file</Text>
            </Pressable>
          )}
        </View>
        {privacyState.connectorReferences.map((connector) => (
          <Toggle
            key={connector.id}
            selected={connectorIds.includes(connector.id)}
            label={`Granted connector · ${connector.label}`}
            description="Read-only connector reference. If it expires or is unavailable, the job fails safely without inventing data."
            onPress={() =>
              setConnectorIds((current) =>
                current.includes(connector.id)
                  ? current.filter((id) => id !== connector.id)
                  : [...current, connector.id],
              )
            }
            colors={colors}
          />
        ))}
        {privacyState.connectorReferences.length === 0 && (
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            No explicitly granted connector is available. Connectors are never added implicitly.
          </Text>
        )}

        {kind === 'monitor' && (
          <>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Change condition</Text>
            <View style={styles.choiceRow}>
              <Choice label="Memory count" selected={monitorTarget === 'memory-count'} onPress={() => setMonitorTarget('memory-count')} colors={colors} />
              <Choice label="Reminder count" selected={monitorTarget === 'upcoming-reminder-count'} onPress={() => setMonitorTarget('upcoming-reminder-count')} colors={colors} />
            </View>
            <View style={styles.choiceRow}>
              {(['changes', 'increases', 'decreases', 'at-least', 'at-most'] as MonitorOperator[]).map((operator) => (
                <Choice key={operator} label={operator[0].toUpperCase() + operator.slice(1)} selected={monitorOperator === operator} onPress={() => setMonitorOperator(operator)} colors={colors} />
              ))}
            </View>
            {(monitorOperator === 'at-least' || monitorOperator === 'at-most') && (
              <TextInput
                testID="monitor-threshold"
                value={threshold}
                onChangeText={setThreshold}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="Threshold"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.cardForeground, backgroundColor: colors.card, borderColor: colors.border }]}
              />
            )}
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              A monitor records its first value as a baseline and alerts only when the selected condition matches. It does not run a model.
            </Text>
          </>
        )}

        {kind === 'digest' && (
          <>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Digest instruction</Text>
            <TextInput
              testID="digest-prompt"
              value={prompt}
              onChangeText={setPrompt}
              multiline
              maxLength={600}
              placeholder="Summarize the most useful items for today in short bullets."
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, styles.multilineInput, { color: colors.cardForeground, backgroundColor: colors.card, borderColor: colors.border }]}
            />
          </>
        )}

        <Text style={[styles.label, { color: colors.mutedForeground }]}>Notification disclosure</Text>
        <View style={styles.choiceRow}>
          <Choice label="Generic alert" selected={notificationPolicy === 'generic'} onPress={() => setNotificationPolicy('generic')} colors={colors} />
          <Choice label="No alert" selected={notificationPolicy === 'silent'} onPress={() => setNotificationPolicy('silent')} colors={colors} />
        </View>
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          Alerts say that a result is ready or a change was detected. They never include digest text, file content, memories, or reminder details.
        </Text>

        <Text style={[styles.label, { color: colors.mutedForeground }]}>Encrypted result retention</Text>
        <View style={styles.choiceRow}>
          <Choice label="7 days" selected={retentionDays === 7} onPress={() => setRetentionDays(7)} colors={colors} />
          <Choice label="30 days" selected={retentionDays === 30} onPress={() => setRetentionDays(30)} colors={colors} />
        </View>

        <Text style={[styles.label, { color: colors.mutedForeground }]}>Execution budget</Text>
        <View style={styles.choiceRow}>
          <Choice label="30 sec" selected={budget === 30} onPress={() => setBudget(30)} colors={colors} />
          <Choice label="60 sec" selected={budget === 60} onPress={() => setBudget(60)} colors={colors} />
        </View>
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          The on-device model is the only runtime and network use is always never. Android may delay the scheduled wake-up.
        </Text>

        <Pressable
          testID="save-scheduled-job"
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void submit()}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}
        >
          {busy ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="check" size={17} color={colors.primaryForeground} />}
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{busy ? 'Saving securely…' : id ? 'Save changes' : 'Create scheduled work'}</Text>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 72, paddingHorizontal: 20, paddingVertical: 13, flexDirection: 'row', alignItems: 'center' },
  headerCopy: { flex: 1, alignItems: 'center', marginHorizontal: 10 },
  headerSpacer: { width: 38 },
  headerTitle: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 17 },
  headerSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 2 },
  iconButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 34 },
  eyebrow: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.4, marginBottom: 9 },
  title: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 29, lineHeight: 35, letterSpacing: -1, marginBottom: 8 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20 },
  label: { fontFamily: 'Inter_500Medium', fontSize: 11, marginTop: 18, marginBottom: 7 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: { minHeight: 38, borderRadius: 10, borderWidth: 1, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  choiceText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontFamily: 'Inter_400Regular', fontSize: 13 },
  multilineInput: { minHeight: 88, textAlignVertical: 'top' },
  twoColumns: { flexDirection: 'row', gap: 10 },
  column: { flex: 1 },
  weekRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sourceRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 13, borderWidth: 1, padding: 11, marginBottom: 8 },
  check: { width: 22, height: 22, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sourceCopy: { flex: 1 },
  sourceTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  sourceDescription: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 2 },
  fileSourceWrap: { marginBottom: 2 },
  removeFile: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end', marginTop: -2, marginBottom: 6, padding: 5 },
  removeFileText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 8 },
  errorBanner: { flexDirection: 'row', gap: 8, padding: 11, borderRadius: 12, marginTop: 14 },
  errorText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  primaryButton: { minHeight: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 24 },
  primaryButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  pressed: { opacity: 0.78 },
});