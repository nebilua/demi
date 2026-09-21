const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const memory = await import(
    pathToFileURL(path.resolve(__dirname, '../lib/memory.ts')).href
  );
  const limits = await import(
    pathToFileURL(path.resolve(__dirname, '../lib/localLimits.ts')).href
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
  assert.equal(limits.MAX_CONVERSATION_TURNS, 80);
  assert.equal(limits.MAX_MEMORIES, 100);
  assert.equal(limits.MAX_MEMORIES_IN_PROMPT, 6);

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
  assert.deepEqual(memory.normalizeMemoryAliases([' Alex ', 'alex', '']), ['Alex']);
  const aliasMemory = {
    ...approvedMemory,
    id: 'alias-memory',
    aliases: ['Alex'],
  };
  assert.equal(
    memory
      .selectRelevantMemories([aliasMemory], 'What gift should I get Alex?')
      .at(0)?.id,
    'alias-memory',
  );
  const ambiguousAliasMemory = {
    ...secondApprovedMemory,
    id: 'ambiguous-alias-memory',
    aliases: ['Alex'],
  };
  assert.deepEqual(
    memory.selectRelevantMemories(
      [aliasMemory, ambiguousAliasMemory],
      'What gift should I get Alex?',
    ),
    [],
  );
  const aliasVariantCases = [
    ['Alex', 'alex'],
    ['Mary Jane', ' Mary   Jane '],
    ["O'Connor", 'O Connor'],
  ];
  for (const [firstAlias, secondAlias] of aliasVariantCases) {
    const first = {
      ...aliasMemory,
      id: `variant-first-${firstAlias}`,
      aliases: [firstAlias],
    };
    const second = {
      ...secondApprovedMemory,
      id: `variant-second-${secondAlias}`,
      aliases: [secondAlias],
    };
    const conflictKeys = memory.getConflictingMemoryAliasKeys([first, second]);
    assert.ok(
      conflictKeys.has(memory.memoryFingerprint(firstAlias)),
      `Expected ${JSON.stringify([firstAlias, secondAlias])} to share a conflict`,
    );
    assert.deepEqual(
      memory
        .getConflictingMemoryOwners([first, second], first.id, secondAlias)
        .map((item) => item.id),
      [second.id],
    );
    assert.deepEqual(
      memory.selectRelevantMemories(
        [first, second],
        `What gift should I get ${secondAlias}?`,
      ),
      [],
    );
  }
  const archivedVariantOwner = {
    ...secondApprovedMemory,
    id: 'archived-variant-owner',
    aliases: ['  mary-jane  '],
    archivedAt: 42,
  };
  const activeVariantOwner = {
    ...aliasMemory,
    id: 'active-variant-owner',
    aliases: ['Mary Jane'],
  };
  assert.equal(
    memory
      .getConflictingMemoryAliasKeys([activeVariantOwner, archivedVariantOwner])
      .has(memory.memoryFingerprint('Mary Jane')),
    false,
  );
  assert.deepEqual(
    memory.getConflictingMemoryOwners(
      [activeVariantOwner, archivedVariantOwner],
      activeVariantOwner.id,
      'Mary Jane',
    ),
    [],
  );
  const distinctAliasOwner = {
    ...secondApprovedMemory,
    id: 'distinct-alias-owner',
    aliases: ['Mary Janet'],
  };
  assert.equal(
    memory
      .getConflictingMemoryAliasKeys([activeVariantOwner, distinctAliasOwner])
      .has(memory.memoryFingerprint('Mary Jane')),
    false,
  );
  assert.deepEqual(
    memory.getConflictingMemoryOwners(
      [activeVariantOwner, distinctAliasOwner],
      activeVariantOwner.id,
      'Mary Jane',
    ),
    [],
  );
  assert.deepEqual(
    memory.parseApprovedMemories(JSON.stringify([aliasMemory]))[0]?.aliases,
    ['Alex'],
  );
  const archivedAliasMemory = {
    ...aliasMemory,
    id: 'archived-alias-memory',
    aliases: ['Morgan'],
    archivedAt: 42,
  };
  assert.deepEqual(
    memory.selectRelevantMemories(
      [archivedAliasMemory],
      'What gift should I get Morgan?',
    ),
    [],
  );
  const reloadedAfterDelete = memory.parseApprovedMemories(
    JSON.stringify([aliasMemory].filter((item) => item.id !== aliasMemory.id)),
  );
  assert.deepEqual(
    memory.selectRelevantMemories(
      reloadedAfterDelete,
      'What gift should I get Alex?',
    ),
    [],
  );
  const replacementAliasMemory = {
    ...aliasMemory,
    id: 'replacement-alias-memory',
    content: 'Person Z enjoys tea.',
  };
  const reloadedReplacement = memory.parseApprovedMemories(
    JSON.stringify([replacementAliasMemory]),
  );
  assert.equal(
    memory
      .selectRelevantMemories(
        reloadedReplacement,
        'What gift should I get Alex?',
      )
      .at(0)?.id,
    'replacement-alias-memory',
  );

  const makeApprovedMemory = (id, content, updatedAt, archivedAt = null) => ({
    id,
    category: 'person',
    content,
    source: {
      turnId: `turn-${id}`,
      excerpt: content,
      createdAt: updatedAt,
    },
    createdAt: updatedAt,
    updatedAt,
    archivedAt,
  });
  const targetMemory = makeApprovedMemory(
    'large-target-x',
    'Person X likes hiking gifts and olive green gear.',
    1000,
  );
  const duplicateTarget = {
    ...targetMemory,
    id: 'large-target-duplicate',
    updatedAt: 2000,
  };
  const archivedTarget = makeApprovedMemory(
    'large-target-archived',
    'Person X likes hiking gifts and red gear.',
    3000,
    4000,
  );
  const similarPersonY = makeApprovedMemory(
    'large-similar-y',
    'Person Y likes hiking gifts and blue gear.',
    4000,
  );
  const largeMemoryLibrary = [
    targetMemory,
    duplicateTarget,
    archivedTarget,
    similarPersonY,
    ...Array.from({ length: 116 }, (_, index) =>
      makeApprovedMemory(
        `large-distractor-${index}`,
        `Person ${index + 10} likes hiking gifts and color ${index}.`,
        index + 10,
      ),
    ),
  ];
  const largeLibraryResults = memory.selectRelevantMemories(
    largeMemoryLibrary,
    'What hiking gift should I choose for Person X?',
    6,
  );
  assert.equal(largeLibraryResults[0]?.id, 'large-target-x');
  assert.ok(
    largeLibraryResults.findIndex((item) => item.id === 'large-target-x') <
      largeLibraryResults.findIndex((item) => item.id === 'large-similar-y'),
  );
  assert.equal(
    largeLibraryResults.filter((item) => item.id === 'large-target-duplicate').length,
    0,
  );
  assert.equal(
    largeLibraryResults.filter((item) => item.id === 'large-target-archived').length,
    0,
  );
  assert.equal(
    memory.selectRelevantMemories(
      largeMemoryLibrary,
      'Which hiking gifts should I choose?',
      6,
    ).length,
    6,
  );
  assert.deepEqual(
    memory.selectRelevantMemories(
      largeMemoryLibrary,
      'What is the capital of France?',
      6,
    ),
    [],
  );
  const parsedLargeLibrary = memory.parseApprovedMemories(
    JSON.stringify([
      ...largeMemoryLibrary,
      ...Array.from({ length: 12 }, (_, index) =>
        makeApprovedMemory(
          `parsed-tail-${index}`,
          `A separate durable fact number ${index}.`,
          5000 + index,
        ),
      ),
    ]),
  );
  assert.equal(parsedLargeLibrary.length, 100);
  assert.equal(
    parsedLargeLibrary.filter(
      (item) => item.content === targetMemory.content,
    ).length,
    1,
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

  const appContext = fs.readFileSync(
    path.resolve(__dirname, '../context/AppContext.tsx'),
    'utf8',
  );
  const offlineVoice = fs.readFileSync(
    path.resolve(__dirname, '../lib/offlineVoice.ts'),
    'utf8',
  );
  const localStorageUsage = fs.readFileSync(
    path.resolve(__dirname, '../lib/localStorageUsage.ts'),
    'utf8',
  );
  const settingsScreen = fs.readFileSync(
    path.resolve(__dirname, '../app/settings.tsx'),
    'utf8',
  );
  const offlineTts = fs.readFileSync(
    path.resolve(__dirname, '../modules/offline-tts/android/src/main/java/com/secondbrain/offlinetts/SecondBrainOfflineTtsModule.kt'),
    'utf8',
  );
  assert.match(appContext, /cleanupUnusedModelFiles/);
  assert.match(appContext, /reclaimUnusedModelFiles/);
  assert.match(appContext, /storageDetailsExpanded/);
  assert.match(appContext, /setStorageDetailsExpanded/);
  assert.match(appContext, /storageUsageRefreshing/);
  assert.match(appContext, /failedFiles/);
  assert.match(appContext, /remaining\.exists/);
  assert.match(appContext, /MODEL_STORAGE_SAFETY_MARGIN_BYTES/);
  assert.match(appContext, /requiresOnDeviceRecognition: true/);
  assert.match(offlineVoice, /voiceMatchesLanguage/);
  assert.match(offlineTts, /isNetworkConnectionRequired/);
  assert.match(offlineTts, /preferredVoiceId/);
  assert.match(localStorageUsage, /getFreeDiskStorageAsync/);
  assert.match(localStorageUsage, /reclaimableModels/);
  assert.match(localStorageUsage, /cacheDirectory/);
  assert.match(settingsScreen, /Refresh local storage usage/);
  assert.match(settingsScreen, /toggle-storage-details/);
  assert.match(settingsScreen, /accessibilityState=\{\{ expanded: detailsExpanded \}\}/);
  assert.match(settingsScreen, /onDetailsExpandedChange/);
  assert.match(settingsScreen, /storage-refresh-indicator/);
  assert.match(settingsScreen, /Refreshing local storage usage/);
  assert.match(settingsScreen, /reclaim-model-files/);
  assert.match(settingsScreen, /confirm-reclaim-model-files/);
  assert.match(settingsScreen, /Active model is never included/);
  assert.match(settingsScreen, /never deletes\s+active models or saved memories/);

  const reminders = fs.readFileSync(
    path.resolve(__dirname, '../lib/reminders.ts'),
    'utf8',
  );
  assert.match(reminders, /month: alertDate\.getMonth\(\) \+ 1/);
  assert.match(reminders, /if \(!draft\.repeatsAnnually && triggerDate\.getTime\(\) <= Date\.now\(\)\)/);
  assert.match(reminders, /scheduleNotificationAsync/);

  const calendarContext = fs.readFileSync(
    path.resolve(__dirname, '../context/CalendarContext.tsx'),
    'utf8',
  );
  const homeScreen = fs.readFileSync(
    path.resolve(__dirname, '../app/index.tsx'),
    'utf8',
  );
  const offlineLlm = fs.readFileSync(
    path.resolve(__dirname, '../lib/offlineLlm.ts'),
    'utf8',
  );
  assert.match(appContext, /pendingMemoryCandidate/);
  assert.match(appContext, /parseConversationalReminder/);
  assert.match(appContext, /slice\(-6\)/);
  assert.match(appContext, /updateMemoryAliases/);
  assert.match(
    offlineLlm,
    /profile\?\.memories \?\? \[\]\)\.slice\(0, MAX_MEMORIES_IN_PROMPT\)/,
  );
  assert.match(calendarContext, /scheduleReminder\(base\)/);
  assert.match(appContext, /memoryFingerprint\(memory\.content\).*memoryFingerprint\(content\)/s);
  assert.match(homeScreen, /save-memory-candidate/);
  assert.match(homeScreen, /review-date-candidate/);
  assert.match(homeScreen, /pathname: '\/calendar\/edit'/);
  assert.doesNotMatch(homeScreen, /voiceInputStatus === 'idle'[\s\S]*handleSend\(\)/);
  assert.match(homeScreen, /Draft ready — review before sending/);
  assert.match(homeScreen, /accessibilityLabel="Message draft"/);
  assert.match(homeScreen, /accessibilityLabel="Send message"/);
  assert.match(appContext, /voiceRecognitionRunRef/);
  assert.match(appContext, /clearRecognitionSubscriptions/);
  assert.match(appContext, /if \(runId !== voiceRecognitionRunRef\.current\) return/);
  const memoriesScreen = fs.readFileSync(
    path.resolve(__dirname, '../app/memories.tsx'),
    'utf8',
  );
  assert.match(memoriesScreen, /alias-input-/);
  assert.match(memoriesScreen, /remove-memory-alias-/);
  assert.match(memoriesScreen, /getConflictingMemoryOwners/);
  assert.match(memoriesScreen, /conflicting-memory-/);
  assert.match(memoriesScreen, /updateMemoryAliases/);

  console.log('Second Brain feature-flow regression checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});