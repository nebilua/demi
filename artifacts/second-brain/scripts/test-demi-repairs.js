const assert = require('node:assert/strict');
const Module = require('node:module');
const React = require('react');
const Renderer = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

const records = new Map();
const asyncRecords = new Map([['@second-brain/local-model-v1', JSON.stringify({
  id: 'test', name: 'test-q4.gguf', uri: 'file:///private/model.gguf', sizeBytes: 100, importedAt: 1, contextSize: 1024,
})]]);
const appListeners = new Set();
const listeners = new Map();
let permission = 'granted';
let microphoneRequests = 0;
let voiceStarts = [];
let nativeCalls = 0;
let activeCalls = 0;
let maxCalls = 0;
let failure = false;
let hold = null;
let cloudCalls = 0;
let capturedPrompts = [];
let contexts = [];
let protectedScreen = false;
let screenRead = null;

function makeContext() {
  const context = {
    model: { desc: 'test' }, gpu: false, systemInfo: 'test', released: false,
    async getFormattedChat(messages) {
      assert.equal(this.released, false);
      return { prompt: messages.map(m => `[${m.role}]${m.content}`).join('\n') + '[assistant]' };
    },
    async tokenize(text) { assert.equal(this.released, false); return { tokens: Array.from({ length: Math.ceil(text.length / 4) }, (_, i) => i) }; },
    async completion(options, callback) {
      assert.equal(this.released, false);
      activeCalls++; maxCalls = Math.max(maxCalls, activeCalls);
      nativeCalls++;
      capturedPrompts.push(options.prompt);
      try {
        assert.ok(Math.ceil(options.prompt.length / 4) + options.n_predict + 32 <= 1024, 'prompt + output reserve fits mocked context');
        if (hold) await hold;
        callback?.({ token: 'valid partial ' });
        if (failure) throw new Error('HostFunction /private/model.gguf PRIVATE_SENTINEL');
        const text = options.prompt.includes('PRIVATE_SENTINEL') ? 'derived PRIVATE_SENTINEL' : 'local response';
        return { text, timings: { predicted_per_second: 12 } };
      } finally { activeCalls--; }
    },
    async stopCompletion() {},
    cacheCleared: false,
    async clearCache(wipe) { assert.equal(activeCalls, 0); assert.equal(wipe, true); this.cacheCleared = true; },
    async release() {
      assert.equal(activeCalls, 0, 'release never races any native completion');
      this.released = true;
    },
  };
  contexts.push(context);
  return context;
}
const voiceModule = {
  addListener(name, callback) {
    const entry = { callback };
    const list = listeners.get(name) ?? [];
    list.push(entry); listeners.set(name, list);
    return { remove: () => { entry.removed = true; } };
  },
};
function emit(name, event) {
  for (const item of listeners.get(name) ?? []) if (!item.removed) item.callback(event);
}
const nativeVoice = {
  getVoiceModule: () => voiceModule,
  getVoiceReadiness: async () => ({ inputAvailable: true, outputAvailable: true, error: null }),
  getOfflineVoices: async () => [{ id: 'local', language: 'en-US' }],
  voiceMatchesLanguage: () => true,
  startLocalRecognition: async id => { voiceStarts.push(id); emit('recognitionStatus', { sessionId: id, status: 'listening' }); },
  stopLocalRecognition: async id => {
    emit('recognitionResult', { sessionId: id, transcript: 'editable words', isFinal: true });
    emit('recognitionStatus', { sessionId: id, status: 'completed' });
  },
  cancelLocalRecognition: async () => {},
  stopLocalSpeech: async () => {},
  speakLocally: async (_text, options) => { options.onStart?.(); options.onDone?.(); },
  prepareVoiceModels: async () => {},
  voiceErrorMessage: () => 'Offline speech failed. Retry in Settings.',
  voiceSelfTestDiagnosis: () => ({ outcome: 'error', title: 'Error', detail: 'Retry', nextAction: 'Retry' }),
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'react-native') return {
    Platform: { OS: 'android', Version: 35 },
    AppState: { addEventListener: (_event, callback) => { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } },
    PermissionsAndroid: { PERMISSIONS: { RECORD_AUDIO: 'microphone' }, RESULTS: { GRANTED: 'granted', NEVER_ASK_AGAIN: 'blocked' }, request: async () => { microphoneRequests++; return permission; } },
  };
  if (request === 'expo-device') return { totalMemory: 8 * 1024 ** 3, supportedCpuArchitectures: ['arm64-v8a'], modelName: 'mock device, not Pixel benchmark' };
  if (request === 'llama.rn') return { installJsi: async () => {}, initLlama: async () => makeContext() };
  if (request === '@react-native-async-storage/async-storage') return {
    getItem: async key => asyncRecords.get(key) ?? null,
    setItem: async (key, value) => asyncRecords.set(key, value),
    removeItem: async key => asyncRecords.delete(key),
  };
  if (request === 'expo-document-picker') return { getDocumentAsync: async () => ({ canceled: true }) };
  if (request.startsWith('expo-file-system')) return {
    documentDirectory: 'file:///docs/', cacheDirectory: 'file:///cache/',
    getInfoAsync: async () => ({ exists: true, size: 50 }),
    readDirectoryAsync: async () => [],
    readAsStringAsync: async () => 'PRIVATE_SENTINEL selected text',
    deleteAsync: async () => {},
  };
  if (request === 'expo-haptics') return { impactAsync: async () => {}, ImpactFeedbackStyle: { Light: 'light' } };
  if (request.includes('lib/secureLocalStorage')) return {
    getSecureStorageProtection: () => 'encrypted',
    migratePlaintextRecord: async key => records.get(key) ?? null,
    readSecureRecord: async key => records.get(key) ?? null,
    writeSecureRecord: async (key, value) => records.set(key, value),
    removeSecureRecord: async key => records.delete(key),
  };
  if (request.includes('lib/offlineVoice')) return nativeVoice;
  if (request.includes('lib/localStorageUsage')) return { measureLocalStorageUsage: async () => ({}), createUnavailableLocalStorageUsage: () => ({}) };
  if (request.includes('lib/fileHash')) return { computeFileSha256: async () => 'test' };
  if (request.includes('lib/screenAccess')) return {
    getScreenAccessStatus: async () => ({ platform: 'android', accessibility: 'enabled', mediaProjection: 'unavailable', screenshotAvailable: true }),
    getAccessibilitySnapshot: async () => screenRead ? screenRead : ({
      available: true, textAvailable: !protectedScreen, text: protectedScreen ? '' : 'PRIVATE_SENTINEL visible text',
      protectedContent: protectedScreen, excluded: protectedScreen,
    }),
    captureScreenshotText: async () => 'PRIVATE_SENTINEL screenshot OCR',
    readImageText: async () => 'PRIVATE_SENTINEL selected image OCR',
    stopScreenSession: async () => {},
    openAccessibilitySettings: async () => {},
  };
  if (request.includes('lib/cloudFallback')) {
    const actual = originalLoad.call(this, request, parent, isMain);
    return { ...actual, requestCloudInference: async () => { cloudCalls++; return { text: 'cloud' }; } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { budgetPrompt } = require('../lib/promptBudget.ts');
const { scheduleNative, releaseNativeContext } = require('../lib/inferenceScheduler.ts');
const { NativeInferenceError } = require('../lib/inferenceErrors.ts');
const privacy = require('../lib/privacyCapabilities.ts');
const screen = require('../lib/sharedScreenContext.ts');
const diagnostics = require('../lib/runtimeDiagnostics.ts');
const { AppProvider, useApp, useChat } = require('../context/AppContext.tsx');
let app, chat;
function Probe() { app = useApp(); chat = useChat(); return null; }
const act = Renderer.act;

async function pureChecks() {
  const now = 1000;
  let state = privacy.createDefaultPrivacyState(now);
  state = privacy.updateCapabilityGrant(state, 'device.screen-access', 'approved', now);
  assert.equal(privacy.isCapabilityActive(state, 'device.screen-access', now + 1), true);
  assert.equal(privacy.isCapabilityActive(privacy.parsePrivacyState(JSON.stringify(state), now + 1), 'device.screen-access', now + 1), false);
  assert.equal(privacy.isCapabilityActive({ ...state, globalPause: true }, 'device.screen-access', now), false);
  const ended = privacy.endPrivacySession(state, now + 2);
  assert.equal(privacy.isCapabilityActive(ended, 'device.screen-access', now + 2), false);
  assert.deepEqual(ended.capabilities['local.inference'], state.capabilities['local.inference'], 'session end does not clobber non-session grants');
  state.capabilities['device.screen-access'].lifetime = '24-hours';
  state = privacy.updateCapabilityGrant(state, 'device.screen-access', 'approved', now);
  assert.equal(privacy.isCapabilityActive(state, 'device.screen-access', now + 23 * 3600_000), true);
  assert.equal(privacy.isCapabilityActive(state, 'device.screen-access', now + 24 * 3600_000), false);
  const context = makeContext();
  const turns = [];
  for (let i = 0; i < 30; i++) {
    turns.push({ role: 'user', content: `old ${i} ${'x'.repeat(80)}` }, { role: 'assistant', content: 'y'.repeat(90) });
  }
  turns.push({ role: 'user', content: 'current request stays intact' });
  const saved = JSON.stringify(turns);
  const budget = await budgetPrompt(context, 'system', turns, 1024, 'system ' + 'optional profile'.repeat(1000));
  assert.ok(budget.inputTokens + budget.outputTokens + 32 <= 1024);
  assert.ok(budget.retainedTurns < turns.length);
  assert.match(budget.prompt, /current request stays intact/);
  assert.match(budget.prompt, /old 29/);
  assert.doesNotMatch(budget.prompt, /old 0/);
  assert.equal(JSON.stringify(turns), saved);
  await assert.rejects(() => budgetPrompt(context, 'system', [{ role: 'user', content: 'x'.repeat(10000) }], 1024), /request is too long/);
  const shared = await budgetPrompt(context, 'system', [{ role: 'user', content: 'current' }], 1024, undefined, 'x'.repeat(6000));
  assert.ok(shared.sharedChars > 0 && shared.sharedChars < 6000);
  assert.match(shared.prompt, /untrusted data/);
  assert.match(shared.prompt, /current/);
  const tiny = await budgetPrompt(context, 's', [{ role: 'user', content: 'current' }], 128);
  assert.ok(tiny.inputTokens + tiny.outputTokens + 32 <= 128);
  const sharedContext = screen.createScreenContext('secret', 'resource', 1, now);
  assert.equal(screen.screenContextValid(sharedContext, 1, true, now + 1), true);
  for (const [epoch, allowed, time] of [[2, true, now], [1, false, now], [1, true, now + 120000]]) {
    assert.equal(screen.screenContextValid(sharedContext, epoch, allowed, time), false);
  }
  assert.throws(() => screen.supportedScreenResource('a.pdf', 'application/pdf'), /unavailable/);
  assert.equal(screen.supportedScreenResource('a.png', 'image/png'), 'image');
  assert.doesNotMatch(new NativeInferenceError(new Error('HostFunction /private/path transcript')).message, /private\/path|transcript/);
  let unblock;
  const held = scheduleNative(() => new Promise(resolve => { unblock = resolve; }));
  const order = [];
  const background = scheduleNative(async () => { order.push('background'); }, 2);
  const foreground = scheduleNative(async () => { order.push('foreground'); }, 0);
  unblock();
  await Promise.all([held, background, foreground]);
  assert.deepEqual(order, ['foreground', 'background']);
  await releaseNativeContext(context);
  const broken = makeContext();
  failure = true;
  const { streamCompletion } = require('../lib/offlineLlm.ts');
  const results = await Promise.allSettled([
    streamCompletion(broken, [{ role: 'user', content: 'request' }], () => {}),
    streamCompletion(broken, [{ role: 'user', content: 'queued request' }], () => {}),
  ]);
  failure = false;
  assert.ok(results[0].reason instanceof NativeInferenceError);
  assert.match(results[1].reason.message, /unloaded/, 'native failure retires context before queued users enter it');
  await releaseNativeContext(broken);
  nativeCalls = 0;
}

async function providerChecks() {
  let renderer;
  await act(async () => {
    renderer = Renderer.create(React.createElement(AppProvider, null, React.createElement(Probe)));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(app.engineStatus, 'ready');
  assert.equal(app.privacyReady, true);
  await act(async () => { await app.startVoiceInput(); });
  const oldSession = voiceStarts.at(-1);
  assert.equal(app.voiceInputStatus, 'listening');
  await act(async () => { app.stopVoiceInput(); });
  assert.equal(app.voiceTranscript, 'editable words');
  assert.equal(chat.turns.length, 0, 'dictation never auto-sends');
  await act(async () => { app.clearVoiceTranscript(); app.cancelVoiceInput(); await app.startVoiceInput(); });
  assert.notEqual(voiceStarts.at(-1), oldSession);
  await act(async () => { emit('recognitionResult', { sessionId: oldSession, transcript: 'stale', isFinal: true }); });
  assert.equal(app.voiceTranscript, '');
  await act(async () => { app.cancelVoiceInput(); await app.setGlobalPrivacyPause(true); });
  const requestsBefore = microphoneRequests;
  await act(async () => { await app.startVoiceInput(); await app.runVoiceSelfTest(); });
  assert.equal(microphoneRequests, requestsBefore, 'neither speech path bypasses pause');
  await act(async () => { await app.setGlobalPrivacyPause(false); await app.setCapabilityApproval('local.voice-input', 'revoked'); });
  await act(async () => { await app.startVoiceInput(); await app.runVoiceSelfTest(); });
  assert.equal(microphoneRequests, requestsBefore, 'neither path bypasses revocation');
  await act(async () => { await app.setCapabilityApproval('local.voice-input', 'approved'); });
  permission = 'blocked';
  await act(async () => { await app.startVoiceInput(); });
  assert.match(app.voiceError, /Android Settings/);
  permission = 'granted';
  await act(async () => { await app.startVoiceInput(); app.cancelVoiceInput(); });
  assert.equal(app.voiceInputStatus, 'idle');
  let test;
  await act(async () => {
    test = app.runVoiceSelfTest();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  const testId = voiceStarts.at(-1);
  await act(async () => {
    emit('recognitionResult', { sessionId: testId, transcript: 'self test words', isFinal: true });
    emit('recognitionStatus', { sessionId: testId, status: 'completed' });
    await test;
  });
  assert.equal(app.voiceSelfTestResult.outcome, 'passed');
  const beforeChat = nativeCalls;
  for (let i = 0; i < 6; i++) await act(async () => { await chat.sendMessage(`turn ${i}`); });
  assert.equal(chat.turns.length, 12);
  assert.equal(nativeCalls - beforeChat, 6, 'no unsolicited background extraction');
  await act(async () => { await Promise.all([chat.runLocalInference('one'), chat.runLocalInference('two')]); });
  assert.equal(maxCalls, 1);

  await act(async () => { await app.setCapabilityApproval('device.screen-access', 'approved'); });
  assert.equal(privacy.isCapabilityActive(app.privacyState, 'device.screen-access'), true);
  await act(async () => { assert.equal(await app.startScreenSession({ accessibilityText: true, screenshot: false }), true); });
  assert.match(app.screenPreview.text, /PRIVATE_SENTINEL/);
  assert.equal(app.screenAttachment, null, 'captured is not attached');
  await act(async () => { app.attachScreenContext(app.screenPreview.text); });
  await act(async () => { await chat.sendMessage('Summarize the shared text.'); });
  assert.match(capturedPrompts.at(-1), /PRIVATE_SENTINEL/);
  assert.match(capturedPrompts.at(-1), /untrusted data/);
  assert.equal(cloudCalls, 0);
  assert.equal(app.pendingMemoryCandidate, undefined); // Chat owns suggestions.
  assert.equal(chat.pendingMemoryCandidate, null);
  assert.doesNotMatch(records.get('conversation'), /PRIVATE_SENTINEL|Summarize the shared text/);
  assert.equal(contexts.at(-1).cacheCleared, true, 'screen evidence is wiped from native KV cache before another caller runs');
  assert.doesNotMatch(records.get('privacy-agent-state'), /PRIVATE_SENTINEL/);
  await act(async () => { await chat.sendMessage('A separate normal request'); });
  assert.doesNotMatch(capturedPrompts.at(-1), /PRIVATE_SENTINEL/);
  await act(async () => { await app.stopScreenSession(); });
  assert.equal(chat.turns.some(turn => turn.privateContext), false);

  protectedScreen = true;
  await act(async () => { assert.equal(await app.startScreenSession({ accessibilityText: true, screenshot: false }), false); });
  assert.equal(app.screenPreview, null);
  protectedScreen = false;
  await act(async () => { assert.equal(await app.startScreenSession({ accessibilityText: false, screenshot: true }), true); });
  assert.match(app.screenPreview.text, /screenshot OCR/);
  await act(async () => { await app.stopScreenSession(); });
  await act(async () => { assert.equal(await app.startScreenSession({ accessibilityText: false, screenshot: false, selectedResource: { name: 'note.txt', mimeType: 'text/plain', size: 50, uri: 'content://chosen' } }), true); });
  assert.match(app.screenPreview.text, /selected text/);
  await act(async () => { app.attachScreenContext(app.screenPreview.text); await app.setCapabilityApproval('local.files', 'revoked'); });
  assert.equal(app.screenAttachment, null);

  await act(async () => { await app.setCapabilityApproval('device.screen-access', 'approved'); });
  let resolveRead;
  screenRead = new Promise(resolve => { resolveRead = resolve; });
  let capture;
  await act(async () => { capture = app.startScreenSession({ accessibilityText: true, screenshot: false }); await Promise.resolve(); });
  await act(async () => { await app.stopScreenSession(); resolveRead({ available: true, text: 'stale PRIVATE_SENTINEL' }); await capture; });
  assert.equal(app.screenPreview, null, 'late capture cannot repopulate data after stop');
  screenRead = null;
  await act(async () => { for (const listener of appListeners) listener('background'); await Promise.resolve(); });
  assert.equal(privacy.isCapabilityActive(app.privacyState, 'device.screen-access'), false);
  await act(async () => { for (const listener of appListeners) listener('active'); });
  assert.equal(app.screenAttachment, null);

  failure = true;
  await act(async () => { await chat.sendMessage('keep this request'); });
  assert.match(chat.turns.at(-1).content, /valid partial/);
  assert.doesNotMatch(chat.turns.at(-1).content, /PRIVATE_SENTINEL|private\/model/);
  assert.equal(app.engineStatus, 'error');
  failure = false;
  await act(async () => { assert.equal(await app.loadModel(), true); });
  let resolveHeld;
  hold = new Promise(resolve => { resolveHeld = resolve; });
  let pending;
  await act(async () => {
    pending = chat.runLocalInference('held');
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  const old = contexts.at(-1);
  let reload;
  await act(async () => { reload = app.loadModel(); await Promise.resolve(); });
  assert.equal(old.released, false);
  hold = null;
  await act(async () => { resolveHeld(); await pending; await reload; });
  assert.equal(old.released, true);
  assert.equal(app.engineStatus, 'ready');
  assert.equal(maxCalls, 1);
  const serialized = JSON.stringify(diagnostics.getRuntimeDiagnostics());
  assert.doesNotMatch(serialized, /PRIVATE_SENTINEL|private\/model|editable words/);
  await act(async () => { renderer.unmount(); });
}

(async () => {
  await pureChecks();
  await providerChecks();
  console.log('Demi repair behaviors passed: voice parity/recovery/session IDs, six-turn chat, token budgets, priority/concurrency/release, partial failure, session expiry, protected/stale source-to-prompt, persistence and cloud isolation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
