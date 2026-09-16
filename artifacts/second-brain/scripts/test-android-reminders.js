const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
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

  permission = { granted: false, canAskAgain: false };
  const denied = await reminders.scheduleReminder({
    ...draft,
    id: 'chat-reminder-denied',
  });
  assert.equal(denied.notificationId, null);
  assert.equal(denied.notificationState, 'permission-denied');
  assert.match(denied.notificationError, /saved/);
  assert.equal(scheduledCalls.length, 1);

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