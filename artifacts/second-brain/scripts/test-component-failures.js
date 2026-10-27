const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const React = require('react');
const TestRenderer = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__DEV__ = false;

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

let windowDimensions = { width: 402, height: 874 };

const passthrough = (name) => (props) =>
  React.createElement(name, props, typeof props.children === 'function'
    ? props.children({ pressed: false })
    : props.children);

const fakeReactNative = {
  ActivityIndicator: passthrough('ActivityIndicator'),
  AppState: { addEventListener: () => ({ remove() {} }) },
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
  useWindowDimensions: () => windowDimensions,
  View: passthrough('View'),
};

let appValue;
let documentPickerResult = { canceled: true };
let documentPickerCalls = 0;
let documentReadCalls = 0;
let documentFileContents = 'local test content';
let documentDeletedUris = [];
let toolsValue = {
  selectedDocument: null,
  documentBusy: false,
  documentError: null,
  documentNotice: null,
  pickDocument: async () => {},
  transformDocument: async () => {},
  clearDocument: () => {},
};
let scheduledValue;
let routerCalls = [];
let secureStorageValue = null;
let secureWriteFailure = false;
let usageSecureFailure = false;
let usageStorageItems = {};
let usageFileSystemFailure = false;
let reminderScheduleResult = {
  notificationId: 'retry-notification',
  notificationState: 'scheduled',
  notificationError: null,
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'expo-document-picker') {
    return {
      getDocumentAsync: async () => {
        documentPickerCalls += 1;
        return documentPickerResult;
      },
    };
  }
  if (request === 'expo-constants') {
    return {
      __esModule: true,
      default: {
        expoConfig: { version: 'test', android: { versionCode: 1 } },
        nativeBuildVersion: '1',
      },
    };
  }
  if (request === 'expo-sharing') {
    return {
      isAvailableAsync: async () => true,
      shareAsync: async () => {},
    };
  }
  if (request === '@/context/ScheduledJobsContext') return { useScheduledJobs: () => scheduledValue };
  if (request === 'react-native-reanimated') {
    const transition = (name) => ({
      duration: (milliseconds) => ({ name, duration: milliseconds }),
    });
    return {
      __esModule: true,
      default: { View: passthrough('AnimatedView') },
      FadeInDown: transition('FadeInDown'),
      FadeInUp: transition('FadeInUp'),
      FadeOutDown: transition('FadeOutDown'),
      LinearTransition: transition('LinearTransition'),
    };
  }
  if (request === 'react-native') return fakeReactNative;
  if (request === '@react-native-async-storage/async-storage') {
    return {
      getItem: async (key) => {
        if (usageStorageItems[key] instanceof Error) {
          throw usageStorageItems[key];
        }
        return usageStorageItems[key] ?? null;
      },
      setItem: async () => {},
      removeItem: async () => {},
    };
  }
  if (request.startsWith('expo-file-system')) {
    return {
      documentDirectory: '/device/documents/',
      cacheDirectory: '/device/cache/',
      deleteAsync: async (uri) => { documentDeletedUris.push(uri); },
      getInfoAsync: async () => {
        if (usageFileSystemFailure) throw new Error('file system unavailable');
        return { exists: false, isDirectory: false, size: 0 };
      },
      readDirectoryAsync: async () => [],
      readAsStringAsync: async () => {
        documentReadCalls += 1;
        return documentFileContents;
      },
      getFreeDiskStorageAsync: async () => {
        if (usageFileSystemFailure) throw new Error('disk measurement denied');
        return 4096;
      },
    };
  }
  if (request === 'expo-secure-store') {
    return {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
      getItemAsync: async () => null,
      setItemAsync: async () => {},
      deleteItemAsync: async () => {},
    };
  }
  if (
    request === '@/lib/secureLocalStorage' ||
    request.includes('/lib/secureLocalStorage') ||
    request === './secureLocalStorage'
  ) {
    return {
      migratePlaintextRecord: async () => secureStorageValue,
      getSecureRecordStorageBytes: async () => {
        if (usageSecureFailure) throw new Error('secure store unavailable');
        return 12;
      },
      writeSecureRecord: async (_key, value) => {
        if (secureWriteFailure) throw new Error('secure storage unavailable');
        secureStorageValue = value;
      },
    };
  }
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
    return { useApp: () => appValue, useChat: () => appValue };
  }
  if (request === '@/context/ToolContext' || request.endsWith('/context/ToolContext')) {
    return { useTools: () => toolsValue };
  }
  if (
    request === '@/context/LocalDataTransferContext' ||
    request.endsWith('/context/LocalDataTransferContext')
  ) {
    return {
      useLocalDataTransfer: () => ({
        status: 'idle',
        message: null,
        importSummary: null,
        exportLocalData: async () => {},
        chooseImportFile: async () => {},
        confirmImport: async () => {},
        cancelTransfer: () => {},
      }),
    };
  }
  if (request === '@/hooks/useColors' || request.endsWith('/hooks/useColors')) {
    return { useColors: () => colors };
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

function hasTestId(renderer, testID) {
  return renderer.root.findAllByProps({ testID }).length > 0;
}

async function expandSettingsGroup(renderer, testID) {
  const categoryByGroup = {
    'settings-group-privacy': 'permissions',
    'settings-group-device-footprint': 'model',
    'settings-group-local-recovery': 'memory',
    'settings-group-offline-setup': 'model',
    'settings-group-local-voice': 'voice',
  };
  const category = categoryByGroup[testID];
  if (!hasTestId(renderer, testID) && category) {
    await openSettingsCategory(renderer, category);
  }
  await TestRenderer.act(async () => {
    const group = findByTestId(renderer, testID);
    assert.equal(group.props.accessibilityRole, 'button');
    assert.equal(group.props.accessibilityState.expanded, false);
    await group.props.onPress();
  });
  assert.equal(
    findByTestId(renderer, testID).props.accessibilityState.expanded,
    true,
  );
}

async function openSettingsCategory(renderer, category) {
  if (!hasTestId(renderer, `settings-category-${category}`)) {
    await TestRenderer.act(async () => {
      await findByTestId(renderer, 'settings-browse-categories').props.onPress();
    });
  }
  await TestRenderer.act(async () => {
    await findByTestId(renderer, `settings-category-${category}`).props.onPress();
  });
}

function SettingsSessionHarness({ SettingsScreen }) {
  return React.createElement(SettingsScreen);
}

function textContent(renderer) {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node) => node.children)
    .filter((child) => typeof child === 'string')
    .join(' ');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function storageUsage(totalBytes, measuredAt = 1700000000000) {
  return {
    measuredAt,
    total: { bytes: totalBytes, status: 'measured' },
    activeModel: { bytes: 32, status: 'measured' },
    reclaimableModels: { bytes: 16, status: 'measured', fileCount: 1 },
    conversations: { bytes: 8, status: 'estimated' },
    memories: { bytes: 4, status: 'estimated' },
    settingsAndProfile: { bytes: 2, status: 'estimated' },
    appFiles: { bytes: 1, status: 'measured' },
    temporaryFiles: { bytes: 1, status: 'measured' },
    freeDevice: { bytes: 1000, status: 'measured' },
  };
}

function storageUpdatedText(measuredAt) {
  return `Last updated locally ${new Date(measuredAt).toLocaleString(
    undefined,
    {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    },
  )}`;
}

function assertStorageUpdated(renderer, measuredAt) {
  const escapedLabel = storageUpdatedText(measuredAt).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
  assert.match(textContent(renderer), new RegExp(escapedLabel.replace(/ /g, '\\s+')));
}

function StorageRefreshHarness({ SettingsScreen, refreshPromise }) {
  const [usage, setUsage] = React.useState(appValue.storageUsage ?? null);
  const [refreshing, setRefreshing] = React.useState(false);
  appValue = {
    ...appValue,
    storageUsage: usage,
    storageUsageRefreshing: refreshing,
    refreshStorageUsage: () => {
      setRefreshing(true);
      void refreshPromise
        .then(setUsage)
        .catch(() => {})
        .finally(() => setRefreshing(false));
    },
  };
  return React.createElement(SettingsScreen);
}

