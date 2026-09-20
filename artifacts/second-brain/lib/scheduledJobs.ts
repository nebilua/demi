import { Platform } from 'react-native';
import {
  cancelScheduledReminder,
  getNotificationsModule,
  initializeNotifications,
} from '@/lib/reminders';

export type ScheduledJobKind = 'digest' | 'monitor';
export type JobCadence = 'daily' | 'weekly';
export type JobNotificationPolicy = 'silent' | 'generic';
export type JobResultStatus =
  | 'pending'
  | 'completed'
  | 'changed'
  | 'skipped'
  | 'failed'
  | 'interrupted';
export type MonitorTarget = 'memory-count' | 'upcoming-reminder-count';
export type MonitorOperator =
  | 'changes'
  | 'increases'
  | 'decreases'
  | 'at-least'
  | 'at-most';

export type JobFileSource = {
  kind: 'file';
  id: string;
  name: string;
  mimeType: string;
  content: string;
  sizeBytes: number;
  selectedAt: number;
};

export type JobSource =
  | { kind: 'memories' }
  | { kind: 'calendar' }
  | JobFileSource
  | { kind: 'connector'; id: string; label: string; provider: string };

export type MonitorCondition = {
  target: MonitorTarget;
  operator: MonitorOperator;
  threshold: number;
};

export type ScheduledJobResult = {
  id: string;
  startedAt: number;
  finishedAt: number;
  status: JobResultStatus;
  summary: string;
  details: string;
  trigger: 'scheduled' | 'manual' | 'recovery';
  sourceSnapshot: string;
  error: string | null;
};

export type ScheduledJob = {
  id: string;
  name: string;
  kind: ScheduledJobKind;
  cadence: JobCadence;
  time: string;
  weekday: number;
  prompt: string;
  sources: JobSource[];
  monitor: MonitorCondition | null;
  notificationPolicy: JobNotificationPolicy;
  retentionDays: 7 | 30;
  executionBudgetSeconds: 30 | 60;
  networkUse: 'never';
  runtime: 'on-device model' | 'on-device check';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastResultStatus: JobResultStatus | null;
  lastResultSummary: string | null;
  lastError: string | null;
  notificationId: string | null;
  monitorBaseline: number | null;
  results: ScheduledJobResult[];
};

export type ScheduledJobDraft = Pick<
  ScheduledJob,
  | 'name'
  | 'kind'
  | 'cadence'
  | 'time'
  | 'weekday'
  | 'prompt'
  | 'sources'
  | 'monitor'
  | 'notificationPolicy'
  | 'retentionDays'
  | 'executionBudgetSeconds'
>;

export type JobNotificationResult = {
  notificationId: string | null;
  state: 'scheduled' | 'permission-denied' | 'unavailable' | 'error';
  error: string | null;
};

const MAX_JOBS = 20;
const MAX_RESULTS_PER_JOB = 10;
const MAX_FILE_CONTENT = 120_000;
const JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanText(value: unknown, maximum: number) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum)
    : '';
}

