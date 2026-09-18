const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const React = require('react');
const TestRenderer = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const colors = {
  background: '#fff',
  card: '#fff',
  cardForeground: '#111',
  border: '#ddd',
  accent: '#f5e5dd',
  primary: '#d95f43',
  foreground: '#111',
  mutedForeground: '#777',
  secondary: '#eee',
  destructive: '#b33',
};

const passthrough = (name) => (props) =>
  React.createElement(name, props, typeof props.children === 'function'
    ? props.children({ pressed: false })
    : props.children);

const fakeReactNative = {
  ActivityIndicator: passthrough('ActivityIndicator'),
  Alert: { alert() {} },
  Dimensions: { get: () => ({ width: 402, height: 874 }) },
  FlatList: ({ data = [], renderItem, ListHeaderComponent, ...props }) =>
    React.createElement(
      'FlatList',
      props,
      ListHeaderComponent,
      data.map((item, index) => renderItem({ item, index })),
    ),
  KeyboardAvoidingView: passthrough('KeyboardAvoidingView'),
  Modal: ({ visible, children, ...props }) =>
    visible ? React.createElement('Modal', props, children) : null,
  Platform: { OS: 'web', Version: 0 },
  Pressable: passthrough('Pressable'),
  ScrollView: passthrough('ScrollView'),
  StyleSheet: { create: (styles) => styles },
  Switch: passthrough('Switch'),
  Text: passthrough('Text'),
  TextInput: passthrough('TextInput'),
  useWindowDimensions: () => ({ width: 402, height: 874 }),
  View: passthrough('View'),
};

let appValue;
let routerCalls = [];
let secureStorageValue = null;
let secureWriteFailure = false;
let reminderScheduleResult = {
  notificationId: 'retry-notification',
  notificationState: 'scheduled',
  notificationError: null,
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'react-native') return fakeReactNative;
  if (request === '@expo/vector-icons') {
    return { Feather: passthrough('Feather') };
  }
  if (request === 'expo-haptics') {
    return { impactAsync: async () => {}, ImpactFeedbackStyle: { Light: 'light' } };
  }
  if (request === 'expo-status-bar') {
    return { StatusBar: passthrough('StatusBar') };
  }
  if (request === 'expo-router') {
    return {
      useRouter: () => ({
        push: (value) => routerCalls.push(value),
        back: () => routerCalls.push('back'),
        replace: (value) => routerCalls.push(value),
      }),
      useLocalSearchParams: () => ({}),
    };
  }
  if (request === 'react-native-keyboard-controller') {
    return { KeyboardAvoidingView: passthrough('KeyboardAvoidingView') };
  }
  if (request === 'react-native-safe-area-context') {
    return {
      SafeAreaView: passthrough('SafeAreaView'),
      useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    };
  }
  if (request === '@/components/PersonalProfileEditor' || request.endsWith('/components/PersonalProfileEditor')) {
    return { PersonalProfileEditor: passthrough('PersonalProfileEditor') };
  }
  if (request === '@/lib/offlineLlm' || request.endsWith('/lib/offlineLlm')) {
    return {
      RECOMMENDED_MODEL: {
        name: 'test-model.gguf',
        sizeBytes: 10,
        license: 'Test',
        source: 'Test',
      },
      formatBytes: (value) => `${value} bytes`,
    };
  }
  if (request === '@/components/KeyboardAwareScrollViewCompat' || request.endsWith('/components/KeyboardAwareScrollViewCompat')) {
    return { KeyboardAwareScrollViewCompat: passthrough('KeyboardAwareScrollViewCompat') };
  }
  if (request === '@/context/AppContext' || request.endsWith('/context/AppContext')) {
    return { useApp: () => appValue };
  }
  if (request === '@/hooks/useColors' || request.endsWith('/hooks/useColors')) {
    return { useColors: () => colors };
  }
  if (request === '@/lib/secureLocalStorage' || request.endsWith('/lib/secureLocalStorage')) {
    return {
      migratePlaintextRecord: async () => secureStorageValue,
      writeSecureRecord: async (_key, value) => {
        if (secureWriteFailure) throw new Error('secure storage unavailable');
        secureStorageValue = value;
      },
    };
  }
  if (request === '@/lib/reminders' || request.endsWith('/lib/reminders')) {
    return {
      initializeNotifications: async () => {},
      cancelScheduledReminder: async () => true,
      nextOccurrence: (reminder) => new Date(`${reminder.date}T09:00:00`),
      scheduleReminder: async () => reminderScheduleResult,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function findByTestId(renderer, testID) {
  return renderer.root.findByProps({ testID });
}

function textContent(renderer) {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node) => node.children)
    .filter((child) => typeof child === 'string')
    .join(' ');
}