function StorageRaceHarness({ SettingsScreen, refreshPromises }) {
  const [usage, setUsage] = React.useState(appValue.storageUsage ?? null);
  const [refreshing, setRefreshing] = React.useState(false);
  const refreshRunRef = React.useRef(0);
  appValue = {
    ...appValue,
    storageUsage: usage,
    storageUsageRefreshing: refreshing,
    refreshStorageUsage: () => {
      const refreshRun = refreshRunRef.current + 1;
      refreshRunRef.current = refreshRun;
      setRefreshing(true);
      void refreshPromises[refreshRun - 1]
        .then((nextUsage) => {
          if (refreshRun !== refreshRunRef.current) return;
          setUsage(nextUsage);
        })
        .catch(() => {})
        .finally(() => {
          if (refreshRun === refreshRunRef.current) setRefreshing(false);
        });
    },
  };
  return React.createElement(SettingsScreen);
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
    storageUsage: null,
    storageUsageRefreshing: false,
    refreshStorageUsage: () => {},
    reclaimUnusedModelFiles: async () => ({
      status: 'completed',
      deletedFiles: 0,
      deletedBytes: 0,
      failedFiles: 0,
    }),
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
    prepareBundledVoiceModels: async () => {},
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

async function testSettingsNavigationGroupsRemainReachable() {
  routerCalls = [];
  const previousDimensions = windowDimensions;
  windowDimensions = { width: 320, height: 640 };
  let clearCalls = 0;
  appValue = baseAppValue({
    clearConversation: async () => {
      clearCalls += 1;
    },
  });
  const { default: SettingsScreen } = require('../app/settings.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(SettingsSessionHarness, { SettingsScreen }),
    );
  });

  assert.equal(
    findByTestId(renderer, 'settings-back').props.accessibilityLabel,
    'Go back',
  );
  const categories = ['memory', 'ui', 'model', 'voice', 'permissions'];
  for (const category of categories) {
    const entry = findByTestId(renderer, `settings-category-${category}`);
    assert.equal(entry.props.accessibilityRole, 'button');
    assert.equal(entry.props.accessibilityState, undefined);
  }
  const renderedCategoryEntries = renderer.root.findAll((node) =>
    typeof node.props.testID === 'string' &&
    node.props.testID.startsWith('settings-category-'),
  );
  assert.equal(
    new Set(renderedCategoryEntries.map((entry) => entry.props.testID)).size,
    5,
  );
  assert.equal(hasTestId(renderer, 'privacy-global-pause'), false);
  assert.equal(hasTestId(renderer, 'model-status-summary'), false);
  assert.equal(hasTestId(renderer, 'clear-conversation-history'), false);
  assert.equal(hasTestId(renderer, 'voice-input-setting'), false);
  assert.equal(hasTestId(renderer, 'save-history-setting'), false);
  assert.equal(hasTestId(renderer, 'appearance-option-light'), false);

  await openSettingsCategory(renderer, 'permissions');
  assert.equal(hasTestId(renderer, 'settings-header-title'), false);
  assert.ok(findByTestId(renderer, 'privacy-global-pause'));
  assert.equal(
    findByTestId(renderer, 'privacy-global-pause').props.accessibilityLabel,
    'Pause approved actions',
  );
  await expandSettingsGroup(renderer, 'settings-group-privacy');
  assert.match(textContent(renderer), /Local model inference/);
  assert.match(textContent(renderer), /Offline voice input/);
  assert.match(textContent(renderer), /Offline spoken replies/);
  assert.doesNotMatch(textContent(renderer), /Recommended model download/);
  assert.match(textContent(renderer), /Opt-in web research/);
  assert.match(textContent(renderer), /Local contacts/);
  assert.match(textContent(renderer), /Advanced tools/);
  assert.equal(hasTestId(renderer, 'open-local-documents'), false);
  assert.ok(findByTestId(renderer, 'open-sandbox-code-actions'));
  const screenAccessLink = findByTestId(renderer, 'open-screen-access');
  assert.equal(screenAccessLink.props.accessibilityRole, 'button');
  const screenAccessLinkStyle =
    typeof screenAccessLink.props.style === 'function'
      ? screenAccessLink.props.style({ pressed: false })
      : screenAccessLink.props.style;
  assert.ok(
    screenAccessLinkStyle
      .flat(Infinity)
      .filter(Boolean)
      .some((style) => style.gap === 10),
  );
  assert.ok(findByTestId(renderer, 'clear-privacy-state'));
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'open-screen-access').props.onPress();
  });
  assert.equal(routerCalls.at(-1), '/screen-access');

  await openSettingsCategory(renderer, 'model');
  assert.ok(findByTestId(renderer, 'model-status-summary'));
  await expandSettingsGroup(renderer, 'settings-group-device-footprint');
  assert.ok(findByTestId(renderer, 'refresh-storage-usage'));
  assert.match(textContent(renderer), /Local storage/);
  assert.equal(hasTestId(renderer, 'toggle-storage-details'), false);
  await expandSettingsGroup(renderer, 'settings-group-offline-setup');
  assert.ok(findByTestId(renderer, 'download-recommended'));

  await openSettingsCategory(renderer, 'memory');
  assert.ok(findByTestId(renderer, 'save-history-setting'));
  const clearHistory = findByTestId(renderer, 'clear-conversation-history');
  assert.equal(clearHistory.props.accessibilityRole, 'button');
  assert.equal(
    clearHistory.props.accessibilityLabel,
    'Clear conversation history',
  );
  await TestRenderer.act(async () => {
    await clearHistory.props.onPress();
  });
  assert.equal(clearCalls, 0);
  assert.ok(findByTestId(renderer, 'confirm-clear-conversation'));
  assert.match(textContent(renderer), /local document requests and results/);
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'cancel-clear-conversation').props.onPress();
  });
  assert.equal(clearCalls, 0);
  await TestRenderer.act(async () => {
    await clearHistory.props.onPress();
  });
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'confirm-clear-conversation').props.onPress();
  });
  assert.equal(clearCalls, 1);

  await expandSettingsGroup(renderer, 'settings-group-local-recovery');
  assert.ok(findByTestId(renderer, 'export-local-data'));
  assert.ok(findByTestId(renderer, 'import-local-data'));
  assert.match(textContent(renderer), /not encrypted by Demi/);
  const historyCard = findByTestId(renderer, 'memory-history-card');
  assert.ok(
    historyCard.props.style
      .flat(Infinity)
      .filter(Boolean)
      .some((style) => style.marginBottom === 12),
  );
  assert.equal(
    findByTestId(renderer, 'clear-conversation-history').parent.props.testID,
    historyCard.props.testID,
  );
  const clearActionStyle = findByTestId(
    renderer,
    'clear-conversation-history',
  ).props.style({ pressed: false });
  assert.ok(
    clearActionStyle
      .flat(Infinity)
      .filter(Boolean)
      .some((style) => style.marginTop === 8),
  );

  await openSettingsCategory(renderer, 'voice');
  assert.ok(findByTestId(renderer, 'voice-input-setting'));
  assert.ok(findByTestId(renderer, 'spoken-replies-setting'));
  const voiceCardStyle = findByTestId(renderer, 'voice-controls-card').props.style;
  assert.ok(
    voiceCardStyle
      .flat(Infinity)
      .filter(Boolean)
      .some((style) => style.paddingTop === 4),
  );
  assert.ok(
    voiceCardStyle
      .flat(Infinity)
      .filter(Boolean)
      .some((style) => style.paddingBottom === 0),
  );
  const spokenRepliesRowStyle = findByTestId(
    renderer,
    'spoken-replies-setting',
  ).parent.props.style;
  assert.ok(
    spokenRepliesRowStyle
      .flat(Infinity)
      .filter(Boolean)
      .some((style) => style.paddingBottom >= 16),
  );
  await expandSettingsGroup(renderer, 'settings-group-local-voice');
  assert.ok(findByTestId(renderer, 'voice-readiness'));
  assert.ok(findByTestId(renderer, 'offline-tts-setup'));
  const speechRateLabel = renderer.root
    .findAllByType('Text')
    .find((node) => node.children.includes('Spoken reply speed'));
  assert.ok(speechRateLabel);
  assert.ok(
    speechRateLabel.props.style
      .flat(Infinity)
      .filter(Boolean)
      .some((style) => style.marginBottom === 8),
  );
  const voiceSetupHeader = findByTestId(renderer, 'settings-group-local-voice');
  assert.ok(
    voiceSetupHeader.parent.props.style
      .flat(Infinity)
      .filter(Boolean)
      .some((style) => style.marginTop === 12),
  );

  await openSettingsCategory(renderer, 'ui');
  assert.ok(findByTestId(renderer, 'appearance-option-light'));
  assert.equal(findByTestId(renderer, 'appearance-option-light').props.accessibilityRole, 'radio');
  assert.equal(
    findByTestId(renderer, 'settings-back').props.accessibilityLabel,
    'Go back',
  );
  assert.ok(findByTestId(renderer, 'haptic-feedback-setting'));
  assert.equal(hasTestId(renderer, 'settings-group-advanced-preferences'), false);

  routerCalls = [];
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'settings-back').props.onPress();
  });
  assert.equal(routerCalls.at(-1), '/');
  assert.equal(hasTestId(renderer, 'settings-category-ui'), false);
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'settings-browse-categories').props.onPress();
  });
  assert.ok(findByTestId(renderer, 'settings-category-ui'));

  await TestRenderer.act(async () => {
    renderer.unmount();
  });
  windowDimensions = previousDimensions;
}