export function parseJobTime(time: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

export function nextJobRun(
  cadence: JobCadence,
  time: string,
  weekday: number,
  now = new Date(),
) {
  const parsed = parseJobTime(time);
  if (!parsed || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return null;
  }
  const next = new Date(now);
  next.setHours(parsed.hour, parsed.minute, 0, 0);
  if (cadence === 'weekly') {
    let days = (weekday - next.getDay() + 7) % 7;
    if (days === 0 && next.getTime() <= now.getTime()) days = 7;
    next.setDate(next.getDate() + days);
  } else if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

export function validateScheduledJobDraft(draft: ScheduledJobDraft) {
  if (!cleanText(draft.name, 80)) return 'Add a name for this scheduled job.';
  if (!parseJobTime(draft.time)) return 'Choose a valid time in 24-hour format.';
  if (draft.sources.length === 0) return 'Choose at least one approved source.';
  if (draft.kind === 'monitor' && !draft.monitor) {
    return 'Add a monitor condition.';
  }
  if (
    draft.monitor &&
    (!Number.isInteger(draft.monitor.threshold) ||
      draft.monitor.threshold < 0 ||
      draft.monitor.threshold > 1000)
  ) {
    return 'Use a whole-number monitor threshold from 0 to 1000.';
  }
  if (draft.prompt.length > 600) return 'Keep the job instruction under 600 characters.';
  return null;
}

function normalizeSource(value: unknown): JobSource | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<JobSource>;
  if (source.kind === 'memories' || source.kind === 'calendar') return { kind: source.kind };
  if (source.kind === 'connector' && typeof source.id === 'string') {
    return {
      kind: 'connector',
      id: source.id.slice(0, 120),
      label: cleanText(source.label, 100) || 'Granted connector',
      provider: cleanText(source.provider, 80) || 'connector',
    };
  }
  if (
    source.kind === 'file' &&
    typeof source.id === 'string' &&
    typeof source.name === 'string' &&
    typeof source.content === 'string'
  ) {
    return {
      kind: 'file',
      id: source.id.slice(0, 120),
      name: cleanText(source.name, 120),
      mimeType: cleanText(source.mimeType, 100) || 'text/plain',
      content: source.content.slice(0, MAX_FILE_CONTENT),
      sizeBytes: typeof source.sizeBytes === 'number' ? source.sizeBytes : source.content.length,
      selectedAt: typeof source.selectedAt === 'number' ? source.selectedAt : Date.now(),
    };
  }
  return null;
}

export function normalizeScheduledJobs(value: string | null, now = Date.now()) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Partial<ScheduledJob> => Boolean(item && typeof item === 'object'))
      .map((item) => {
        const sources = Array.isArray(item.sources)
          ? item.sources.map(normalizeSource).filter((source): source is JobSource => source !== null)
          : [];
        const results: ScheduledJobResult[] = [];
        if (Array.isArray(item.results)) {
          for (const rawResult of item.results.slice(-MAX_RESULTS_PER_JOB)) {
            if (!rawResult || typeof rawResult !== 'object') continue;
            const result = rawResult as Partial<ScheduledJobResult>;
            results.push({
              id: typeof result.id === 'string' ? result.id : createId(),
              startedAt: typeof result.startedAt === 'number' ? result.startedAt : now,
              finishedAt: typeof result.finishedAt === 'number' ? result.finishedAt : now,
              status: ['pending', 'completed', 'changed', 'skipped', 'failed', 'interrupted'].includes(result.status as string)
                ? result.status as ScheduledJobResult['status']
                : 'failed',
              summary: cleanText(result.summary, 240),
              details: cleanText(result.details, 12_000),
              trigger: result.trigger === 'manual' || result.trigger === 'recovery' ? result.trigger : 'scheduled',
              sourceSnapshot: cleanText(result.sourceSnapshot, 120),
              error: result.error ? cleanText(result.error, 240) : null,
            });
          }
        }
        return {
          id: typeof item.id === 'string' ? item.id : createId(),
          name: cleanText(item.name, 80) || 'Scheduled job',
          kind: item.kind === 'monitor' ? 'monitor' : 'digest',
          cadence: item.cadence === 'weekly' ? 'weekly' : 'daily',
          time: parseJobTime(String(item.time ?? '08:00')) ? String(item.time) : '08:00',
          weekday:
            Number.isInteger(item.weekday) &&
            (item.weekday as number) >= 0 &&
            (item.weekday as number) <= 6
              ? (item.weekday as number)
              : 1,
          prompt: cleanText(item.prompt, 600),
          sources,
          monitor:
            item.monitor && typeof item.monitor === 'object'
              ? {
                  target:
                    (['memory-count', 'upcoming-reminder-count'] as string[]).includes((item.monitor as MonitorCondition).target)
                      ? (item.monitor as MonitorCondition).target
                      : 'memory-count',
                  operator:
                    (['changes', 'increases', 'decreases', 'at-least', 'at-most'] as string[]).includes((item.monitor as MonitorCondition).operator)
                      ? (item.monitor as MonitorCondition).operator
                      : 'changes',
                  threshold:
                    Number.isInteger((item.monitor as MonitorCondition).threshold)
                      ? Math.max(0, Math.min(1000, (item.monitor as MonitorCondition).threshold))
                      : 0,
                }
              : null,
          notificationPolicy: item.notificationPolicy === 'silent' ? 'silent' : 'generic',
          retentionDays: item.retentionDays === 7 ? 7 : 30,
          executionBudgetSeconds: item.executionBudgetSeconds === 60 ? 60 : 30,
          networkUse: 'never',
          runtime: item.kind === 'monitor' ? 'on-device check' : 'on-device model',
          enabled: item.enabled !== false,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
          nextRunAt: typeof item.nextRunAt === 'number' ? item.nextRunAt : null,
          lastRunAt: typeof item.lastRunAt === 'number' ? item.lastRunAt : null,
          lastResultStatus: ['pending', 'completed', 'changed', 'skipped', 'failed', 'interrupted'].includes(item.lastResultStatus as string)
            ? item.lastResultStatus
            : null,
          lastResultSummary: item.lastResultSummary ? cleanText(item.lastResultSummary, 240) : null,
          lastError: item.lastError ? cleanText(item.lastError, 240) : null,
          notificationId: typeof item.notificationId === 'string' ? item.notificationId : null,
          monitorBaseline: typeof item.monitorBaseline === 'number' ? item.monitorBaseline : null,
          results,
        } as ScheduledJob;
      })
      .slice(0, MAX_JOBS);
  } catch {
    return [];
  }
}

