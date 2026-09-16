const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const memory = await import(
    pathToFileURL(path.resolve(__dirname, '../lib/memory.ts')).href
  );
  const candidate = memory.parseMemoryCandidate(
    JSON.stringify({
      kind: 'memory',
      category: 'preference',
      content: 'The user prefers concise answers.',
      sourceExcerpt: 'I prefer concise answers',
      explicit: true,
    }),
    [],
    'I prefer concise answers',
  );
  assert.equal(candidate?.kind, 'memory');
  assert.equal(candidate?.explicit, true);

  const conversationalReminder = memory.parseConversationalReminder(
    'Remind me to buy pickles in one day.',
    new Date(2026, 8, 16, 14, 37, 0, 0),
  );
  assert.equal(conversationalReminder?.kind, 'important-date');
  assert.equal(conversationalReminder?.date, '2026-09-17');
  assert.equal(conversationalReminder?.time, '14:37');
  assert.equal(conversationalReminder?.eventName, 'buy pickles');
  const twelveHourReminder = memory.parseConversationalReminder(
    'Remind me to call Mom tomorrow at 9 AM.',
    new Date(2026, 8, 16, 14, 37, 0, 0),
  );
  assert.equal(twelveHourReminder?.date, '2026-09-17');
  assert.equal(twelveHourReminder?.time, '09:00');
  assert.equal(twelveHourReminder?.eventName, 'call Mom');
  const twentyFourHourReminder = memory.parseConversationalReminder(
    'Remind me to check the oven in two hours at 14:30.',
    new Date(2026, 8, 16, 10, 0, 0, 0),
  );
  assert.equal(twentyFourHourReminder?.date, '2026-09-16');
  assert.equal(twentyFourHourReminder?.time, '14:30');
  assert.equal(twentyFourHourReminder?.eventName, 'check the oven');
  assert.equal(
    memory.parseConversationalReminder(
      'Remind me to call Mom tomorrow at 9.',
      new Date(2026, 8, 16, 14, 37, 0, 0),
    ),
    null,
  );
  assert.equal(
    memory.parseConversationalReminder(
      'Remind me to call Mom tomorrow at 25:00.',
      new Date(2026, 8, 16, 14, 37, 0, 0),
    ),
    null,
  );
  assert.equal(
    memory.hasConversationalReminderIntent('Remind me to call Mom tomorrow at 9.'),
    true,
  );
  assert.equal(
    memory.parseConversationalReminder('Remind me to buy pickles.'),
    null,
  );

  const approvedMemory = {
    id: 'pickle-memory',
    category: 'person',
    content: 'Person X likes pickles.',
    source: {
      turnId: 'turn-1',
      excerpt: 'Person X likes pickles.',
      createdAt: 1,
    },
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
  };
  const secondApprovedMemory = {
    ...approvedMemory,
    id: 'sock-memory',
    content: 'Person Y loves colorful socks.',
    updatedAt: 2,
  };
  assert.equal(
    memory
      .selectRelevantMemories(
        [approvedMemory, secondApprovedMemory],
        'What would be a good present for Person X?',
        6,
      )
      .at(0)?.id,
    'pickle-memory',
  );
  assert.equal(
    memory
      .selectRelevantMemories(
        [approvedMemory, secondApprovedMemory],
        "What's Person X's favorite snack?",
      )
      .at(0)?.id,
    'pickle-memory',
  );
  assert.deepEqual(
    memory.selectRelevantMemories([approvedMemory], 'What should I gift them?'),
    [],
  );
  assert.equal(
    memory
      .selectRelevantMemories(
        [approvedMemory],
        'What should I gift them?',
        6,
        'user: Person X likes pickles.',
      )
      .at(0)?.id,
    'pickle-memory',
  );
  assert.deepEqual(
    memory.selectRelevantMemories(
      [approvedMemory],
      'What is my favorite color?',
      6,
      'user: Person X likes pickles.',
    ),
    [],
  );
  assert.deepEqual(
    memory.selectRelevantMemories(
      [approvedMemory],
      'What is the capital of France?',
      6,
      'user: Person X likes pickles.',
    ),
    [],
  );

  const duplicate = memory.parseMemoryCandidate(
    JSON.stringify({
      kind: 'memory',
      category: 'preference',
      content: 'The user prefers concise answers.',
      sourceExcerpt: 'I prefer concise answers',
    }),
    [
      {
        id: 'existing',
        category: 'preference',
        content: 'The user prefers concise answers.',
        source: { turnId: 'turn', excerpt: 'I prefer concise answers', createdAt: 1 },
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null,
      },
    ],
    'I prefer concise answers',
  );
  assert.equal(duplicate, null);

  const reminders = fs.readFileSync(
    path.resolve(__dirname, '../lib/reminders.ts'),
    'utf8',
  );
  assert.match(reminders, /month: alertDate\.getMonth\(\) \+ 1/);
  assert.match(reminders, /if \(!draft\.repeatsAnnually && triggerDate\.getTime\(\) <= Date\.now\(\)\)/);
  assert.match(reminders, /scheduleNotificationAsync/);

  const appContext = fs.readFileSync(
    path.resolve(__dirname, '../context/AppContext.tsx'),
    'utf8',
  );
  const calendarContext = fs.readFileSync(
    path.resolve(__dirname, '../context/CalendarContext.tsx'),
    'utf8',
  );
  const homeScreen = fs.readFileSync(
    path.resolve(__dirname, '../app/index.tsx'),
    'utf8',
  );
  assert.match(appContext, /pendingMemoryCandidate/);
  assert.match(appContext, /parseConversationalReminder/);
  assert.match(appContext, /slice\(-6\)/);
  assert.match(calendarContext, /scheduleReminder\(base\)/);
  assert.match(appContext, /memoryFingerprint\(memory\.content\).*memoryFingerprint\(content\)/s);
  assert.match(homeScreen, /save-memory-candidate/);
  assert.match(homeScreen, /review-date-candidate/);
  assert.match(homeScreen, /pathname: '\/calendar\/edit'/);

  console.log('Second Brain feature-flow regression checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});