async function testHomeSetupCircleFitsCompactStage() {
  const previousDimensions = windowDimensions;
  windowDimensions = { width: 320, height: 640 };
  appValue = baseAppValue({ engineStatus: 'no-model' });
  const { default: DemiScreen } = require('../app/index.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(DemiScreen));
  });

  const circle = findByTestId(renderer, 'demi-voice-circle');
  const rawCircleStyle =
    typeof circle.props.style === 'function'
      ? circle.props.style({ pressed: false })
      : circle.props.style;
  const circleStyle = rawCircleStyle
    .flat(Infinity)
    .filter(Boolean)
    .find((style) => style.width && style.height);
  assert.ok(circleStyle);
  assert.equal(circleStyle.width, circleStyle.height);
  assert.equal(circleStyle.borderRadius * 2, circleStyle.width);
  assert.equal(circle.props.accessibilityRole, 'button');
  assert.equal(circle.props.accessibilityLabel, 'Start voice input');
  assert.equal(hasTestId(renderer, 'home-setup-prompt'), false);
  assert.doesNotMatch(textContent(renderer), /Model setup required|Setup needed/);
  routerCalls = [];
  await TestRenderer.act(async () => {
    await circle.props.onPress();
  });
  assert.deepEqual(routerCalls, []);

  const stage = findByTestId(renderer, 'home-voice-stage');
  const stageStyle = stage.props.style
    .flat(Infinity)
    .filter(Boolean)
    .find((style) => typeof style.height === 'number');
  assert.ok(stageStyle);
  assert.ok(stageStyle.height >= circleStyle.height + 52);

  await TestRenderer.act(async () => {
    renderer.unmount();
  });
  windowDimensions = previousDimensions;
}

async function testModelRemovalRequiresConfirmation() {
  let removeCalls = 0;
  appValue = baseAppValue({
    localModel: {
      id: 'model-1',
      name: 'private-model.gguf',
      uri: '/device/documents/models/private-model.gguf',
      sizeBytes: 42,
      importedAt: 1,
      contextSize: 2048,
    },
    removeModel: async () => {
      removeCalls += 1;
    },
  });
  const { default: SettingsScreen } = require('../app/settings.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(SettingsScreen));
  });
  await expandSettingsGroup(renderer, 'settings-group-offline-setup');
  assert.equal(hasTestId(renderer, 'confirm-remove-local-model'), false);
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'remove-local-model').props.onPress();
  });
  assert.equal(removeCalls, 0);
  assert.match(textContent(renderer), /Remove local model\?/);
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'confirm-remove-local-model').props.onPress();
  });
  assert.equal(removeCalls, 1);
  assert.equal(hasTestId(renderer, 'confirm-remove-local-model'), false);
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
}

async function testModelDownloadRequiresInFlowNetworkApproval() {
  const privacyCapabilities = require('../lib/privacyCapabilities.ts');
  const approvalCalls = [];
  let downloadCalls = 0;

  function ModelDownloadHarness({ SettingsScreen, initialPrivacyState }) {
    const [privacyState, setPrivacyState] = React.useState(
      initialPrivacyState ?? privacyCapabilities.createDefaultPrivacyState(),
    );
    appValue = baseAppValue({
      privacyReady: true,
      privacyState,
      setCapabilityApproval: async (capabilityId, approval) => {
        approvalCalls.push([capabilityId, approval]);
        setPrivacyState((current) =>
          privacyCapabilities.updateCapabilityGrant(
            current,
            capabilityId,
            approval,
          ),
        );
      },
      downloadRecommendedModel: async () => {
        downloadCalls += 1;
      },
    });
    return React.createElement(SettingsScreen);
  }

  const { default: SettingsScreen } = require('../app/settings.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(ModelDownloadHarness, { SettingsScreen }),
    );
  });
  await expandSettingsGroup(renderer, 'settings-group-offline-setup');
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'download-recommended').props.onPress();
  });
  assert.equal(downloadCalls, 0);
  assert.match(textContent(renderer), /Allow this model download/);
  assert.match(textContent(renderer), /No conversations, memories, or profile/);
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'cancel-model-download-approval').props.onPress();
  });
  assert.equal(approvalCalls.length, 0);
  assert.equal(downloadCalls, 0);

  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'download-recommended').props.onPress();
  });
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'confirm-model-download-approval').props.onPress();
    await Promise.resolve();
  });
  assert.deepEqual(approvalCalls, [
    ['network.model-download', 'approved'],
  ]);
  assert.equal(downloadCalls, 1);
  assert.equal(hasTestId(renderer, 'confirm-model-download-approval'), false);
  await TestRenderer.act(async () => {
    renderer.unmount();
  });

  const pausedPrivacyState = privacyCapabilities.createDefaultPrivacyState();
  pausedPrivacyState.globalPause = true;
  appValue = baseAppValue();
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(ModelDownloadHarness, {
        SettingsScreen,
        initialPrivacyState: pausedPrivacyState,
      }),
    );
  });
  await expandSettingsGroup(renderer, 'settings-group-offline-setup');
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'download-recommended').props.onPress();
  });
  assert.equal(hasTestId(renderer, 'confirm-model-download-approval'), false);
  assert.match(textContent(renderer), /Privacy pause is active/);
  assert.equal(approvalCalls.length, 1);
  assert.equal(downloadCalls, 1);
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
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
  await expandSettingsGroup(renderer, 'settings-group-local-voice');
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'voice-option-voice-1').props.onPress();
  });
  assert.equal(updateCalls, 1);
  assert.equal(
    findByTestId(renderer, 'voice-option-voice-1').props.accessibilityState.selected,
    false,
  );
}

async function testVoiceErrorsExposeAccessibleRetry() {
  let refreshCalls = 0;
  let dismissCalls = 0;
  appValue = baseAppValue({
    voiceError: 'The bundled English voice is not ready.',
    refreshOfflineVoices: async () => {
      refreshCalls += 1;
    },
    dismissVoiceError: () => {
      dismissCalls += 1;
    },
  });
  const { default: SettingsScreen } = require('../app/settings.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(SettingsScreen));
  });
  await expandSettingsGroup(renderer, 'settings-group-local-voice');
  const status = renderer.root.findByProps({ accessibilityRole: 'alert' });
  assert.match(
    status.props.children[0].props.children,
    /bundled English voice is not ready/i,
  );
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'refresh-offline-voice-status').props.onPress();
  });
  assert.equal(dismissCalls, 1);
  assert.equal(refreshCalls, 1);
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
}

