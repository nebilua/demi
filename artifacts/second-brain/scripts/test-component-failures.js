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
      getInfoAsync: async () => {
        if (usageFileSystemFailure) throw new Error('file system unavailable');
        return { exists: false, isDirectory: false, size: 0 };
      },
      readDirectoryAsync: async () => [],
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

function SettingsSessionHarness({ SettingsScreen }) {
  const [expanded, setExpanded] = React.useState(
    appValue.storageDetailsExpanded ?? false,
  );
  appValue = {
    ...appValue,
    storageDetailsExpanded: expanded,
    setStorageDetailsExpanded: setExpanded,
  };
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
  const [expanded, setExpanded] = React.useState(
    appValue.storageDetailsExpanded ?? false,
  );
  const [usage, setUsage] = React.useState(appValue.storageUsage ?? null);
  const [refreshing, setRefreshing] = React.useState(false);
  appValue = {
    ...appValue,
    storageDetailsExpanded: expanded,
    setStorageDetailsExpanded: setExpanded,
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
  const [expanded, setExpanded] = React.useState(
    appValue.storageDetailsExpanded ?? false,
  );
  const [usage, setUsage] = React.useState(appValue.storageUsage ?? null);
  const [refreshing, setRefreshing] = React.useState(false);
  const refreshRunRef = React.useRef(0);
  appValue = {
    ...appValue,
    storageDetailsExpanded: expanded,
    setStorageDetailsExpanded: setExpanded,
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
    storageDetailsExpanded: false,
    setStorageDetailsExpanded: () => {},
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

async function testSettingsNavigationGroupsRemainReachable() {
  appValue = baseAppValue();
  const { default: SettingsScreen } = require('../app/settings.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(SettingsSessionHarness, { SettingsScreen }),
    );
  });

  for (const groupId of [
    'settings-group-privacy',
    'settings-group-device-footprint',
    'settings-group-offline-setup',
    'settings-group-local-voice',
    'settings-group-advanced-preferences',
  ]) {
    const group = findByTestId(renderer, groupId);
    assert.equal(group.props.accessibilityRole, 'button');
    assert.equal(group.props.accessibilityState.expanded, false);
    assert.match(group.props.accessibilityLabel, /expand/);
  }
  assert.ok(findByTestId(renderer, 'privacy-global-pause'));
  assert.ok(findByTestId(renderer, 'model-status-summary'));
  assert.ok(findByTestId(renderer, 'clear-conversation-history'));
  assert.equal(hasTestId(renderer, 'open-screen-access'), false);
  assert.equal(hasTestId(renderer, 'offline-speech-setup'), false);
  assert.equal(hasTestId(renderer, 'appearance-option-light'), false);

  await expandSettingsGroup(renderer, 'settings-group-privacy');
  assert.ok(findByTestId(renderer, 'open-screen-access'));
  assert.ok(findByTestId(renderer, 'clear-privacy-state'));

  await expandSettingsGroup(renderer, 'settings-group-device-footprint');
  assert.ok(findByTestId(renderer, 'toggle-storage-details'));

  await expandSettingsGroup(renderer, 'settings-group-offline-setup');
  assert.ok(findByTestId(renderer, 'download-recommended'));

  await expandSettingsGroup(renderer, 'settings-group-local-voice');
  assert.ok(findByTestId(renderer, 'offline-speech-setup'));
  assert.ok(findByTestId(renderer, 'offline-tts-setup'));

  await expandSettingsGroup(renderer, 'settings-group-advanced-preferences');
  assert.ok(findByTestId(renderer, 'appearance-option-light'));
  assert.equal(
    findByTestId(renderer, 'appearance-option-light').props.accessibilityRole,
    'radio',
  );
  assert.equal(
    findByTestId(renderer, 'appearance-option-light').props.accessibilityState
      .selected,
    true,
  );

  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'clear-conversation-history').props.onPress();
  });
  assert.ok(findByTestId(renderer, 'confirm-clear-conversation'));
  assert.equal(
    findByTestId(renderer, 'confirm-clear-conversation').props.accessibilityRole,
    'button',
  );
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'cancel-clear-conversation').props.onPress();
  });
  assert.equal(hasTestId(renderer, 'confirm-clear-conversation'), false);

  await TestRenderer.act(async () => {
    renderer.unmount();
  });
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
    voiceError: 'No verified offline Android voice is installed.',
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
  assert.match(status.props.children[0].props.children, /No verified offline/);
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
  const storageToggle = findByTestId(renderer, 'toggle-storage-details');
  assert.equal(storageToggle.props.accessibilityRole, 'button');
  assert.equal(storageToggle.props.accessibilityState.expanded, false);
  assert.equal(storageToggle.props.accessibilityLabel, 'Local storage, show details');
  assert.equal(
    storageToggle.props.accessibilityHint,
    'Double tap to expand storage details.',
  );
  assert.equal(hasTestId(renderer, 'reclaim-model-files'), false);
  assert.equal(hasTestId(renderer, 'refresh-storage-usage'), false);
  assert.doesNotMatch(textContent(renderer), /Reclaimable model files/);
  await TestRenderer.act(async () => {
    await storageToggle.props.onPress();
  });
  assert.equal(
    findByTestId(renderer, 'toggle-storage-details').props.accessibilityState.expanded,
    true,
  );
  assert.equal(
    findByTestId(renderer, 'toggle-storage-details').props.accessibilityLabel,
    'Local storage, hide details',
  );
  assert.equal(
    findByTestId(renderer, 'toggle-storage-details').props.accessibilityHint,
    'Double tap to collapse storage details.',
  );
  assert.ok(findByTestId(renderer, 'reclaim-model-files'));
  assert.ok(findByTestId(renderer, 'refresh-storage-usage'));
  assert.match(textContent(renderer), /Reclaimable model files/);
  assert.match(textContent(renderer), /Local storage/);
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'toggle-storage-details').props.onPress();
  });
  assert.equal(hasTestId(renderer, 'reclaim-model-files'), false);
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'toggle-storage-details').props.onPress();
  });
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

