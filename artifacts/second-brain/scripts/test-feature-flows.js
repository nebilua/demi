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

  const appContext = fs.readFileSync(
    path.resolve(__dirname, '../context/AppContext.tsx'),
    'utf8',
  );
  const homeScreen = fs.readFileSync(
    path.resolve(__dirname, '../app/index.tsx'),
    'utf8',
  );
  assert.match(appContext, /pendingMemoryCandidate/);
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