async function testModelReclaimFailureKeepsConfirmationOpen() {
  let reclaimCalls = 0;
  let refreshCalls = 0;
  appValue = baseAppValue({
    storageUsage: {
      total: { bytes: 64, status: 'estimated' },
      activeModel: { bytes: 32, status: 'measured' },
      reclaimableModels: { bytes: 32, status: 'measured', fileCount: 2 },
      conversations: { bytes: 0, status: 'estimated' },
      memories: { bytes: 0, status: 'estimated' },
      settingsAndProfile: { bytes: 0, status: 'estimated' },
      appFiles: { bytes: 0, status: 'measured' },
      temporaryFiles: { bytes: 0, status: 'measured' },
      freeDevice: { bytes: 1000, status: 'measured' },
    },
    refreshStorageUsage: () => {
      refreshCalls += 1;
    },
    reclaimUnusedModelFiles: async () => {
      reclaimCalls += 1;
      return {
        status: 'completed',
        deletedFiles: 1,
        deletedBytes: 16,
        failedFiles: 1,
      };
    },
  });
  const previousPlatform = { ...fakeReactNative.Platform };
  fakeReactNative.Platform.OS = 'android';
  fakeReactNative.Platform.Version = 34;
  const { default: SettingsScreen } = require('../app/settings.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(SettingsSessionHarness, { SettingsScreen }),
    );
  });
  await expandSettingsGroup(renderer, 'settings-group-device-footprint');
  assert.equal(hasTestId(renderer, 'toggle-storage-details'), false);
  assert.ok(findByTestId(renderer, 'reclaim-model-files'));
  assert.ok(findByTestId(renderer, 'refresh-storage-usage'));
  assert.match(textContent(renderer), /Reclaimable model files/);
  assert.match(textContent(renderer), /Local storage/);
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'reclaim-model-files').props.onPress();
  });
  assert.ok(findByTestId(renderer, 'confirm-reclaim-model-files'));
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'confirm-reclaim-model-files').props.onPress();
  });
  assert.equal(reclaimCalls, 1);
  assert.equal(refreshCalls, 1);
  assert.ok(findByTestId(renderer, 'confirm-reclaim-model-files'));
  assert.match(textContent(renderer), /could not be removed/);
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
  fakeReactNative.Platform.OS = previousPlatform.OS;
  fakeReactNative.Platform.Version = previousPlatform.Version;
}

async function testStorageDetailsOpenWithDeviceStorage() {
  appValue = baseAppValue();
  const { default: SettingsScreen } = require('../app/settings.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(SettingsSessionHarness, { SettingsScreen }),
    );
  });
  await expandSettingsGroup(renderer, 'settings-group-device-footprint');
  assert.ok(findByTestId(renderer, 'refresh-storage-usage'));
  assert.match(textContent(renderer), /Local storage/);
  assert.equal(hasTestId(renderer, 'toggle-storage-details'), false);
  await TestRenderer.act(async () => {
    renderer.unmount();
  });

  appValue = baseAppValue();
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(SettingsSessionHarness, { SettingsScreen }),
    );
  });
  await expandSettingsGroup(renderer, 'settings-group-device-footprint');
  assert.ok(findByTestId(renderer, 'refresh-storage-usage'));
  assert.match(textContent(renderer), /Local storage/);
  assert.equal(hasTestId(renderer, 'toggle-storage-details'), false);
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
}

async function testStorageRefreshKeepsDetailsAndSummary() {
  const previousPlatform = { ...fakeReactNative.Platform };
  fakeReactNative.Platform.OS = 'android';
  fakeReactNative.Platform.Version = 34;
  const { default: SettingsScreen } = require('../app/settings.tsx');

  const initialUsage = storageUsage(64);
  const refreshedUsage = storageUsage(128, 1700000060000);
  const refresh = deferred();
  appValue = baseAppValue({ storageUsage: initialUsage });

  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(StorageRefreshHarness, {
        SettingsScreen,
        refreshPromise: refresh.promise,
      }),
    );
  });
  await expandSettingsGroup(renderer, 'settings-group-device-footprint');
  assert.equal(hasTestId(renderer, 'toggle-storage-details'), false);
  assert.match(textContent(renderer), /64 B tracked on this device/);
  assertStorageUpdated(renderer, initialUsage.measuredAt);

  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'refresh-storage-usage').props.onPress();
  });
  assert.equal(
    findByTestId(renderer, 'refresh-storage-usage').props.accessibilityLabel,
    'Refreshing local storage usage',
  );
  assert.equal(
    findByTestId(renderer, 'refresh-storage-usage').props.accessibilityState
      .disabled,
    true,
  );
  assert.ok(findByTestId(renderer, 'storage-refresh-indicator'));
  assert.ok(findByTestId(renderer, 'reclaim-model-files'));
  refresh.resolve(refreshedUsage);
  await TestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.ok(findByTestId(renderer, 'refresh-storage-usage'));
  assert.equal(
    findByTestId(renderer, 'refresh-storage-usage').props.accessibilityLabel,
    'Refresh local storage usage',
  );
  assert.equal(
    findByTestId(renderer, 'refresh-storage-usage').props.accessibilityState
      .disabled,
    false,
  );
  assert.equal(
    renderer.root.findAllByProps({ testID: 'storage-refresh-indicator' }).length,
    0,
  );
  assert.match(textContent(renderer), /128 B tracked on this device/);
  assert.doesNotMatch(textContent(renderer), /64 B tracked on this device/);
  assertStorageUpdated(renderer, refreshedUsage.measuredAt);
  await TestRenderer.act(async () => {
    renderer.unmount();
  });

  const failedRefresh = deferred();
  appValue = baseAppValue({ storageUsage: initialUsage });
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(StorageRefreshHarness, {
        SettingsScreen,
        refreshPromise: failedRefresh.promise,
      }),
    );
  });
  await expandSettingsGroup(renderer, 'settings-group-device-footprint');
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'refresh-storage-usage').props.onPress();
  });
  assert.equal(
    findByTestId(renderer, 'refresh-storage-usage').props.accessibilityLabel,
    'Refreshing local storage usage',
  );
  assert.ok(findByTestId(renderer, 'storage-refresh-indicator'));
  assert.ok(findByTestId(renderer, 'reclaim-model-files'));
  failedRefresh.reject(new Error('storage refresh failed'));
  await TestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.ok(findByTestId(renderer, 'refresh-storage-usage'));
  assert.equal(
    findByTestId(renderer, 'refresh-storage-usage').props.accessibilityLabel,
    'Refresh local storage usage',
  );
  assert.equal(
    renderer.root.findAllByProps({ testID: 'storage-refresh-indicator' }).length,
    0,
  );
  assert.match(textContent(renderer), /64 B tracked on this device/);
  assertStorageUpdated(renderer, initialUsage.measuredAt);
  await TestRenderer.act(async () => {
    renderer.unmount();
  });

  fakeReactNative.Platform.OS = previousPlatform.OS;
  fakeReactNative.Platform.Version = previousPlatform.Version;
}

async function testStorageRefreshRaceKeepsNewestSummary() {
  const previousPlatform = { ...fakeReactNative.Platform };
  fakeReactNative.Platform.OS = 'android';
  fakeReactNative.Platform.Version = 34;
  const { default: SettingsScreen } = require('../app/settings.tsx');
  const olderRefresh = deferred();
  const newerRefresh = deferred();
  const initialUsage = storageUsage(64, 1700000000000);
  const newerUsage = storageUsage(256, 1700000120000);
  const olderUsage = storageUsage(128, 1700000060000);
  appValue = baseAppValue({ storageUsage: initialUsage });

  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(StorageRaceHarness, {
        SettingsScreen,
        refreshPromises: [olderRefresh.promise, newerRefresh.promise],
      }),
    );
  });
  await expandSettingsGroup(renderer, 'settings-group-device-footprint');
  assert.equal(hasTestId(renderer, 'toggle-storage-details'), false);
  assert.match(textContent(renderer), /64 B tracked on this device/);

  await TestRenderer.act(async () => {
    appValue.refreshStorageUsage();
    appValue.refreshStorageUsage();
  });
  newerRefresh.resolve(newerUsage);
  await TestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.match(textContent(renderer), /256 B tracked on this device/);
  assertStorageUpdated(renderer, newerUsage.measuredAt);
  assert.equal(
    findByTestId(renderer, 'refresh-storage-usage').props.accessibilityState
      .disabled,
    false,
  );
  assert.equal(
    renderer.root.findAllByProps({ testID: 'storage-refresh-indicator' }).length,
    0,
  );
  olderRefresh.resolve(olderUsage);
  await TestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.match(textContent(renderer), /256 B tracked on this device/);
  assert.doesNotMatch(textContent(renderer), /128 B tracked on this device/);
  assert.equal(
    findByTestId(renderer, 'refresh-storage-usage').props.accessibilityState
      .disabled,
    false,
  );
  assert.equal(
    renderer.root.findAllByProps({ testID: 'storage-refresh-indicator' }).length,
    0,
  );
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
  fakeReactNative.Platform.OS = previousPlatform.OS;
  fakeReactNative.Platform.Version = previousPlatform.Version;
}