async function testStorageDetailsPersistAcrossSettingsVisits() {
  appValue = baseAppValue();
  const { default: SettingsScreen } = require('../app/settings.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(SettingsSessionHarness, { SettingsScreen }),
    );
  });
  await expandSettingsGroup(renderer, 'settings-group-device-footprint');
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'toggle-storage-details').props.onPress();
  });
  assert.equal(
    findByTestId(renderer, 'toggle-storage-details').props.accessibilityState.expanded,
    true,
  );
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
  assert.equal(
    findByTestId(renderer, 'toggle-storage-details').props.accessibilityState.expanded,
    false,
  );
  assert.equal(
    findByTestId(renderer, 'toggle-storage-details').props.accessibilityLabel,
    'Local storage, show details',
  );
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
}

function assertStorageDetailsAreSessionOnly() {
  const source = fs.readFileSync(
    path.join(__dirname, '../context/AppContext.tsx'),
    'utf8',
  );
  const startupEffectStart = source.indexOf('  useEffect(() => {');
  const startupEffectEnd = source.indexOf(
    '  useEffect(() => {',
    startupEffectStart + 1,
  );
  const startupEffect = source.slice(startupEffectStart, startupEffectEnd);

  assert.match(
    source,
    /const \[storageDetailsExpanded, setStorageDetailsExpanded\] = useState\(false\);/,
  );
  assert.doesNotMatch(startupEffect, /storageDetailsExpanded/);
  assert.doesNotMatch(
    source,
    /AsyncStorage\.(?:getItem|setItem|removeItem)\([^)]*(?:storageDetailsExpanded|STORAGE_DETAILS)/,
  );
}

async function testStorageDetailsResetForFreshProviderSession() {
  assertStorageDetailsAreSessionOnly();
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
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'toggle-storage-details').props.onPress();
  });
  assert.equal(
    findByTestId(renderer, 'toggle-storage-details').props.accessibilityState
      .expanded,
    true,
  );
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
  assert.equal(
    findByTestId(renderer, 'toggle-storage-details').props.accessibilityState
      .expanded,
    true,
  );
  refresh.resolve(refreshedUsage);
  await TestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(
    findByTestId(renderer, 'toggle-storage-details').props.accessibilityState
      .expanded,
    true,
  );
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
    await findByTestId(renderer, 'toggle-storage-details').props.onPress();
  });
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
  assert.equal(
    findByTestId(renderer, 'toggle-storage-details').props.accessibilityState
      .expanded,
    true,
  );
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
  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'toggle-storage-details').props.onPress();
  });
  assert.equal(
    findByTestId(renderer, 'toggle-storage-details').props.accessibilityState
      .expanded,
    true,
  );
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
  assert.equal(
    findByTestId(renderer, 'toggle-storage-details').props.accessibilityState
      .expanded,
    true,
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
  assert.equal(
    findByTestId(renderer, 'toggle-storage-details').props.accessibilityState
      .expanded,
    true,
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
    await findByTestId(renderer, 'toggle-storage-details').props.onPress();
  });

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
  assert.equal(findByTestId(renderer, 'chat-input').props.value, '');
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
  assert.match(source, /event\.error === "aborted"/);
  assert.match(source, /voiceRecognitionRunRef\.current \+= 1/);
  assert.match(source, /const runId = voiceRecognitionRunRef\.current \+ 1/);
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
  assert.equal(findByTestId(settingsRenderer, 'offline-speech-setup').props.disabled, true);
  assert.equal(findByTestId(settingsRenderer, 'offline-tts-setup').props.disabled, true);
  assert.match(textContent(settingsRenderer), /installed Android app/);
  await expandSettingsGroup(settingsRenderer, 'settings-group-device-footprint');
  assert.match(textContent(settingsRenderer), /Device storage measurements are available/);
  await TestRenderer.act(async () => {
    await findByTestId(settingsRenderer, 'toggle-storage-details').props.onPress();
  });
  assert.match(textContent(settingsRenderer), /does not report device disk usage/);
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
  assert.match(textContent(renderer), /Some local data could not be opened/);
  await expandSettingsGroup(renderer, 'settings-group-local-voice');
  assert.ok(findByTestId(renderer, 'offline-speech-setup'));
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

async function main() {
  await testProfileSaveFailureKeepsEditorOpen();
  await testSettingsNavigationGroupsRemainReachable();
  await testModelRemovalRequiresConfirmation();
  await testSettingsFailureKeepsControlledValue();
  await testVoiceErrorsExposeAccessibleRetry();
  await testModelReclaimFailureKeepsConfirmationOpen();
  await testStorageDetailsPersistAcrossSettingsVisits();
  await testStorageDetailsResetForFreshProviderSession();
  await testStorageRefreshKeepsDetailsAndSummary();
  await testStorageRefreshRaceKeepsNewestSummary();
  testStorageMeasurementWaitsForProcessRestore();
  await testForegroundReturnRefreshRaceKeepsNewestSummary();
  await testMemoryApprovalFailureKeepsModalOpen();
  await testMemoryAliasesUseSharedMutation();
  await testVoiceStartClearsDraftBeforeRecognition();
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