export function formatJobRun(value: number | null) {
  if (!value) return 'Not scheduled';
  return new Date(value).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function jobNotificationBody(job: Pick<ScheduledJob, 'kind'>) {
  return job.kind === 'digest'
    ? 'Your private Demi digest is ready. Open Demi to read it.'
    : 'A Demi monitor detected a configured change. Open Demi to review it.';
}

export async function cancelScheduledJobNotification(identifier: string | null) {
  return cancelScheduledReminder(identifier);
}

export async function scheduleScheduledJobNotification(
  job: Pick<ScheduledJob, 'id' | 'name' | 'kind' | 'cadence' | 'time' | 'weekday' | 'notificationPolicy'>,
): Promise<JobNotificationResult> {
  if (job.notificationPolicy === 'silent' || job.kind === 'monitor') {
    return { notificationId: null, state: 'scheduled', error: null };
  }
  const notifications = getNotificationsModule();
  if (!notifications) {
    return {
      notificationId: null,
      state: 'unavailable',
      error: 'Scheduled notifications are available in the installed mobile app.',
    };
  }
  try {
    let permission = await notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await notifications.requestPermissionsAsync();
    }
    if (!permission.granted) {
      return {
        notificationId: null,
        state: 'permission-denied',
        error: 'Notifications are off. The job is saved, but Android cannot alert you.',
      };
    }
    await initializeNotifications();
    if (Platform.OS === 'android') {
      await notifications.setNotificationChannelAsync('scheduled-jobs', {
        name: 'Scheduled jobs',
        importance: notifications.AndroidImportance.DEFAULT,
        sound: 'default',
        vibrationPattern: [0, 180, 100, 180],
      });
    }
    const parsed = parseJobTime(job.time)!;
    const trigger = (
      job.cadence === 'weekly'
        ? {
            type: notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: job.weekday + 1,
            hour: parsed.hour,
            minute: parsed.minute,
            channelId: Platform.OS === 'android' ? 'scheduled-jobs' : undefined,
          }
        : {
            type: notifications.SchedulableTriggerInputTypes.DAILY,
            hour: parsed.hour,
            minute: parsed.minute,
            channelId: Platform.OS === 'android' ? 'scheduled-jobs' : undefined,
          }
    ) as import('expo-notifications').NotificationTriggerInput;
    const notificationId = await notifications.scheduleNotificationAsync({
      content: {
        title: job.kind === 'digest' ? 'Demi · digest ready' : 'Demi · monitor change',
        body: jobNotificationBody(job),
        data: { scheduledJobId: job.id },
      },
      trigger,
    });
    return { notificationId, state: 'scheduled', error: null };
  } catch (error) {
    return {
      notificationId: null,
      state: 'error',
      error: error instanceof Error ? error.message : 'Android could not schedule this job.',
    };
  }
}

export async function notifyScheduledJobResult(
  job: Pick<ScheduledJob, 'id' | 'name' | 'kind'>,
) {
  const notifications = getNotificationsModule();
  if (!notifications) return false;
  try {
    const permission = await notifications.getPermissionsAsync();
    if (!permission.granted) return false;
    await initializeNotifications();
    await notifications.scheduleNotificationAsync({
      content: {
        title: job.kind === 'digest' ? 'Demi · digest ready' : 'Demi · monitor change',
        body: jobNotificationBody(job),
        data: { scheduledJobId: job.id, result: true },
      },
      trigger: {
        type: notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(Date.now() + 1000),
        channelId: Platform.OS === 'android' ? 'scheduled-jobs' : undefined,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export const SCHEDULED_JOB_RETENTION_MS = JOB_RETENTION_MS;