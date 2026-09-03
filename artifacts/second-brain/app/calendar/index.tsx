import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { useCalendar } from '@/context/CalendarContext';
import {
  formatReminderDate,
  nextOccurrence,
  timingLabel,
  type DateReminder,
} from '@/lib/reminders';
import { useColors } from '@/hooks/useColors';

function daysUntil(reminder: DateReminder) {
  const next = nextOccurrence(reminder);
  if (!next) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDay = new Date(next);
  eventDay.setHours(0, 0, 0, 0);
  const days = Math.round((eventDay.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'TODAY';
  if (days === 1) return 'TOMORROW';
  return `IN ${days} DAYS`;
}

export default function CalendarScreen() {
  const router = useRouter();
  const { settings } = useApp();
  const {
    upcomingReminders,
    isReady,
    error,
    deleteReminder,
    dismissError,
  } = useCalendar();
  const colors = useColors(settings.appearance);
  const [deleteTarget, setDeleteTarget] = useState<DateReminder | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const hasDeniedAlerts = upcomingReminders.some(
    (item) => item.notificationState === 'permission-denied',
  );

  async function confirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteReminder(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
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
          testID="calendar-back"
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
            Important dates
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
            people worth remembering
          </Text>
        </View>
        <Pressable
          testID="add-reminder"
          accessibilityRole="button"
          accessibilityLabel="Add an important date"
          onPress={() => router.push('/calendar/edit')}
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
          <Text style={[styles.errorText, { color: colors.foreground }]}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss calendar error"
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
            Opening your private calendar…
          </Text>
        </View>
      ) : upcomingReminders.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
            <Feather name="calendar" size={26} color={colors.accentForeground} />
          </View>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            YOUR PEOPLE, YOUR DATES
          </Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Nothing to remember yet.
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            Add birthdays, anniversaries, and moments you want your phone to
            remind you about.
          </Text>
          <Pressable
            testID="empty-add-reminder"
            accessibilityRole="button"
            onPress={() => router.push('/calendar/edit')}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: colors.primary },
              pressed && styles.pressed,
            ]}
          >
            <Feather name="plus" size={17} color={colors.primaryForeground} />
            <Text
              style={[
                styles.primaryButtonText,
                { color: colors.primaryForeground },
              ]}
            >
              Add an important date
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="reminder-list"
          data={upcomingReminders}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => (
            <View
              style={[
                styles.reminderCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.cardTop}>
                <Pressable
                  testID={`reminder-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${item.eventName} for ${item.label}`}
                  onPress={() =>
                    router.push({
                      pathname: '/calendar/edit',
                      params: { id: item.id },
                    })
                  }
                  style={({ pressed }) => [
                    styles.cardEditArea,
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[styles.dateTile, { backgroundColor: colors.accent }]}
                  >
                    <Text
                      style={[
                        styles.dateMonth,
                        { color: colors.accentForeground },
                      ]}
                    >
                      {nextOccurrence(item)
                        ?.toLocaleDateString(undefined, { month: 'short' })
                        .toUpperCase()}
                    </Text>
                    <Text
                      style={[
                        styles.dateDay,
                        { color: colors.accentForeground },
                      ]}
                    >
                      {nextOccurrence(item)?.getDate()}
                    </Text>
                  </View>
                  <View style={styles.cardCopy}>
                    <Text style={[styles.nextLabel, { color: colors.primary }]}>
                      {index === 0 ? `NEXT · ${daysUntil(item)}` : daysUntil(item)}
                    </Text>
                    <Text
                      style={[styles.eventName, { color: colors.cardForeground }]}
                    >
                      {item.eventName}
                    </Text>
                    <Text
                      style={[styles.personName, { color: colors.mutedForeground }]}
                    >
                      {item.label}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  testID={`delete-reminder-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${item.eventName}`}
                  onPress={() => setDeleteTarget(item)}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.deleteButton,
                    { backgroundColor: colors.secondary },
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="trash-2" size={15} color={colors.destructive} />
                </Pressable>
              </View>
              <View style={[styles.metaRow, { borderTopColor: colors.border }]}>
                <Feather name="clock" size={13} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                  {formatReminderDate(item)}
                  {item.time ? ` · ${item.time}` : ' · 9:00 AM'}
                </Text>
                {item.repeatsAnnually && (
                  <View style={[styles.repeatPill, { backgroundColor: colors.accent }]}>
                    <Feather
                      name="repeat"
                      size={10}
                      color={colors.accentForeground}
                    />
                    <Text
                      style={[
                        styles.repeatText,
                        { color: colors.accentForeground },
                      ]}
                    >
                      YEARLY
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.notificationRow}>
                <Feather
                  name={
                    item.notificationState === 'scheduled'
                      ? 'bell'
                      : item.notificationState === 'permission-denied'
                        ? 'bell-off'
                        : 'alert-circle'
                  }
                  size={12}
                  color={
                    item.notificationState === 'scheduled'
                      ? colors.accentForeground
                      : colors.mutedForeground
                  }
                />
                <Text
                  style={[
                    styles.notificationText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {item.notificationState === 'scheduled'
                    ? timingLabel(item.remindMinutesBefore)
                    : item.notificationError ?? 'Device alert not scheduled'}
                </Text>
              </View>
            </View>
          )}
          ListHeaderComponent={
            <View style={styles.listIntro}>
              <Text style={[styles.eyebrow, { color: colors.primary }]}>
                COMING UP
              </Text>
              <Text style={[styles.listTitle, { color: colors.foreground }]}>
                Stay close to what matters.
              </Text>
              <Text style={[styles.listBody, { color: colors.mutedForeground }]}>
                Saved only on this device. Alerts work without an account or
                internet connection.
              </Text>
              {hasDeniedAlerts && (
                <Pressable
                  testID="open-notification-settings"
                  accessibilityRole="button"
                  onPress={() => void Linking.openSettings()}
                  style={({ pressed }) => [
                    styles.permissionCard,
                    { backgroundColor: colors.secondary },
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather
                    name="bell-off"
                    size={16}
                    color={colors.destructive}
                  />
                  <Text
                    style={[
                      styles.permissionText,
                      { color: colors.secondaryForeground },
                    ]}
                  >
                    Alerts are off. Open device settings, then save the date
                    again to schedule it.
                  </Text>
                  <Feather
                    name="external-link"
                    size={14}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              )}
            </View>
          }
        />
      )}

      <Modal
        visible={!!deleteTarget}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setDeleteTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.confirmCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={[styles.confirmIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="trash-2" size={20} color={colors.destructive} />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.cardForeground }]}>
              Delete this important date?
            </Text>
            <Text
              style={[
                styles.confirmDescription,
                { color: colors.mutedForeground },
              ]}
            >
              {deleteTarget
                ? `${deleteTarget.eventName} for ${deleteTarget.label} and its device alert will be removed.`
                : ''}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                testID="cancel-delete-reminder"
                onPress={() => setDeleteTarget(null)}
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
                  Keep it
                </Text>
              </Pressable>
              <Pressable
                testID="confirm-delete-reminder"
                onPress={confirmDelete}
                disabled={isDeleting}
                style={({ pressed }) => [
                  styles.confirmButton,
                  { backgroundColor: colors.destructive },
                  pressed && styles.pressed,
                ]}
              >
                {isDeleting ? (
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
                    Delete
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
  header: {
    minHeight: 72,
    paddingHorizontal: 20,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerCopy: { flex: 1, alignItems: 'center', marginHorizontal: 10 },
  headerTitle: { fontFamily: 'Rubik_600SemiBold', fontSize: 17 },
  headerSubtitle: {
    fontFamily: 'Rubik_400Regular',
    fontSize: 10,
    marginTop: 2,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 8,
    padding: 11,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontFamily: 'Rubik_400Regular',
    fontSize: 11,
    lineHeight: 16,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  stateText: { fontFamily: 'Rubik_400Regular', fontSize: 13 },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 50,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  eyebrow: {
    fontFamily: 'Rubik_700Bold',
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: 9,
  },
  emptyTitle: {
    fontFamily: 'Rubik_600SemiBold',
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -1,
    marginBottom: 10,
  },
  emptyBody: {
    fontFamily: 'Rubik_400Regular',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 24,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: { fontFamily: 'Rubik_600SemiBold', fontSize: 13 },
  listContent: { paddingHorizontal: 20, paddingBottom: 28 },
  listIntro: { paddingTop: 14, paddingBottom: 23 },
  listTitle: {
    fontFamily: 'Rubik_600SemiBold',
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.9,
    marginBottom: 8,
  },
  listBody: {
    fontFamily: 'Rubik_400Regular',
    fontSize: 13,
    lineHeight: 20,
  },
  permissionCard: {
    borderRadius: 13,
    padding: 11,
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  permissionText: {
    flex: 1,
    fontFamily: 'Rubik_400Regular',
    fontSize: 10,
    lineHeight: 15,
  },
  reminderCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardEditArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateTile: {
    width: 52,
    height: 58,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  dateMonth: {
    fontFamily: 'Rubik_700Bold',
    fontSize: 8,
    letterSpacing: 1,
  },
  dateDay: { fontFamily: 'Rubik_600SemiBold', fontSize: 23, lineHeight: 27 },
  cardCopy: { flex: 1 },
  nextLabel: {
    fontFamily: 'Rubik_700Bold',
    fontSize: 8,
    letterSpacing: 1,
    marginBottom: 4,
  },
  eventName: { fontFamily: 'Rubik_600SemiBold', fontSize: 15, lineHeight: 19 },
  personName: {
    fontFamily: 'Rubik_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  deleteButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: { flex: 1, fontFamily: 'Rubik_400Regular', fontSize: 10 },
  repeatPill: {
    borderRadius: 99,
    paddingHorizontal: 7,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  repeatText: {
    fontFamily: 'Rubik_700Bold',
    fontSize: 7,
    letterSpacing: 0.7,
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  notificationText: {
    flex: 1,
    fontFamily: 'Rubik_400Regular',
    fontSize: 9,
    lineHeight: 13,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.66)',
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
    fontFamily: 'Rubik_600SemiBold',
    fontSize: 20,
    marginBottom: 8,
  },
  confirmDescription: {
    fontFamily: 'Rubik_400Regular',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 20,
  },
  confirmActions: { flexDirection: 'row', gap: 10 },
  confirmButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: { fontFamily: 'Rubik_600SemiBold', fontSize: 12 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.98 }] },
});