function testStorageMeasurementWaitsForProcessRestore() {
  const source = fs.readFileSync(
    path.join(__dirname, '../context/AppContext.tsx'),
    'utf8',
  );
  const startupEffectStart = source.indexOf('  useEffect(() => {');
  const measurementEffectStart = source.indexOf(
    '  useEffect(() => {\n    if (!settingsReady) return;',
  );
  const setReady = source.indexOf('setSettingsReady(true);', startupEffectStart);
  const startupCleanup = source.indexOf(
    'await cleanupUnusedModelFiles(activeModelUri)',
    startupEffectStart,
  );
  assert.ok(startupEffectStart >= 0);
  assert.ok(measurementEffectStart > startupEffectStart);
  assert.ok(startupCleanup > startupEffectStart);
  assert.ok(setReady > startupCleanup);
  assert.match(
    source.slice(measurementEffectStart, measurementEffectStart + 700),
    /if \(!settingsReady\) return;[\s\S]*setStorageUsageRefreshing\(true\);[\s\S]*measureLocalStorageUsage/,
  );
}

async function testForegroundReturnRefreshRaceKeepsNewestSummary() {
  const previousPlatform = { ...fakeReactNative.Platform };
  fakeReactNative.Platform.OS = 'android';
  fakeReactNative.Platform.Version = 34;
  const { default: SettingsScreen } = require('../app/settings.tsx');
  const foregroundRefresh = deferred();
  const manualRefresh = deferred();
  const initialUsage = storageUsage(64, 1700000000000);
  const foregroundUsage = storageUsage(192, 1700000180000);
  const manualUsage = storageUsage(256, 1700000240000);
  appValue = baseAppValue({ storageUsage: initialUsage });

  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(StorageRaceHarness, {
        SettingsScreen,
        refreshPromises: [foregroundRefresh.promise, manualRefresh.promise],
      }),
    );
  });
  await expandSettingsGroup(renderer, 'settings-group-device-footprint');
  await TestRenderer.act(async () => {
    // The first refresh represents AppState returning to active; the second
    // represents the user refreshing while that foreground scan is pending.
    appValue.refreshStorageUsage();
    appValue.refreshStorageUsage();
  });
  manualRefresh.resolve(manualUsage);
  await TestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.match(textContent(renderer), /256 B tracked on this device/);
  assertStorageUpdated(renderer, manualUsage.measuredAt);

  foregroundRefresh.resolve(foregroundUsage);
  await TestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.match(textContent(renderer), /256 B tracked on this device/);
  assert.doesNotMatch(textContent(renderer), /192 B tracked on this device/);
  assert.equal(
    findByTestId(renderer, 'refresh-storage-usage').props.accessibilityState
      .disabled,
    false,
  );
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
  fakeReactNative.Platform.OS = previousPlatform.OS;
  fakeReactNative.Platform.Version = previousPlatform.Version;
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
  assert.match(textContent(renderer), /Person Y likes socks\./);
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'conflicting-memory-memory-1-memory-2').props.onPress();
  });
  assert.equal(findByTestId(renderer, 'edit-memory-content').props.value, 'Person Y likes socks.');
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
        archivedAt: 3,
      },
    ],
  });
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(MemoriesScreen));
  });
  assert.doesNotMatch(textContent(renderer), /shared with another active memory/);
  assert.throws(
    () => findByTestId(renderer, 'conflicting-memory-memory-1-memory-2'),
    /No instances found/,
  );
  await TestRenderer.act(async () => {
    renderer.unmount();
  });

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
    ],
  });
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(MemoriesScreen));
  });
  assert.doesNotMatch(textContent(renderer), /shared with another active memory/);
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
  assert.equal(findByTestId(renderer, 'chat-input').props.value, 'stale draft');
}

async function testHomeDocumentRequestsAndToolNavigation() {
  const previousDimensions = windowDimensions;
  windowDimensions = { width: 320, height: 640 };
  let cleared = 0;
  let picked = 0;
  let sent = 0;
  const documentRequests = [];
  const selectedDocument = {
    id: 'selected-1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    sizeBytes: 12,
    uri: 'file:///notes.txt',
    content: 'private local content',
    selectedAt: 1,
  };
  const privacyState = {
    globalPause: false,
    capabilities: {
      'local.files': { approval: 'approved', expiresAt: null },
      'local.inference': { approval: 'approved', expiresAt: null },
      'network.remote-inference': { approval: 'approved', expiresAt: null },
    },
  };
  appValue = baseAppValue({
    privacyReady: true,
    privacyState,
    screenAttachment: null,
    turns: [{
      id: 'local-document-turn-1',
      role: 'assistant',
      content: 'A short local summary.',
      createdAt: 1,
      localDocument: {
        documentName: 'notes.txt',
        instruction: 'Summarize the selected file',
      },
    }],
    sendMessage: async () => { sent += 1; },
  });
  toolsValue = {
    selectedDocument,
    documentBusy: false,
    documentError: null,
    documentNotice: null,
    pickDocument: async () => { picked += 1; },
    transformDocument: async (...args) => { documentRequests.push(args); },
    clearDocument: () => { cleared += 1; },
  };
  routerCalls = [];
  const { default: DemiScreen } = require('../app/index.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(DemiScreen));
  });
  const homeAttachment = findByTestId(renderer, 'home-document-attachment');
  assert.equal(homeAttachment.props.testID, 'home-document-attachment');
  const homeAttachmentName = findByProps(renderer, { accessibilityLabel: 'Attached document: notes.txt' });
  assert.ok(homeAttachmentName);
  assert.match(textContent(renderer), /notes\.txt/);
  assert.ok(findByTestId(renderer, 'local-document-processed-label'));
  assert.ok(findByTestId(renderer, 'local-document-instruction'));
  assert.ok(findByTestId(renderer, 'local-document-result'));
  const homeConversationText = textContent(renderer);
  assert.match(homeConversationText, /Processed on this device\s+·\s+notes\.txt/);
  assert.match(homeConversationText, /Summarize the selected file/);
  assert.match(homeConversationText, /A short local summary\./);
  assert.equal(hasTestId(renderer, 'home-document-result'), false, 'local document output belongs in the conversation, not the composer');
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'keyboard-toggle').props.onPress();
  });
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'chat-input').props.onChangeText('Summarize the selected file');
  });
  await TestRenderer.act(async () => {
    await findByProps(renderer, { accessibilityLabel: 'Send request using attached document locally' }).props.onPress();
  });
  assert.deepEqual(documentRequests, [['Summarize the selected file', true]]);
  assert.equal(sent, 0, 'selected document requests must not use the ordinary/cloud-capable chat send path');
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'attach-home-document').props.onPress();
  });
  assert.equal(picked, 1);
  await TestRenderer.act(async () => {
    findByTestId(renderer, 'remove-home-document').props.onPress();
  });
  assert.equal(cleared, 1);
  assert.ok(findByTestId(renderer, 'local-document-result'), 'removing the attachment must not clear conversation history');

  await TestRenderer.act(async () => {
    findByTestId(renderer, 'open-home-tools').props.onPress();
  });
  assert.ok(findByTestId(renderer, 'home-tools-screen-access'));
  assert.match(textContent(renderer), /Advanced tools/);
  await TestRenderer.act(async () => {
    findByTestId(renderer, 'home-tools-screen-access').props.onPress();
  });
  assert.equal(routerCalls.at(-1), '/screen-access');
  await TestRenderer.act(async () => {
    findByTestId(renderer, 'open-home-tools').props.onPress();
  });
  await TestRenderer.act(async () => {
    findByTestId(renderer, 'home-tools-sandbox').props.onPress();
  });
  assert.equal(routerCalls.at(-1), '/code-actions');
  await TestRenderer.act(async () => { renderer.unmount(); });
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(DemiScreen));
  });
  assert.ok(findByTestId(renderer, 'local-document-result'), 'conversation entries remain available after leaving and reopening Home');

  await TestRenderer.act(async () => { renderer.unmount(); });
  toolsValue = {
    selectedDocument: null,
    documentBusy: false,
    documentError: null,
    documentNotice: 'Selection canceled. No document is attached.',
    pickDocument: async () => {},
    transformDocument: async () => {},
    clearDocument: () => {},
  };
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(DemiScreen));
  });
  assert.equal(hasTestId(renderer, 'home-document-attachment'), false);
  assert.match(textContent(renderer), /Selection canceled\. No document is attached\./);
  await TestRenderer.act(async () => { renderer.unmount(); });
  windowDimensions = previousDimensions;
}