async function testProfileSaveFailureKeepsEditorOpen() {
  let closed = false;
  appValue = {
    settings: { appearance: 'light' },
    profile: { displayName: 'Ada', context: 'Existing context' },
    saveProfile: async () => {
      throw new Error('Your local profile could not be saved on this device.');
    },
    skipProfile: async () => {},
    clearProfile: async () => {},
  };

  const { PersonalProfileEditor } = require('../components/PersonalProfileEditor.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(PersonalProfileEditor, {
        visible: true,
        mode: 'settings',
        onClose: () => {
          closed = true;
        },
      }),
    );
  });

  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'profile-name').props.onChangeText('New name');
    await findByTestId(renderer, 'save-profile').props.onPress();
  });

  assert.equal(closed, false);
  assert.match(textContent(renderer), /could not be saved/);
  assert.ok(findByTestId(renderer, 'profile-name'));
}

function baseAppValue(overrides = {}) {
  return {
    settings: {
      appearance: 'light',
      preferredVoiceId: null,
      voiceLanguage: 'en-US',
      speechRate: 0.92,
      voiceInputEnabled: true,
      spokenRepliesEnabled: false,
      saveConversations: true,
      hapticsEnabled: true,
    },
    settingsReady: true,
    profile: { displayName: 'Ada', context: 'Existing context', onboardingCompleted: true },
    memories: [],
    storageProtection: 'secure',
    storageError: null,
    clearConversation: async () => {},
    localModel: null,
    deviceCompatibility: {
      deviceName: 'Test device',
      memoryLabel: '8 GB',
      contextSize: 2048,
      architectureSupported: true,
      nativeRuntimeAvailable: true,
      maxRecommendedModelBytes: 500,
      recommendation: 'Test model should fit.',
    },
    engineStatus: 'ready',
    engineError: null,
    runtimeDetails: null,
    modelSetupStatus: 'idle',
    voiceInputStatus: 'idle',
    voiceInputAvailable: false,
    voiceOutputAvailable: false,
    offlineVoices: [],
    offlineVoicesLoading: false,
    voiceError: null,
    voiceSetupMessage: null,
    voiceSetupInProgress: false,
    importModel: async () => {},
    downloadRecommendedModel: async () => {},
    cancelDownload: () => {},
    downloadStatus: 'idle',
    downloadProgress: 0,
    downloadError: null,
    removeModel: async () => {},
    installOfflineVoiceModel: async () => {},
    openVoiceSettings: async () => {},
    refreshOfflineVoices: async () => {},
    dismissVoiceError: () => {},
    turns: [],
    isConversationReady: true,
    isThinking: false,
    isSpeaking: false,
    voiceTranscript: '',
    startVoiceInput: async () => {},
    stopVoiceInput: () => {},
    cancelVoiceInput: () => {},
    clearVoiceTranscript: () => {},
    stopSpeaking: async () => {},
    sendMessage: async () => {},
    pendingMemoryCandidate: null,
    saveMemoryCandidate: async () => {},
    rejectMemoryCandidate: () => {},
    updateMemoryAliases: async () => {},
    ...overrides,
  };
}

async function testSettingsFailureKeepsControlledValue() {
  let updateCalls = 0;
  appValue = baseAppValue({
    offlineVoices: [{ id: 'voice-1', name: 'Test voice', language: 'en-US' }],
    settings: {
      ...baseAppValue().settings,
      preferredVoiceId: null,
    },
    updateSettings: () => {
      updateCalls += 1;
      const failure = Promise.reject(
        new Error('Settings could not be saved on this device.'),
      );
      failure.catch(() => {});
      return failure;
    },
  });
  const { default: SettingsScreen } = require('../app/settings.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(SettingsScreen));
  });
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'voice-option-voice-1').props.onPress();
  });
  assert.equal(updateCalls, 1);
  assert.equal(
    findByTestId(renderer, 'voice-option-voice-1').props.accessibilityState.selected,
    false,
  );
}

async function testMemoryApprovalFailureKeepsModalOpen() {
  appValue = baseAppValue({
    pendingMemoryCandidate: {
      kind: 'memory',
      category: 'preference',
      content: 'Keep answers concise.',
      sourceExcerpt: 'Keep answers concise.',
      explicit: true,
    },
    saveMemoryCandidate: async () => {
      throw new Error('Memory could not be saved.');
    },
  });
  const { default: DemiScreen } = require('../app/index.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(DemiScreen));
  });
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'save-memory-candidate').props.onPress();
  });
  assert.ok(findByTestId(renderer, 'save-memory-candidate'));
  assert.match(textContent(renderer), /Keep answers concise/);
}

