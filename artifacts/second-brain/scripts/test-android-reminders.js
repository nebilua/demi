const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

process.env.TZ = 'Asia/Amman';

const channelCalls = [];
const scheduledCalls = [];
let permission = { granted: true, canAskAgain: false };

const notifications = {
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date', YEARLY: 'yearly' },
  setNotificationHandler() {},
  async setNotificationChannelAsync(channelId, config) {
    channelCalls.push({ channelId, config });
  },
  async getPermissionsAsync() {
    return permission;
  },
  async requestPermissionsAsync() {
    return permission;
  },
  async scheduleNotificationAsync(request) {
    scheduledCalls.push(request);
    return `android-notification-${scheduledCalls.length}`;
  },
  async cancelScheduledNotificationAsync() {},
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'react-native') return { Platform: { OS: 'android', Version: 35 } };
  if (request === 'expo-notifications') return notifications;
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const appConfig = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../app.json'), 'utf8'),
  );
  assert.ok(
    appConfig.expo.android.permissions.includes(
      'android.permission.SCHEDULE_EXACT_ALARM',
    ),
    'Android builds must declare exact-alarm access so scheduled reminders can fire on time.',
  );

  const reminders = await import(
    pathToFileURL(path.resolve(__dirname, '../lib/reminders.ts')).href
  );
  const draft = {
    id: 'chat-reminder-1',
    label: 'Reminder',
    eventName: 'Buy pickles',
    date: '2099-05-10',
    time: '14:30',
    notes: '',
    repeatsAnnually: false,
    remindMinutesBefore: 0,
    notificationId: null,
    retiredNotificationIds: [],
    notificationState: 'pending',
    notificationError: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  };

  const result = await reminders.scheduleReminder(draft);
  assert.deepEqual(result, {
    notificationId: 'android-notification-1',
    notificationState: 'scheduled',
    notificationError: null,
  });
  assert.equal(channelCalls.length, 1);
  assert.equal(channelCalls[0].channelId, 'important-dates');
  assert.equal(scheduledCalls.length, 1);
  assert.equal(scheduledCalls[0].content.data.reminderId, 'chat-reminder-1');
  assert.equal(scheduledCalls[0].trigger.type, 'date');
  assert.equal(
    scheduledCalls[0].trigger.date.toISOString(),
    new Date(2099, 4, 10, 14, 30, 0, 0).toISOString(),
  );

  const dateOnly = await reminders.scheduleReminder({
    ...draft,
    id: 'date-only-reminder',
    date: '2099-06-11',
    time: null,
  });
  assert.equal(dateOnly.notificationState, 'scheduled');
  assert.equal(scheduledCalls[1].trigger.type, 'date');
  assert.equal(
    scheduledCalls[1].trigger.date.toISOString(),
    new Date(2099, 5, 11, 9, 0, 0, 0).toISOString(),
    'date-only reminders keep their established 9:00 AM local-time behavior',
  );

  permission = { granted: false, canAskAgain: false };
  const denied = await reminders.scheduleReminder({
    ...draft,
    id: 'chat-reminder-denied',
  });
  assert.equal(denied.notificationId, null);
  assert.equal(denied.notificationState, 'permission-denied');
  assert.match(denied.notificationError, /saved/);
  assert.equal(scheduledCalls.length, 2);

  permission = { granted: true, canAskAgain: false };
  const recovered = await reminders.scheduleReminder({
    ...draft,
    id: 'chat-reminder-recovered',
  });
  assert.equal(recovered.notificationState, 'scheduled');
  assert.equal(recovered.notificationId, 'android-notification-3');
  assert.equal(scheduledCalls.length, 3);

  console.log('Android reminder scheduling checks passed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
  });