async function testSelectedDocumentPickerCancellationAndRevocation() {
  const activePrivacyState = {
    globalPause: false,
    capabilities: {
      'local.files': { approval: 'approved', expiresAt: null },
      'local.inference': { approval: 'approved', expiresAt: null },
    },
  };
  const revokedPrivacyState = {
    globalPause: false,
    capabilities: {
      'local.files': { approval: 'revoked', expiresAt: null },
      'local.inference': { approval: 'approved', expiresAt: null },
    },
  };
  const inferencePrompts = [];
  const addedDocumentTurns = [];
  appValue = baseAppValue({
    privacyReady: true,
    privacyState: activePrivacyState,
    recordPrivacyAction: async () => {},
    recordAgentTrace: async () => {},
    runLocalInference: async (prompt) => {
      inferencePrompts.push(prompt);
      return 'local result';
    },
    addLocalDocumentTurn: async (entry) => { addedDocumentTurns.push(entry); },
  });
  documentPickerCalls = 0;
  documentReadCalls = 0;
  documentFileContents = 'selected document text';
  documentDeletedUris = [];
  documentPickerResult = {
    canceled: false,
    assets: [{
      name: 'notes.txt',
      uri: '/device/cache/notes.txt',
      mimeType: 'text/plain',
      size: documentFileContents.length,
    }],
  };

  const { ToolProvider, useTools } = require('../context/ToolContext.tsx');
  let tools;
  function Probe() {
    tools = useTools();
    return React.createElement('ToolProbe');
  }
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(ToolProvider, null, React.createElement(Probe)),
    );
  });

  await TestRenderer.act(async () => { await tools.pickDocument(); });
  assert.equal(tools.selectedDocument.name, 'notes.txt');
  assert.equal(tools.selectedDocument.content, documentFileContents);
  assert.deepEqual(documentDeletedUris, ['/device/cache/notes.txt'], 'the picker cache copy must be removed after reading');
  assert.equal(inferencePrompts.length, 0, 'selection alone must not send file contents to inference');
  await TestRenderer.act(async () => {
    await tools.transformDocument('Summarize the selected file', true);
  });
  assert.equal(tools.selectedDocument, null, 'a submitted request consumes the selected attachment');
  assert.match(inferencePrompts[0], /selected document text/);
  assert.match(inferencePrompts[0], /Summarize the selected file/);
  assert.deepEqual(addedDocumentTurns, [{
    documentName: 'notes.txt',
    instruction: 'Summarize the selected file',
    result: 'local result',
  }]);
  assert.equal(
    JSON.stringify(addedDocumentTurns).includes(documentFileContents),
    false,
    'conversation entries must not include selected document contents',
  );

  documentPickerResult = {
    canceled: false,
    assets: [{
      name: 'notes.txt',
      uri: '/device/cache/notes.txt',
      mimeType: 'text/plain',
      size: documentFileContents.length,
    }],
  };
  await TestRenderer.act(async () => { await tools.pickDocument(); });
  await TestRenderer.act(async () => { tools.clearDocument(); });
  assert.equal(tools.selectedDocument, null, 'removal must discard selected file content');

  await TestRenderer.act(async () => { await tools.pickDocument(); });
  assert.equal(tools.selectedDocument.name, 'notes.txt');

  documentPickerResult = { canceled: true };
  await TestRenderer.act(async () => { await tools.pickDocument(); });
  assert.equal(tools.selectedDocument, null, 'canceling replacement must discard the old selection');
  assert.equal(tools.documentNotice, 'Selection canceled. No document is attached.');

  appValue = { ...appValue, privacyState: activePrivacyState };
  documentPickerResult = {
    canceled: false,
    assets: [{
      name: 'notes.txt',
      uri: '/device/cache/notes.txt',
      mimeType: 'text/plain',
      size: documentFileContents.length,
    }],
  };
  await TestRenderer.act(async () => {
    renderer.update(React.createElement(ToolProvider, null, React.createElement(Probe)));
  });
  await TestRenderer.act(async () => { await tools.pickDocument(); });
  assert.equal(tools.selectedDocument.name, 'notes.txt');
  appValue = { ...appValue, privacyState: revokedPrivacyState };
  await TestRenderer.act(async () => {
    renderer.update(React.createElement(ToolProvider, null, React.createElement(Probe)));
  });
  assert.equal(tools.selectedDocument, null, 'revoking selected-file permission clears the attached contents');
  assert.match(tools.documentError, /attachment was removed/);

  const pickerCallsBeforeDeniedAttempt = documentPickerCalls;
  await TestRenderer.act(async () => { await tools.pickDocument(); });
  assert.equal(documentPickerCalls, pickerCallsBeforeDeniedAttempt, 'revoked file access must not open the picker');
  assert.match(tools.documentError, /paused or revoked/);

  appValue = { ...appValue, privacyState: activePrivacyState };
  await TestRenderer.act(async () => {
    renderer.update(React.createElement(ToolProvider, null, React.createElement(Probe)));
  });
  let finishPicker;
  documentPickerResult = new Promise((resolve) => { finishPicker = resolve; });
  const readsBeforeRevocation = documentReadCalls;
  let pendingPick;
  await TestRenderer.act(async () => {
    pendingPick = tools.pickDocument();
  });
  appValue = { ...appValue, privacyState: revokedPrivacyState };
  await TestRenderer.act(async () => {
    renderer.update(React.createElement(ToolProvider, null, React.createElement(Probe)));
  });
  finishPicker({
    canceled: false,
    assets: [{
      name: 'notes.txt',
      uri: '/device/cache/notes.txt',
      mimeType: 'text/plain',
      size: documentFileContents.length,
    }],
  });
  await TestRenderer.act(async () => { await pendingPick; });
  assert.equal(documentReadCalls, readsBeforeRevocation, 'revocation while the picker is open must prevent file reads');
  assert.equal(documentDeletedUris.at(-1), '/device/cache/notes.txt', 'a revoked in-flight selection must discard its picker copy');
  assert.equal(tools.selectedDocument, null);

  await TestRenderer.act(async () => { renderer.unmount(); });
}

async function testComposerModeSwitchIsAnimated() {
  appValue = baseAppValue();
  const { default: DemiScreen } = require('../app/index.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(DemiScreen));
  });

  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'keyboard-toggle').props.onPress();
  });

  const composer = findByTestId(renderer, 'chat-composer-container');
  const input = findByTestId(renderer, 'chat-input');
  assert.equal(composer.props.entering.name, 'FadeInUp');
  assert.equal(composer.props.entering.duration, 220);
  assert.equal(composer.props.exiting.name, 'FadeOutDown');
  assert.equal(composer.props.layout.name, 'LinearTransition');
  assert.equal(composer.props.layout.duration, 180);
  assert.equal(input.props.selectionColor, colors.primary);
  assert.equal(input.props.textAlignVertical, 'top');

  await TestRenderer.act(async () => {
    await input.props.onChangeText('A longer draft that grows naturally as it wraps across multiple lines.');
  });
  assert.equal(findByTestId(renderer, 'chat-input').props.value.length > 40, true);
  assert.equal(
    findByTestId(renderer, 'chat-composer-container').props.layout.duration,
    180,
  );

  await TestRenderer.act(async () => {
    await findByProps(renderer, {
      accessibilityLabel: 'Close message composer',
    }).props.onPress();
  });
  assert.equal(hasTestId(renderer, 'chat-input'), false);
  assert.ok(findByTestId(renderer, 'keyboard-toggle'));
  assert.equal(
    findByTestId(renderer, 'chat-composer-collapsed').props.entering.name,
    'FadeInDown',
  );

  await TestRenderer.act(async () => {
    renderer.unmount();
  });
}

