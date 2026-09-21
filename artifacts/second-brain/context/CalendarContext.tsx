import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  cancelScheduledReminder,
  initializeNotifications,
  nextOccurrence,
  scheduleReminder,
  type DateReminder,
  type ReminderDraft,
} from '@/lib/reminders';
import {
  migratePlaintextRecord,
  readSecureRecord,
  writeSecureRecord,
} from '@/lib/secureLocalStorage';
import { useApp } from '@/context/AppContext';
import { isCapabilityActive } from '@/lib/privacyCapabilities';

type CalendarContextValue = {
  reminders: DateReminder[];
  upcomingReminders: DateReminder[];
  isReady: boolean;
  error: string | null;
  saveReminder: (
    draft: ReminderDraft,
    existingId?: string,
  ) => Promise<DateReminder>;
  retryReminderNotification: (id: string) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
  findReminder: (id: string) => DateReminder | undefined;
  dismissError: () => void;
  reloadStoredData: () => Promise<void>;
};

const STORAGE_KEY = '@second-brain/date-reminders-v1';
const SECURE_STORAGE_KEY = 'date-reminders';
const CalendarContext = createContext<CalendarContextValue | null>(null);

function createId() {
  return `${Date.now().toString()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseReminders(value: string | null): DateReminder[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as DateReminder[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.label === 'string' &&
        typeof item.eventName === 'string' &&
        typeof item.date === 'string' &&
        (typeof item.time === 'string' || item.time === null) &&
        typeof item.notes === 'string' &&
        typeof item.repeatsAnnually === 'boolean' &&
        typeof item.remindMinutesBefore === 'number',
    ).map((item) => ({
      ...item,
      deletedAt:
        typeof item.deletedAt === 'number' ? item.deletedAt : null,
      retiredNotificationIds: Array.isArray(item.retiredNotificationIds)
        ? item.retiredNotificationIds.filter(
            (identifier) => typeof identifier === 'string',
          )
        : [],
    }));
  } catch {
    return [];
  }
}

export function CalendarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { privacyReady, privacyState, recordPrivacyAction } = useApp();
  const [reminders, setReminders] = useState<DateReminder[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function capabilityIsEnabled(
    capabilityId: 'local.calendar' | 'local.notifications',
  ) {
    // Older isolated component fixtures do not mount AppProvider. The real
    // app always supplies privacy state, where this remains fail-closed.
    if (privacyReady === undefined || privacyState === undefined) return true;
    return privacyReady && isCapabilityActive(privacyState, capabilityId);
  }

  useEffect(() => {
    if (privacyReady === false) return;
    let mounted = true;
    if (!capabilityIsEnabled('local.calendar')) {
      setError('Local calendar access is paused or revoked in Settings.');
      setIsReady(true);
      return () => {
        mounted = false;
      };
    }
    void initializeNotifications().catch(() => {
      // Scheduling surfaces actionable errors when the user saves a date.
    });
    migratePlaintextRecord(SECURE_STORAGE_KEY, STORAGE_KEY)
      .then(async (value) => {
        const loaded = parseReminders(value);
        if (!mounted) return;
        setReminders(loaded);
        const active: DateReminder[] = [];
        for (const item of loaded) {
          if (!item.deletedAt) {
            active.push(item);
            continue;
          }
          const identifiers = [
            item.notificationId,
            ...item.retiredNotificationIds,
          ].filter((identifier): identifier is string => !!identifier);
          const cleaned = await Promise.all(
            identifiers.map(cancelScheduledReminder),
          );
          if (!cleaned.every(Boolean)) active.push(item);
        }
        if (active.length !== loaded.length) {
          await writeSecureRecord(SECURE_STORAGE_KEY, JSON.stringify(active));
          if (mounted) setReminders(active);
        }
      })
      .catch(() => {
        if (mounted) {
          setError('Your saved dates could not be opened on this device.');
        }
      })
      .finally(() => {
        if (mounted) setIsReady(true);
      });
    return () => {
      mounted = false;
    };
  }, [privacyReady]);

  async function reloadStoredData() {
    const value = await readSecureRecord(SECURE_STORAGE_KEY);
    const loaded = parseReminders(value);
    setReminders(loaded);
    setError(null);
  }

  async function persist(next: DateReminder[]) {
    try {
      await writeSecureRecord(SECURE_STORAGE_KEY, JSON.stringify(next));
      setReminders(next);
      setError(null);
      return true;
    } catch {
      setError('This change could not be saved. Your previous dates are unchanged.');
      return false;
    }
  }

  async function saveReminder(draft: ReminderDraft, existingId?: string) {
    if (
      !capabilityIsEnabled('local.calendar') ||
      !capabilityIsEnabled('local.notifications')
    ) {
      throw new Error(
        privacyState.globalPause
          ? 'Privacy pause is active. Resume calendar and notification actions in Settings before saving.'
          : 'Calendar or notification access is paused in Settings.',
      );
    }
    const existing = existingId
      ? reminders.find((item) => item.id === existingId)
      : undefined;
    const now = Date.now();
    const base: DateReminder = {
      ...draft,
      id: existing?.id ?? createId(),
      label: draft.label.trim(),
      eventName: draft.eventName.trim(),
      notes: draft.notes.trim(),
      notificationId: null,
      retiredNotificationIds: existing?.retiredNotificationIds ?? [],
      notificationState: 'pending',
      notificationError: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    };
    const schedule = await scheduleReminder(base);
    if (typeof recordPrivacyAction === 'function') {
      await recordPrivacyAction({
        capabilityId: 'local.calendar',
        action: existingId ? 'local-calendar-update' : 'local-calendar-create',
        status: 'allowed',
        summary: 'A local reminder change was requested; reminder details omitted.',
      });
    }
    const retiredNotificationIds = [
      ...(existing?.retiredNotificationIds ?? []),
      ...(existing?.notificationId ? [existing.notificationId] : []),
    ].filter((identifier) => identifier !== schedule.notificationId);
    const completed = {
      ...base,
      ...schedule,
      retiredNotificationIds,
    };
    const afterScheduling = existing
      ? reminders.map((item) =>
          item.id === completed.id ? completed : item,
        )
      : [...reminders, completed];
    if (!(await persist(afterScheduling))) {
      await cancelScheduledReminder(schedule.notificationId);
      throw new Error('The reminder could not be saved locally.');
    }

    const failedCleanup: string[] = [];
    for (const identifier of retiredNotificationIds) {
      if (!(await cancelScheduledReminder(identifier))) {
        failedCleanup.push(identifier);
      }
    }
    if (failedCleanup.length > 0) {
      const cleaned = { ...completed, retiredNotificationIds: failedCleanup };
      const afterCleanup = afterScheduling.map((item) =>
        item.id === cleaned.id ? cleaned : item,
      );
      await persist(afterCleanup);
      return cleaned;
    }
    return completed;
  }

  async function retryReminderNotification(id: string) {
    if (
      !capabilityIsEnabled('local.notifications')
    ) {
      throw new Error('Local notifications are paused or revoked in Settings.');
    }
    const target = reminders.find((item) => item.id === id);
    if (!target || target.deletedAt) return;
    try {
      if (target.notificationId) {
        await cancelScheduledReminder(target.notificationId);
      }
      const schedule = await scheduleReminder(target);
      const updated = reminders.map((item) =>
        item.id === id
          ? {
              ...item,
              ...schedule,
              updatedAt: Date.now(),
            }
          : item,
      );
      if (!(await persist(updated))) {
        throw new Error('The reminder notification could not be saved.');
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'The reminder notification could not be scheduled. Try again.',
      );
      throw error;
    }
  }

  async function deleteReminder(id: string) {
    if (
      !capabilityIsEnabled('local.calendar') ||
      !capabilityIsEnabled('local.notifications')
    ) {
      throw new Error('Calendar or notification access is paused in Settings.');
    }
    const target = reminders.find((item) => item.id === id);
    if (!target) return;
    const tombstoned = reminders.map((item) =>
      item.id === id ? { ...item, deletedAt: Date.now() } : item,
    );
    if (!(await persist(tombstoned))) {
      throw new Error('The important date could not be deleted locally.');
    }
    const notificationIds = [
      target?.notificationId,
      ...(target?.retiredNotificationIds ?? []),
    ].filter((identifier): identifier is string => !!identifier);
    let alertsCleaned = true;
    for (const identifier of notificationIds) {
      alertsCleaned =
        (await cancelScheduledReminder(identifier)) && alertsCleaned;
    }
    if (!alertsCleaned) {
      setError(
        'The date was deleted. Android alert cleanup will retry next time the app opens.',
      );
      return;
    }
    await persist(tombstoned.filter((item) => item.id !== id));
    if (typeof recordPrivacyAction === 'function') {
      await recordPrivacyAction({
        capabilityId: 'local.calendar',
        action: 'local-calendar-delete',
        status: 'completed',
        summary: 'A local reminder and its device alert were deleted after confirmation.',
      });
    }
  }

  const upcomingReminders = useMemo(
    () =>
      reminders
        .filter((item) => !item.deletedAt)
        .sort(
          (a, b) =>
            (nextOccurrence(a)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
            (nextOccurrence(b)?.getTime() ?? Number.MAX_SAFE_INTEGER),
        ),
    [reminders],
  );

  const value = useMemo(
    () => ({
      reminders,
      upcomingReminders,
      isReady,
      error,
      saveReminder,
      retryReminderNotification,
      deleteReminder,
      findReminder: (id: string) =>
        reminders.find((item) => item.id === id),
      dismissError: () => setError(null),
      reloadStoredData,
    }),
    [reminders, upcomingReminders, isReady, error],
  );

  return (
    <CalendarContext.Provider value={value}>
      {children}
    </CalendarContext.Provider>
  );
}

export function useCalendar() {
  const context = useContext(CalendarContext);
  if (!context) {
    throw new Error('useCalendar must be used inside CalendarProvider');
  }
  return context;
}