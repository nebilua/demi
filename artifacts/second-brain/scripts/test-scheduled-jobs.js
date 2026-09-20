const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'react-native') return { Platform: { OS: 'web' } };
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const jobs = await import(
    pathToFileURL(path.resolve(__dirname, '../lib/scheduledJobs.ts')).href
  );
  const now = new Date(2026, 8, 20, 9, 30);
  const nextDaily = jobs.nextJobRun('daily', '08:00', 1, now);
  assert.equal(nextDaily?.getDate(), 21);
  assert.equal(nextDaily?.getHours(), 8);

  const nextWeekly = jobs.nextJobRun('weekly', '10:15', 2, now);
  assert.equal(nextWeekly?.getDay(), 2);
  assert.equal(nextWeekly?.getHours(), 10);

  assert.match(
    jobs.validateScheduledJobDraft({
      name: '',
      kind: 'digest',
      cadence: 'daily',
      time: '08:00',
      weekday: 1,
      prompt: '',
      sources: [{ kind: 'memories' }],
      monitor: null,
      notificationPolicy: 'generic',
      retentionDays: 30,
      executionBudgetSeconds: 30,
    }),
    /name/,
  );
  assert.equal(
    jobs.validateScheduledJobDraft({
      name: 'Watch reminders',
      kind: 'monitor',
      cadence: 'daily',
      time: '08:00',
      weekday: 1,
      prompt: '',
      sources: [{ kind: 'calendar' }],
      monitor: { target: 'upcoming-reminder-count', operator: 'changes', threshold: 0 },
      notificationPolicy: 'generic',
      retentionDays: 7,
      executionBudgetSeconds: 30,
    }),
    null,
  );

  const normalized = jobs.normalizeScheduledJobs(
    JSON.stringify([
      {
        id: 'safe-job',
        name: 'Daily',
        kind: 'digest',
        cadence: 'daily',
        time: '08:00',
        weekday: 1,
        sources: [{ kind: 'memories' }],
        results: [{ status: 'completed', details: 'private result' }],
      },
    ]),
    now.getTime(),
  );
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].networkUse, 'never');
  assert.equal(normalized[0].runtime, 'on-device model');
  assert.equal(normalized[0].results.length, 1);

  console.log('Scheduled job model checks passed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
  });