async function testMemoryAliasesUseSharedMutation() {
  const updates = [];
  appValue = baseAppValue({
    memories: [
      {
        id: 'memory-1',
        category: 'person',
        content: 'Person X likes pickles.',
        aliases: ['Alex'],
        source: { turnId: 'turn-1', excerpt: 'Person X likes pickles.', createdAt: 1 },
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null,
      },
      {
        id: 'memory-2',
        category: 'person',
        content: 'Person Y likes socks.',
        aliases: ['Alex'],
        source: { turnId: 'turn-2', excerpt: 'Person Y likes socks.', createdAt: 2 },
        createdAt: 2,
        updatedAt: 2,
        archivedAt: null,
      },
    ],
    updateMemoryAliases: async (id, aliases) => {
      updates.push({ id, aliases });
    },
  });
  const { default: MemoriesScreen } = require('../app/memories.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(MemoriesScreen));
  });
  assert.match(
    textContent(renderer),
    /shared with another active memory.*not use it until you remove or change the duplicate/,
  );
  await TestRenderer.act(async () => {
    findByTestId(renderer, 'alias-input-memory-1').props.onChangeText('Al');
  });
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'add-memory-alias-memory-1').props.onPress();
  });
  assert.deepEqual(updates[0], { id: 'memory-1', aliases: ['Alex', 'Al'] });
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'remove-memory-alias-memory-1-Alex').props.onPress();
  });
  assert.deepEqual(updates[1], { id: 'memory-1', aliases: [] });
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
}

async function testVoiceStartClearsDraftBeforeRecognition() {
  let sent = 0;
  let started = 0;
  appValue = baseAppValue({
    startVoiceInput: async () => {
      started += 1;
    },
    sendMessage: async () => {
      sent += 1;
    },
  });
  const { default: DemiScreen } = require('../app/index.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(DemiScreen));
  });
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'keyboard-toggle').props.onPress();
  });
  const input = findByTestId(renderer, 'chat-input');
  await TestRenderer.act(async () => {
    await input.props.onChangeText('stale draft');
  });
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'demi-voice-circle').props.onPress();
  });
  assert.equal(started, 1);
  assert.equal(sent, 0);
  assert.equal(findByTestId(renderer, 'chat-input').props.value, '');
}

async function testBrowserVoiceControlsExplainNativeRequirement() {
  routerCalls = [];
  appValue = baseAppValue();
  const { default: SettingsScreen } = require('../app/settings.tsx');
  let settingsRenderer;
  await TestRenderer.act(async () => {
    settingsRenderer = TestRenderer.create(React.createElement(SettingsScreen));
  });
  assert.equal(findByTestId(settingsRenderer, 'offline-speech-setup').props.disabled, true);
  assert.equal(findByTestId(settingsRenderer, 'offline-tts-setup').props.disabled, true);
  assert.match(textContent(settingsRenderer), /installed Android app/);
  await TestRenderer.act(async () => {
    settingsRenderer.unmount();
  });

  appValue = baseAppValue({
    voiceInputStatus: 'unavailable',
  });
  const { default: DemiScreen } = require('../app/index.tsx');
  let homeRenderer;
  await TestRenderer.act(async () => {
    homeRenderer = TestRenderer.create(React.createElement(DemiScreen));
  });
  assert.equal(
    findByTestId(homeRenderer, 'demi-voice-circle').props.accessibilityLabel,
    'Open settings for setup',
  );
  await TestRenderer.act(async () => {
    await findByTestId(homeRenderer, 'demi-voice-circle').props.onPress();
  });
  assert.equal(routerCalls[0], '/settings');
  await TestRenderer.act(async () => {
    homeRenderer.unmount();
  });
}

async function testCalendarRetryKeepsDateWhenPersistenceFails() {
  secureStorageValue = JSON.stringify([
    {
      id: 'date-1',
      label: 'Maya',
      eventName: 'Birthday',
      date: '2099-05-10',
      time: '09:00',
      notes: '',
      repeatsAnnually: false,
      remindMinutesBefore: 0,
      notificationId: 'old-notification',
      notificationState: 'permission-denied',
      notificationError: 'Notifications are off.',
      retiredNotificationIds: [],
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    },
  ]);
  secureWriteFailure = true;
  const { CalendarProvider, useCalendar } = require('../context/CalendarContext.tsx');
  let calendarValue;
  function Probe() {
    calendarValue = useCalendar();
    return null;
  }
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CalendarProvider, null, React.createElement(Probe)),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(calendarValue.upcomingReminders.length, 1);
  await assert.rejects(
    async () =>
      TestRenderer.act(async () => {
        await calendarValue.retryReminderNotification('date-1');
      }),
    /could not be saved|secure storage unavailable/,
  );
  await TestRenderer.act(async () => {
    await Promise.resolve();
  });
  assert.equal(calendarValue.upcomingReminders[0].id, 'date-1');
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
  secureWriteFailure = false;
  secureStorageValue = null;
}