async function testDictationStaysEditableUntilExplicitSend() {
  let sent = 0;
  appValue = baseAppValue({
    voiceTranscript: 'recognized phrase',
    clearVoiceTranscript: () => {},
    sendMessage: async (message) => {
      sent += 1;
      assert.equal(message, 'edited phrase');
    },
  });
  const { default: DemiScreen } = require('../app/index.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(DemiScreen));
  });
  await TestRenderer.act(async () => {
    await Promise.resolve();
  });
  assert.equal(sent, 0);
  const input = findByTestId(renderer, 'chat-input');
  assert.equal(input.props.value, 'recognized phrase');
  assert.equal(
    findByTestId(renderer, 'demi-voice-circle').props.accessibilityLabel,
    'Review dictation draft',
  );
  await TestRenderer.act(async () => {
    await input.props.onChangeText('edited phrase');
  });
  await TestRenderer.act(async () => {
    await findByProps(renderer, { accessibilityLabel: 'Send message' }).props.onPress();
  });
  assert.equal(sent, 1);
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
}

async function testEmptyDictationDoesNotSendAnything() {
  let sent = 0;
  appValue = baseAppValue({
    voiceTranscript: '',
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
  assert.equal(findByTestId(renderer, 'chat-input').props.value, '');
  assert.equal(sent, 0);
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
}

function findByProps(renderer, props) {
  return renderer.root.findByProps(props);
}

function testVoiceLifecycleGuardsLateRecognition() {
  const source = fs.readFileSync(
    path.join(__dirname, '../context/AppContext.tsx'),
    'utf8',
  );
  assert.match(source, /voiceRecognitionRunRef/);
  assert.match(source, /clearRecognitionSubscriptions/);
  assert.match(source, /if \(runId !== voiceRecognitionRunRef\.current\) return/);
  assert.match(source, /event\.status === "cancelled"/);
  assert.match(source, /voiceRecognitionRunRef\.current \+= 1/);
  assert.match(source, /const runId = previousRunId \+ 1/);
  assert.match(source, /await cancelLocalRecognition\(previousRunId\)/);
  assert.match(source, /setVoiceTranscript\(""\);[\s\S]*setVoiceInputStatus\("idle"\)/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(__dirname, '../app/index.tsx'), 'utf8'),
    /voiceInputStatus === 'idle'[\s\S]*handleSend\(\)/,
  );
}

async function testBrowserVoiceControlsExplainNativeRequirement() {
  routerCalls = [];
  appValue = baseAppValue();
  const { default: SettingsScreen } = require('../app/settings.tsx');
  let settingsRenderer;
  await TestRenderer.act(async () => {
    settingsRenderer = TestRenderer.create(
      React.createElement(SettingsSessionHarness, { SettingsScreen }),
    );
  });
  await expandSettingsGroup(settingsRenderer, 'settings-group-local-voice');
  assert.equal(hasTestId(settingsRenderer, 'offline-speech-setup'), false);
  assert.ok(findByTestId(settingsRenderer, 'voice-readiness'));
  assert.match(textContent(settingsRenderer), /installed Android app/);
  await expandSettingsGroup(settingsRenderer, 'settings-group-device-footprint');
  assert.match(textContent(settingsRenderer), /Device storage measurements are available/);
  assert.equal(hasTestId(settingsRenderer, 'toggle-storage-details'), false);
  assert.match(textContent(settingsRenderer), /Device storage measurements are available/);
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
  for (const [testID, label, route] of [
    ['open-calendar', 'Open important dates', '/calendar'],
    ['open-scheduled-work', 'Open scheduled work', '/scheduled'],
    ['open-settings', 'Open settings', '/settings'],
  ]) {
    const button = findByTestId(homeRenderer, testID);
    assert.equal(button.props.accessibilityRole, 'button');
    assert.equal(button.props.accessibilityLabel, label);
    await TestRenderer.act(async () => {
      await button.props.onPress();
    });
    assert.equal(routerCalls.at(-1), route);
  }
  routerCalls = [];
  assert.equal(
    findByTestId(homeRenderer, 'demi-voice-circle').props.accessibilityLabel,
    'Open settings for voice setup',
  );
  await TestRenderer.act(async () => {
    await findByTestId(homeRenderer, 'demi-voice-circle').props.onPress();
  });
  assert.equal(routerCalls[0], '/settings');
  await TestRenderer.act(async () => {
    homeRenderer.unmount();
  });
}

async function testStorageMeasurementFailuresStayBestEffort() {
  const previousPlatform = { ...fakeReactNative.Platform };
  fakeReactNative.Platform.OS = 'android';
  fakeReactNative.Platform.Version = 34;
  usageStorageItems = {
    '@second-brain/settings-v1': 'settings',
    '@second-brain/local-model-v1': 'model',
  };
  usageSecureFailure = false;
  usageFileSystemFailure = true;

  const { measureLocalStorageUsage } = require('../lib/localStorageUsage.ts');
  const partialUsage = await measureLocalStorageUsage(null, {
    settings: '@second-brain/settings-v1',
    model: '@second-brain/local-model-v1',
    conversation: 'conversation',
    profile: 'profile',
    memories: 'memories',
  });
  assert.equal(partialUsage.total.status, 'partial');
  assert.equal(partialUsage.appFiles.bytes, null);
  assert.equal(partialUsage.freeDevice.bytes, null);
  assert.equal(partialUsage.settingsAndProfile.bytes, 25);

  usageSecureFailure = true;
  const unavailableSecureUsage = await measureLocalStorageUsage(null, {
    settings: '@second-brain/settings-v1',
    model: '@second-brain/local-model-v1',
    conversation: 'conversation',
    profile: 'profile',
    memories: 'memories',
  });
  assert.equal(unavailableSecureUsage.conversations.bytes, null);
  assert.equal(unavailableSecureUsage.memories.bytes, null);
  assert.equal(unavailableSecureUsage.total.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(unavailableSecureUsage), /secure store unavailable/);

  usageSecureFailure = false;
  usageStorageItems = {};
  usageFileSystemFailure = false;
  fakeReactNative.Platform.OS = previousPlatform.OS;
  fakeReactNative.Platform.Version = previousPlatform.Version;
}

async function testSettingsStaysUsableWhenStorageIsUnavailable() {
  appValue = baseAppValue({
    storageError:
      'Some local data could not be opened. Chat, memory, and voice controls remain available; affected values are unavailable.',
  });
  const { default: SettingsScreen } = require('../app/settings.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(SettingsScreen));
  });
  assert.equal(textContent(renderer).includes('Some local data could not be opened'), false);
  await openSettingsCategory(renderer, 'memory');
  assert.match(textContent(renderer), /Some local data could not be opened/);
  await expandSettingsGroup(renderer, 'settings-group-local-voice');
  assert.ok(findByTestId(renderer, 'voice-readiness'));
  assert.ok(findByTestId(renderer, 'offline-tts-setup'));
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
}

