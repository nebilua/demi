import { Platform } from 'react-native';

export type ReminderTiming = 0 | 60 | 1440 | 10080;
export type NotificationState =
  | 'pending'
  | 'scheduled'
  | 'permission-denied'
  | 'unavailable'
  | 'past'
  | 'error';

export type DateReminder = {
  id: string;
  label: string;
  eventName: string;
  date: string;
  time: string | null;
  notes: string;
  repeatsAnnually: boolean;
  remindMinutesBefore: ReminderTiming;
  notificationId: string | null;
  retiredNotificationIds: string[];
  notificationState: NotificationState;
  notificationError: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type ReminderDraft = Pick<
  DateReminder,
  | 'label'
  | 'eventName'
  | 'date'
  | 'time'
  | 'notes'
  | 'repeatsAnnually'
  | 'remindMinutesBefore'
>;

type NotificationsModule = typeof import('expo-notifications');

let notificationsModule: NotificationsModule | null | undefined;

export function getNotificationsModule() {
  if (notificationsModule !== undefined) return notificationsModule;
  if (Platform.OS === 'web') {
    notificationsModule = null;
    return notificationsModule;
  }
  try {
    notificationsModule =
      require('expo-notifications') as NotificationsModule;
    notificationsModule.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    notificationsModule = null;
  }
  return notificationsModule;
}

export function parseLocalDate(date: string, time: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timeMatch = time ? /^(\d{2}):(\d{2})$/.exec(time) : null;
  if (time && !timeMatch) return null;
  const hour = timeMatch ? Number(timeMatch[1]) : 9;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  const value = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day ||
    value.getHours() !== hour ||
    value.getMinutes() !== minute ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  return value;
}

export function validateReminderDraft(draft: ReminderDraft) {
  if (!draft.label.trim()) return 'Add a person or label.';
  if (!draft.eventName.trim()) return 'Add an event name.';
  const eventDate = parseLocalDate(draft.date, draft.time);
  if (!eventDate) return 'Use a valid date (YYYY-MM-DD) and time (HH:MM).';
  const triggerDate = new Date(
    eventDate.getTime() - draft.remindMinutesBefore * 60_000,
  );
  if (!draft.repeatsAnnually && triggerDate.getTime() <= Date.now()) {
    return 'Choose a future reminder time.';
  }
  return null;
}

export function nextOccurrence(reminder: DateReminder, now = new Date()) {
  const original = parseLocalDate(reminder.date, reminder.time);
  if (!original) return null;
  if (!reminder.repeatsAnnually) return original;

  const occurrence = new Date(
    now.getFullYear(),
    original.getMonth(),
    original.getDate(),
    original.getHours(),
    original.getMinutes(),
  );
  if (occurrence.getTime() < now.getTime()) {
    occurrence.setFullYear(occurrence.getFullYear() + 1);
  }
  return occurrence;
}

export function formatReminderDate(reminder: DateReminder) {
  const occurrence = nextOccurrence(reminder);
  if (!occurrence) return reminder.date;
  return occurrence.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: reminder.repeatsAnnually ? undefined : 'numeric',
  });
}

export function timingLabel(minutes: ReminderTiming) {
  if (minutes === 0) return 'At event time';
  if (minutes === 60) return '1 hour before';
  if (minutes === 1440) return '1 day before';
  return '1 week before';
}

export async function cancelScheduledReminder(identifier: string | null) {
  const notifications = getNotificationsModule();
  if (!identifier) return true;
  if (!notifications) return false;
  try {
    await notifications.cancelScheduledNotificationAsync(identifier);
    return true;
  } catch {
    return false;
  }
}

export async function initializeNotifications() {
  const notifications = getNotificationsModule();
  if (!notifications) return false;
  if (Platform.OS === 'android') {
    await notifications.setNotificationChannelAsync('important-dates', {
      name: 'Important dates',
      importance: notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 150, 250],
    });
  }
  return true;
}

export async function scheduleReminder(
  reminder: DateReminder,
): Promise<
  Pick<
    DateReminder,
    'notificationId' | 'notificationState' | 'notificationError'
  >
> {
  const notifications = getNotificationsModule();
  if (!notifications) {
    return {
      notificationId: null,
      notificationState: 'unavailable',
      notificationError:
        'Device reminders are available in the installed mobile app.',
    };
  }

  try {
    await initializeNotifications();
    let permission = await notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await notifications.requestPermissionsAsync();
    }
    if (!permission.granted) {
      return {
        notificationId: null,
        notificationState: 'permission-denied',
        notificationError:
          'Notifications are off. The date is saved, but no device alert is scheduled.',
      };
    }

    const eventDate = parseLocalDate(reminder.date, reminder.time);
    if (!eventDate) throw new Error('The saved date is invalid.');
    const alertDate = new Date(
      eventDate.getTime() - reminder.remindMinutesBefore * 60_000,
    );
    let trigger: import('expo-notifications').NotificationTriggerInput;
    if (reminder.repeatsAnnually) {
      trigger = {
        type:
          notifications.SchedulableTriggerInputTypes.YEARLY,
        month: alertDate.getMonth(),
        day: alertDate.getDate(),
        hour: alertDate.getHours(),
        minute: alertDate.getMinutes(),
        channelId: Platform.OS === 'android' ? 'important-dates' : undefined,
      };
    } else {
      if (alertDate.getTime() <= Date.now()) {
        return {
          notificationId: null,
          notificationState: 'past',
          notificationError: 'This reminder time has already passed.',
        };
      }
      trigger = {
        type: notifications.SchedulableTriggerInputTypes.DATE,
        date: alertDate,
        channelId: Platform.OS === 'android' ? 'important-dates' : undefined,
      };
    }

    const notificationId =
      await notifications.scheduleNotificationAsync({
        content: {
          title: `${reminder.eventName} · ${reminder.label}`,
          body:
            reminder.notes.trim() ||
            (reminder.repeatsAnnually
              ? 'An important annual date is coming up.'
              : 'An important date is coming up.'),
          sound: 'default',
          data: { reminderId: reminder.id },
        },
        trigger,
      });
    return {
      notificationId,
      notificationState: 'scheduled',
      notificationError: null,
    };
  } catch (error) {
    return {
      notificationId: null,
      notificationState: 'error',
      notificationError:
        error instanceof Error
          ? error.message
          : 'The device alert could not be scheduled.',
    };
  }
}