async function testCalendarReminderSurvivesRestartAndSchedulingFailure() {
  secureStorageValue = null;
  secureWriteFailure = false;
  reminderScheduleResult = {
    notificationId: 'android-notification-1',
    notificationState: 'scheduled',
    notificationError: null,
  };
  const { CalendarProvider, useCalendar } = require('../context/CalendarContext.tsx');
  let calendarValue;
  function Probe() {
    calendarValue = useCalendar();
    return null;
  }
  const mountCalendar = async () => {
    let renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(CalendarProvider, null, React.createElement(Probe)),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return renderer;
  };

  let renderer = await mountCalendar();
  const saved = await TestRenderer.act(async () =>
    calendarValue.saveReminder({
      label: 'Maya',
      eventName: 'Buy pickles',
      date: '2099-05-10',
      time: '09:00',
      notes: '',
      repeatsAnnually: false,
      remindMinutesBefore: 0,
    }),
  );
  assert.equal(saved.notificationState, 'scheduled');
  assert.equal(calendarValue.upcomingReminders[0].eventName, 'Buy pickles');
  await TestRenderer.act(async () => {
    renderer.unmount();
  });

  renderer = await mountCalendar();
  assert.equal(calendarValue.upcomingReminders[0].notificationId, 'android-notification-1');
  assert.equal(calendarValue.upcomingReminders[0].notificationState, 'scheduled');

  reminderScheduleResult = {
    notificationId: null,
    notificationState: 'permission-denied',
    notificationError: 'Notifications are off. The date is saved.',
  };
  const updated = await TestRenderer.act(async () =>
    calendarValue.saveReminder(
      {
        label: 'Maya',
        eventName: 'Buy pickles',
        date: '2099-05-10',
        time: '09:00',
        notes: '',
        repeatsAnnually: false,
        remindMinutesBefore: 0,
      },
      calendarValue.upcomingReminders[0].id,
    ),
  );
  assert.equal(updated.notificationState, 'permission-denied');
  assert.equal(calendarValue.upcomingReminders[0].eventName, 'Buy pickles');
  assert.match(
    JSON.parse(secureStorageValue).find((item) => item.eventName === 'Buy pickles')
      .notificationError,
    /date is saved/,
  );
  await TestRenderer.act(async () => {
    renderer.unmount();
  });

  reminderScheduleResult = {
    notificationId: 'retry-notification',
    notificationState: 'scheduled',
    notificationError: null,
  };
  secureStorageValue = null;
}

async function testReminderCandidateRoutesWithExactTime() {
  routerCalls = [];
  appValue = baseAppValue({
    pendingMemoryCandidate: {
      kind: 'important-date',
      label: 'Reminder',
      eventName: 'buy pickles',
      date: '2026-09-17',
      time: '14:37',
      notes: '',
      sourceExcerpt: 'Remind me to buy pickles in one day',
      explicit: true,
    },
  });
  const { default: DemiScreen } = require('../app/index.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(DemiScreen));
  });
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'review-date-candidate').props.onPress();
  });
  assert.deepEqual(routerCalls[0], {
    pathname: '/calendar/edit',
    params: {
      label: 'Reminder',
      eventName: 'buy pickles',
      date: '2026-09-17',
      time: '14:37',
      notes: '',
    },
  });
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
}

function testDownloadCancellationGuardRunsBeforeCommit() {
  const source = fs.readFileSync(
    path.join(__dirname, '../context/AppContext.tsx'),
    'utf8',
  );
  const downloadStart = source.indexOf('async function downloadRecommendedModel');
  const cancellationCheck = source.indexOf(
    'if (runId !== downloadRunRef.current)',
    downloadStart,
  );
  const modelCommit = source.indexOf('setLocalModel(nextModel)', cancellationCheck);
  assert.ok(cancellationCheck >= 0);
  assert.ok(modelCommit > cancellationCheck);
  assert.match(
    source.slice(cancellationCheck, modelCommit),
    /return;[\s\S]*if \(!loaded\)/,
  );
}

async function main() {
  await testProfileSaveFailureKeepsEditorOpen();
  await testSettingsFailureKeepsControlledValue();
  await testMemoryApprovalFailureKeepsModalOpen();
  await testMemoryAliasesUseSharedMutation();
  await testVoiceStartClearsDraftBeforeRecognition();
  await testBrowserVoiceControlsExplainNativeRequirement();
  await testCalendarRetryKeepsDateWhenPersistenceFails();
  await testCalendarReminderSurvivesRestartAndSchedulingFailure();
  await testReminderCandidateRoutesWithExactTime();
  testDownloadCancellationGuardRunsBeforeCommit();
  console.log('Component failure-injection checks passed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
  });