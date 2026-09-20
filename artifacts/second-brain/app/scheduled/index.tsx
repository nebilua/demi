import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { useScheduledJobs } from '@/context/ScheduledJobsContext';
import { useColors } from '@/hooks/useColors';
import { formatJobRun, type ScheduledJob } from '@/lib/scheduledJobs';

function sourceNames(job: ScheduledJob) {
  return job.sources
    .map((source) =>
      source.kind === 'memories'
        ? 'Memories'
        : source.kind === 'calendar'
          ? 'Reminders'
          : source.kind === 'file'
            ? source.name
            : source.label,
    )
    .join(' · ');
}

function resultLabel(job: ScheduledJob) {
  if (!job.lastResultStatus) return 'No runs yet';
  if (job.lastResultStatus === 'changed') return 'Change detected';
  if (job.lastResultStatus === 'skipped') return 'No change';
  if (job.lastResultStatus === 'completed') return 'Completed';
  if (job.lastResultStatus === 'failed') return 'Needs attention';
  return job.lastResultStatus;
}

export default function ScheduledJobsScreen() {
  const router = useRouter();
  const { settings } = useApp();
  const {
    jobs,
    isReady,
    isRunning,
    error,
    pauseJob,
    runJobNow,
    deleteJob,
    retryJob,
    dismissError,
  } = useScheduledJobs();
  const colors = useColors(settings.appearance);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledJob | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function action(action: () => Promise<void>, id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      await action();
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await action(() => deleteJob(deleteTarget.id), deleteTarget.id);
    setDeleteTarget(null);
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
          testID="scheduled-back"
          accessibilityRole="button"
          accessibilityLabel="Back to chat"
          onPress={() => router.replace('/')}
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
            Scheduled work
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
            private, bounded, on this device
          </Text>
        </View>
        <Pressable
          testID="add-scheduled-job"
          accessibilityRole="button"
          accessibilityLabel="Add scheduled work"
          onPress={() => router.push('/scheduled/edit' as never)}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: colors.primary },
            pressed && styles.pressed,
          ]}
        >
          <Feather name="plus" size={20} color={colors.primaryForeground} />
        </Pressable>
      </View>

      {error && (
        <View style={[styles.errorBanner, { backgroundColor: colors.secondary }]}>
          <Feather name="alert-circle" size={15} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.foreground }]}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss scheduled work error"
            onPress={dismissError}
          >
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        </View>
      )}

      {!isReady ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
            Opening encrypted scheduled work…
          </Text>
        </View>
      ) : (
        <FlatList
          testID="scheduled-job-list"
          data={jobs}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.listIntro}>
              <Text style={[styles.eyebrow, { color: colors.primary }]}>
                Local automation
              </Text>
              <Text style={[styles.listTitle, { color: colors.foreground }]}>
                Useful work, with limits.
              </Text>
              <Text style={[styles.listBody, { color: colors.mutedForeground }]}>
                Android may delay background work. Demi schedules a local wake-up,
                then runs the full digest or monitor when the app and approved
                capabilities are available. Notifications never include private results.
              </Text>
              {isRunning && (
                <View style={[styles.runningBanner, { backgroundColor: colors.accent }]}>
                  <ActivityIndicator size="small" color={colors.accentForeground} />
                  <Text style={[styles.runningText, { color: colors.accentForeground }]}>
                    Running approved scheduled work locally…
                  </Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
                <Feather name="clock" size={26} color={colors.accentForeground} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                Nothing scheduled yet.
              </Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                Create a morning digest from approved local sources or a monitor
                that checks a bounded count for changes.
              </Text>
              <Pressable
                testID="empty-add-scheduled-job"
                accessibilityRole="button"
                onPress={() => router.push('/scheduled/edit' as never)}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.primary },
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="plus" size={17} color={colors.primaryForeground} />
                <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                  Create scheduled work
                </Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.jobCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.name}`}
                onPress={() =>
                  router.push({ pathname: '/scheduled/edit', params: { id: item.id } } as never)
                }
                style={({ pressed }) => [styles.jobMain, pressed && styles.pressed]}
              >
                <View style={[styles.jobIcon, { backgroundColor: item.enabled ? colors.accent : colors.secondary }]}>
                  <Feather
                    name={item.kind === 'digest' ? 'sun' : 'activity'}
                    size={18}
                    color={item.enabled ? colors.accentForeground : colors.mutedForeground}
                  />
                </View>
                <View style={styles.jobCopy}>
                  <View style={styles.titleLine}>
                    <Text style={[styles.jobName, { color: colors.cardForeground }]}>{item.name}</Text>
                    <Text style={[styles.jobKind, { color: item.enabled ? colors.primary : colors.mutedForeground }]}>
                      {item.enabled ? (item.kind === 'digest' ? 'DIGEST' : 'MONITOR') : 'PAUSED'}
                    </Text>
                  </View>
                  <Text style={[styles.jobMeta, { color: colors.mutedForeground }]}>
                    {item.cadence === 'daily' ? 'Daily' : 'Weekly'} at {item.time} · next {formatJobRun(item.nextRunAt)}
                  </Text>
                  <Text style={[styles.jobMeta, { color: colors.mutedForeground }]} numberOfLines={2}>
                    Sources: {sourceNames(item)}
                  </Text>
                </View>
              </Pressable>
              <View style={[styles.detailRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.detailText, { color: colors.mutedForeground }]}>
                  {item.runtime} · network never
                </Text>
                <Text style={[styles.detailText, { color: colors.mutedForeground }]}>
                  Retain {item.retentionDays}d
                </Text>
              </View>
              <View style={styles.statusRow}>
                <View style={styles.statusCopy}>
                  <Text style={[styles.statusTitle, { color: colors.cardForeground }]}>
                    {resultLabel(item)}
                  </Text>
                  <Text style={[styles.statusText, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {item.lastError || item.lastResultSummary || `Last run: ${formatJobRun(item.lastRunAt)}`}
                  </Text>
                </View>
                <Pressable
                  testID={`run-now-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Run ${item.name} now`}
                  disabled={busyId !== null}
                  onPress={() => void action(() => runJobNow(item.id), item.id)}
                  style={({ pressed }) => [styles.smallButton, { backgroundColor: colors.secondary }, pressed && styles.pressed]}
                >
                  {busyId === item.id ? <ActivityIndicator size="small" color={colors.foreground} /> : <Feather name="play" size={14} color={colors.foreground} />}
                  <Text style={[styles.smallButtonText, { color: colors.foreground }]}>Run now</Text>
                </Pressable>
              </View>
              <View style={styles.actionsRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.enabled ? `Pause ${item.name}` : `Resume ${item.name}`}
                  disabled={busyId !== null}
                  onPress={() => void action(() => pauseJob(item.id, item.enabled), item.id)}
                  style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
                >
                  <Feather name={item.enabled ? 'pause' : 'play'} size={13} color={colors.primary} />
                  <Text style={[styles.textActionLabel, { color: colors.primary }]}>{item.enabled ? 'Pause' : 'Resume'}</Text>
                </Pressable>
                {item.lastResultStatus === 'failed' && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Retry ${item.name}`}
                    disabled={busyId !== null}
                    onPress={() => void action(() => retryJob(item.id), item.id)}
                    style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
                  >
                    <Feather name="refresh-cw" size={13} color={colors.primary} />
                    <Text style={[styles.textActionLabel, { color: colors.primary }]}>Retry</Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${item.name}`}
                  onPress={() => setDeleteTarget(item)}
                  style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
                >
                  <Feather name="trash-2" size={13} color={colors.destructive} />
                  <Text style={[styles.textActionLabel, { color: colors.destructive }]}>Delete</Text>
                </Pressable>
              </View>
              {item.results.length > 0 && (
                <View style={[styles.historyBox, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.historyTitle, { color: colors.secondaryForeground }]}>
                    Latest result · {formatJobRun(item.results[item.results.length - 1].finishedAt)}
                  </Text>
                  <Text style={[styles.historyText, { color: colors.mutedForeground }]} numberOfLines={3}>
                    {item.results[item.results.length - 1].details || item.results[item.results.length - 1].summary}
                  </Text>
                </View>
              )}
            </View>
          )}
        />
      )}

      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.confirmCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.confirmIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="trash-2" size={20} color={colors.destructive} />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.cardForeground }]}>Delete scheduled work?</Text>
            <Text style={[styles.confirmDescription, { color: colors.mutedForeground }]}>
              {deleteTarget ? `${deleteTarget.name}, its local notification, and encrypted result history will be removed.` : ''}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable onPress={() => setDeleteTarget(null)} style={({ pressed }) => [styles.confirmButton, { backgroundColor: colors.secondary }, pressed && styles.pressed]}>
                <Text style={[styles.confirmButtonText, { color: colors.secondaryForeground }]}>Keep it</Text>
              </Pressable>
              <Pressable testID="confirm-delete-scheduled-job" disabled={!!busyId} onPress={() => void confirmDelete()} style={({ pressed }) => [styles.confirmButton, { backgroundColor: colors.destructive }, pressed && styles.pressed]}>
                {busyId === deleteTarget?.id ? <ActivityIndicator size="small" color={colors.destructiveForeground} /> : <Text style={[styles.confirmButtonText, { color: colors.destructiveForeground }]}>Delete</Text>}
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
  header: { minHeight: 72, paddingHorizontal: 20, paddingVertical: 13, flexDirection: 'row', alignItems: 'center' },
  headerCopy: { flex: 1, alignItems: 'center', marginHorizontal: 10 },
  headerTitle: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 17 },
  headerSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 2 },
  iconButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 34 },
  listIntro: { paddingBottom: 18 },
  eyebrow: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.4, marginBottom: 9 },
  listTitle: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 29, lineHeight: 35, letterSpacing: -1, marginBottom: 8 },
  listBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20 },
  runningBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 12, marginTop: 14 },
  runningText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  jobCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12 },
  jobMain: { flexDirection: 'row', gap: 11 },
  jobIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  jobCopy: { flex: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  jobName: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  jobKind: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1 },
  jobMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 3 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, paddingTop: 10, marginTop: 12 },
  detailText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  statusCopy: { flex: 1 },
  statusTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  statusText: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 2 },
  smallButton: { minHeight: 36, borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  smallButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 13 },
  textAction: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  textActionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  historyBox: { borderRadius: 11, padding: 10, marginTop: 12 },
  historyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  historyText: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 4 },
  emptyState: { alignItems: 'center', paddingTop: 42, paddingHorizontal: 18 },
  emptyIcon: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 23, marginBottom: 8 },
  emptyBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 20 },
  primaryButton: { borderRadius: 13, minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  primaryButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, padding: 11, borderRadius: 12 },
  errorText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateText: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20,18,16,0.48)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  confirmCard: { width: '100%', maxWidth: 390, borderRadius: 20, borderWidth: 1, padding: 20 },
  confirmIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  confirmTitle: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 20 },
  confirmDescription: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 8 },
  confirmActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  confirmButton: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  confirmButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  pressed: { opacity: 0.78 },
});