function testStorageRefreshFailureKeepsLastSummary() {
  const source = fs.readFileSync(
    path.join(__dirname, '../context/AppContext.tsx'),
    'utf8',
  );
  assert.match(
    source,
    /setStorageUsage\(\(previous\) => previous \?\? createUnavailableLocalStorageUsage\(\)\)/,
  );
  assert.match(
    source,
    /measureLocalStorageUsage[\s\S]*?\.catch\(\(\) => \{/,
  );
  assert.match(
    source,
    /if \(\s*!isMounted \|\|\s*measurementRun !== storageMeasurementRunRef\.current\s*\)\s*\{\s*return;/,
  );
}

function testStorageRefreshesWhenAppReturnsToForeground() {
  const source = fs.readFileSync(
    path.join(__dirname, '../context/AppContext.tsx'),
    'utf8',
  );
  const storageLifecycleStart = source.indexOf(
    'const subscription = AppState.addEventListener("change"',
  );
  const storageLifecycleEnd = source.indexOf(
    '  });',
    storageLifecycleStart,
  );
  assert.ok(storageLifecycleStart >= 0);
  assert.ok(storageLifecycleEnd > storageLifecycleStart);
  const storageLifecycle = source.slice(
    storageLifecycleStart,
    storageLifecycleEnd,
  );
  assert.match(storageLifecycle, /if \(state === "active"\)/);
  assert.match(storageLifecycle, /refreshStorageUsage\(\);/);
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

function testBoxedCalendarAndScheduledCopyRemoved() {
  const removedCopyByScreen = [
    [
      '../app/calendar/index.tsx',
      ['Important dates', 'people worth remembering', 'Your people, your dates'],
    ],
    [
      '../app/scheduled/index.tsx',
      ['Scheduled work', 'private, bounded, on this device', 'Local automation'],
    ],
    [
      '../app/scheduled/edit.tsx',
      [
        'New scheduled work',
        'Edit scheduled work',
        'explicit sources, bounded runtime',
        'Define the job',
      ],
    ],
    [
      '../app/calendar/edit.tsx',
      [
        'New important date',
        'Edit important date',
        'saved only on this device',
        'Who & what',
        'The date stays in Demi.',
        'needed to notify you.',
      ],
    ],
  ];
  for (const [screen, copy] of removedCopyByScreen) {
    const source = fs.readFileSync(path.join(__dirname, screen), 'utf8');
    for (const phrase of copy) {
      assert.equal(
        source.includes(phrase),
        false,
        `Expected ${JSON.stringify(phrase)} to be removed from ${screen}.`,
      );
    }
  }
}

async function testScreenReviewAndScheduledActionsAtCompactWidth() {
  const previousDimensions = windowDimensions;
  windowDimensions = { width: 320, height: 640, fontScale: 2 };
  const { createDefaultPrivacyState } = require('../lib/privacyCapabilities.ts');
  const privacyState = createDefaultPrivacyState();
  let shared = null;
  let stopped = 0;
  appValue = baseAppValue({
    privacyState, screenSession: { status: 'active' },
    screenAccessStatus: { accessibility: 'enabled', screenshotAvailable: true },
    screenPreview: { text: 'Captured private text', capturedAt: 100, source: 'accessibility' },
    screenAttachment: null,
    attachScreenContext: text => { shared = text; },
    stopScreenSession: async () => { stopped++; },
    updateScreenPolicy: async () => {},
  });
  const { default: ScreenAccess } = require('../app/screen-access.tsx');
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(ScreenAccess)); });
  assert.match(textContent(renderer), /Android app only/);
  routerCalls = [];
  await TestRenderer.act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Back to settings' }).props.onPress(); });
  assert.deepEqual(routerCalls, ['/settings'], 'direct route falls back to Settings without GO_BACK warnings');
  // Even a captured mock must require an explicit share, never auto-attach.
  assert.equal(shared, null);
  await TestRenderer.act(async () => {
    findByTestId(renderer, 'screen-review-text').props.onChangeText('Reviewed text only');
  });
  await TestRenderer.act(async () => { findByTestId(renderer, 'attach-screen-context').props.onPress(); });
  assert.equal(shared, 'Reviewed text only');
  await TestRenderer.act(async () => { await findByTestId(renderer, 'stop-screen-session').props.onPress(); });
  assert.equal(stopped, 1);
  appValue = { ...appValue, screenPreview: null, screenSession: { status: 'stopped' } };
  await TestRenderer.act(async () => { renderer.update(React.createElement(ScreenAccess)); });
  assert.equal(hasTestId(renderer, 'screen-review-text'), false);
  assert.equal(findByTestId(renderer, 'start-screen-session').props.disabled, true);
  await TestRenderer.act(async () => { renderer.unmount(); });

  const calls = [];
  let deleteFails = true;
  scheduledValue = {
    isReady: true, isRunning: false, error: null, dismissError() {},
    jobs: [{ id: 'job-compact', name: 'Summary', description: 'Daily summary',
      cadence: 'daily', time: '09:00', enabled: true, sources: [], results: [],
      lastResultStatus: 'failed', lastError: 'Model unavailable', nextRunAt: null }],
    pauseJob: async (...args) => calls.push(['pause', ...args]),
    retryJob: async id => calls.push(['retry', id]),
    runJobNow: async id => calls.push(['run', id]),
    deleteJob: async id => { if (deleteFails) throw Error('write failed'); calls.push(['delete', id]); },
  };
  const { default: Scheduled } = require('../app/scheduled/index.tsx');
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(Scheduled)); });
  assert.doesNotMatch(textContent(renderer), /Useful work, with limits/);
  assert.ok(findByTestId(renderer, 'add-scheduled-job'));
  assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Edit Summary' }));
  await TestRenderer.act(async () => { await renderer.root.findByProps({ accessibilityLabel: 'Pause Summary' }).props.onPress(); });
  assert.deepEqual(calls[0], ['pause', 'job-compact', true]);
  await TestRenderer.act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Delete Summary' }).props.onPress(); });
  assert.equal(calls.some(call => call[0] === 'delete'), false);
  await TestRenderer.act(async () => { await findByTestId(renderer, 'confirm-delete-scheduled-job').props.onPress(); });
  assert.ok(findByTestId(renderer, 'confirm-delete-scheduled-job'));
  assert.match(textContent(renderer), /could not be saved/);
  deleteFails = false;
  await TestRenderer.act(async () => { await findByTestId(renderer, 'confirm-delete-scheduled-job').props.onPress(); });
  assert.equal(hasTestId(renderer, 'confirm-delete-scheduled-job'), false);
  assert.ok(calls.some(call => call[0] === 'delete'));
  await TestRenderer.act(async () => { renderer.unmount(); });
  windowDimensions = previousDimensions;
}

async function main() {
  await testScreenReviewAndScheduledActionsAtCompactWidth();
  await testProfileSaveFailureKeepsEditorOpen();
  await testSettingsNavigationGroupsRemainReachable();
  await testHomeSetupCircleFitsCompactStage();
  await testModelRemovalRequiresConfirmation();
  await testModelDownloadRequiresInFlowNetworkApproval();
  await testSettingsFailureKeepsControlledValue();
  await testVoiceErrorsExposeAccessibleRetry();
  await testModelReclaimFailureKeepsConfirmationOpen();
  await testStorageDetailsOpenWithDeviceStorage();
  await testStorageRefreshKeepsDetailsAndSummary();
  await testStorageRefreshRaceKeepsNewestSummary();
  testStorageMeasurementWaitsForProcessRestore();
  await testForegroundReturnRefreshRaceKeepsNewestSummary();
  await testMemoryApprovalFailureKeepsModalOpen();
  await testMemoryAliasesUseSharedMutation();
  await testVoiceStartClearsDraftBeforeRecognition();
  await testHomeDocumentRequestsAndToolNavigation();
  await testSelectedDocumentPickerCancellationAndRevocation();
  await testComposerModeSwitchIsAnimated();
  await testDictationStaysEditableUntilExplicitSend();
  await testEmptyDictationDoesNotSendAnything();
  testVoiceLifecycleGuardsLateRecognition();
  await testBrowserVoiceControlsExplainNativeRequirement();
  await testStorageMeasurementFailuresStayBestEffort();
  await testSettingsStaysUsableWhenStorageIsUnavailable();
  testStorageRefreshFailureKeepsLastSummary();
  testStorageRefreshesWhenAppReturnsToForeground();
  await testCalendarRetryKeepsDateWhenPersistenceFails();
  await testCalendarReminderSurvivesRestartAndSchedulingFailure();
  await testReminderCandidateRoutesWithExactTime();
  testDownloadCancellationGuardRunsBeforeCommit();
  testBoxedCalendarAndScheduledCopyRemoved();
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