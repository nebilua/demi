import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
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
import { useCalendar } from '@/context/CalendarContext';
import {
  timingLabel,
  validateReminderDraft,
  type DateReminder,
  type ReminderDraft,
  type ReminderTiming,
} from '@/lib/reminders';
import { useColors } from '@/hooks/useColors';

const timingOptions: ReminderTiming[] = [0, 60, 1440, 10080];

function tomorrowDate() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export default function ReminderEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { isReady, findReminder } = useCalendar();
  const reminder = typeof id === 'string' ? findReminder(id) : undefined;
  if (!isReady) return <EditorLoading />;
  return <ReminderForm initial={reminder} />;
}

function EditorLoading() {
  const { settings } = useApp();
  const colors = useColors(settings.appearance);
  return (
    <View style={[styles.loading, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

function ReminderForm({ initial }: { initial?: DateReminder }) {
  const router = useRouter();
  const { settings } = useApp();
  const { saveReminder } = useCalendar();
  const colors = useColors(settings.appearance);
  const [label, setLabel] = useState(initial?.label ?? '');
  const [eventName, setEventName] = useState(initial?.eventName ?? '');
  const [date, setDate] = useState(initial?.date ?? tomorrowDate());
  const [hasTime, setHasTime] = useState(initial?.time !== null);
  const [time, setTime] = useState(initial?.time ?? '09:00');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [repeatsAnnually, setRepeatsAnnually] = useState(
    initial?.repeatsAnnually ?? false,
  );
  const [remindMinutesBefore, setRemindMinutesBefore] =
    useState<ReminderTiming>(initial?.remindMinutesBefore ?? 1440);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    const draft: ReminderDraft = {
      label,
      eventName,
      date,
      time: hasTime ? time : null,
      notes,
      repeatsAnnually,
      remindMinutesBefore,
    };
    const issue = validateReminderDraft(draft);
    if (issue) {
      setValidationError(issue);
      return;
    }
    setValidationError(null);
    setIsSaving(true);
    try {
      await saveReminder(draft, initial?.id);
      router.replace('/calendar');
    } catch (error) {
      setValidationError(
        error instanceof Error
          ? error.message
          : 'The important date could not be saved.',
      );
    } finally {
      setIsSaving(false);
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
          testID="editor-back"
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={() => router.replace('/calendar')}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: colors.secondary },
            pressed && styles.pressed,
          ]}
        >
          <Feather name="x" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {initial ? 'Edit important date' : 'New important date'}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
            saved only on this device
          </Text>
        </View>
        <Pressable
          testID="save-reminder"
          accessibilityRole="button"
          accessibilityLabel="Save important date"
          onPress={handleSave}
          disabled={isSaving}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: colors.primary },
            pressed && styles.pressed,
          ]}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Feather name="check" size={19} color={colors.primaryForeground} />
          )}
        </Pressable>
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            WHO & WHAT
          </Text>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>
            Keep the date close.
          </Text>
          <Text style={[styles.pageBody, { color: colors.mutedForeground }]}>
            Add enough context to make the reminder useful when it arrives.
          </Text>
        </View>

        {validationError && (
          <View
            testID="reminder-validation-error"
            style={[styles.errorBanner, { backgroundColor: colors.secondary }]}
          >
            <Feather name="alert-circle" size={15} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.foreground }]}>
              {validationError}
            </Text>
          </View>
        )}

        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          PERSON OR LABEL
        </Text>
        <TextInput
          testID="reminder-label"
          value={label}
          onChangeText={setLabel}
          placeholder="Maya, Dad, Our team…"
          placeholderTextColor={colors.mutedForeground}
          maxLength={80}
          style={[
            styles.input,
            {
              color: colors.cardForeground,
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        />

        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          EVENT
        </Text>
        <TextInput
          testID="reminder-event"
          value={eventName}
          onChangeText={setEventName}
          placeholder="Birthday, anniversary, check-in…"
          placeholderTextColor={colors.mutedForeground}
          maxLength={100}
          style={[
            styles.input,
            {
              color: colors.cardForeground,
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        />

        <View style={styles.twoColumns}>
          <View style={styles.column}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              DATE
            </Text>
            <TextInput
              testID="reminder-date"
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
              maxLength={10}
              autoCapitalize="none"
              style={[
                styles.input,
                {
                  color: colors.cardForeground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            />
          </View>
          <View style={styles.timeColumn}>
            <View style={styles.inlineLabel}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>
                TIME
              </Text>
              <Switch
                testID="reminder-has-time"
                value={hasTime}
                onValueChange={setHasTime}
                trackColor={{ false: colors.secondary, true: colors.accent }}
                thumbColor={
                  hasTime ? colors.accentForeground : colors.mutedForeground
                }
              />
            </View>
            <TextInput
              testID="reminder-time"
              value={time}
              onChangeText={setTime}
              placeholder="09:00"
              placeholderTextColor={colors.mutedForeground}
              maxLength={5}
              editable={hasTime}
              style={[
                styles.input,
                !hasTime && styles.disabled,
                {
                  color: colors.cardForeground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            />
          </View>
        </View>
        {!hasTime && (
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Date-only reminders arrive at 9:00 AM.
          </Text>
        )}

        <View
          style={[
            styles.optionCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={[styles.optionIcon, { backgroundColor: colors.accent }]}>
            <Feather name="repeat" size={17} color={colors.accentForeground} />
          </View>
          <View style={styles.optionCopy}>
            <Text style={[styles.optionTitle, { color: colors.cardForeground }]}>
              Repeat every year
            </Text>
            <Text
              style={[styles.optionDescription, { color: colors.mutedForeground }]}
            >
              Useful for birthdays and anniversaries
            </Text>
          </View>
          <Switch
            testID="reminder-repeat"
            value={repeatsAnnually}
            onValueChange={setRepeatsAnnually}
            trackColor={{ false: colors.secondary, true: colors.accent }}
            thumbColor={
              repeatsAnnually
                ? colors.accentForeground
                : colors.mutedForeground
            }
          />
        </View>

        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          REMIND ME
        </Text>
        <View style={[styles.timingGrid, { backgroundColor: colors.secondary }]}>
          {timingOptions.map((option) => {
            const selected = option === remindMinutesBefore;
            return (
              <Pressable
                key={option}
                testID={`reminder-timing-${option}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setRemindMinutesBefore(option)}
                style={[
                  styles.timingOption,
                  selected && {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.timingText,
                    {
                      color: selected
                        ? colors.cardForeground
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {timingLabel(option)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          NOTES · OPTIONAL
        </Text>
        <TextInput
          testID="reminder-notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Gift idea, context, what to say…"
          placeholderTextColor={colors.mutedForeground}
          maxLength={500}
          multiline
          textAlignVertical="top"
          style={[
            styles.input,
            styles.notesInput,
            {
              color: colors.cardForeground,
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        />

        <View style={[styles.privacyCard, { backgroundColor: colors.accent }]}>
          <Feather name="lock" size={15} color={colors.accentForeground} />
          <Text
            style={[styles.privacyText, { color: colors.accentForeground }]}
          >
            The date stays in Second Brain. Android only receives the alert
            needed to notify you.
          </Text>
        </View>

        <Pressable
          testID="save-reminder-bottom"
          accessibilityRole="button"
          onPress={handleSave}
          disabled={isSaving}
          style={({ pressed }) => [
            styles.saveButton,
            { backgroundColor: colors.primary },
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[styles.saveButtonText, { color: colors.primaryForeground }]}
          >
            {initial ? 'Save changes' : 'Save important date'}
          </Text>
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 30 },
  intro: { paddingTop: 14, paddingBottom: 24 },
  eyebrow: {
    fontFamily: 'Rubik_700Bold',
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: 9,
  },
  pageTitle: {
    fontFamily: 'Rubik_600SemiBold',
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -1,
    marginBottom: 8,
  },
  pageBody: {
    fontFamily: 'Rubik_400Regular',
    fontSize: 13,
    lineHeight: 20,
  },
  errorBanner: {
    borderRadius: 12,
    padding: 11,
    marginBottom: 16,
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
  label: {
    fontFamily: 'Rubik_700Bold',
    fontSize: 9,
    letterSpacing: 1.1,
    marginBottom: 7,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 13,
    fontFamily: 'Rubik_400Regular',
    fontSize: 14,
    marginBottom: 17,
  },
  notesInput: { minHeight: 100, paddingTop: 13 },
  twoColumns: { flexDirection: 'row', gap: 10 },
  column: { flex: 1.25 },
  timeColumn: { flex: 0.85 },
  inlineLabel: {
    minHeight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  hint: {
    fontFamily: 'Rubik_400Regular',
    fontSize: 10,
    marginTop: -10,
    marginBottom: 18,
  },
  optionCard: {
    minHeight: 72,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  optionCopy: { flex: 1 },
  optionTitle: { fontFamily: 'Rubik_600SemiBold', fontSize: 13 },
  optionDescription: {
    fontFamily: 'Rubik_400Regular',
    fontSize: 10,
    marginTop: 3,
  },
  timingGrid: {
    borderRadius: 14,
    padding: 3,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  timingOption: {
    width: '50%',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 11,
    paddingVertical: 10,
    alignItems: 'center',
  },
  timingText: { fontFamily: 'Rubik_500Medium', fontSize: 10 },
  privacyCard: {
    borderRadius: 13,
    padding: 11,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 16,
  },
  privacyText: {
    flex: 1,
    fontFamily: 'Rubik_400Regular',
    fontSize: 10,
    lineHeight: 15,
  },
  saveButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: { fontFamily: 'Rubik_600SemiBold', fontSize: 13 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.98 }] },
});