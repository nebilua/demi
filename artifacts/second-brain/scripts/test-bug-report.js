const assert = require('node:assert/strict');
const Module = require('node:module');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const {
  createPrivacySafeBugReport,
  MAX_BUG_REPORT_EVENTS,
  MAX_BUG_REPORT_BYTES,
  serializePrivacySafeBugReport,
} = require('../lib/bugReport.ts');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const colors = {
  card: '#fff',
  border: '#ddd',
  cardForeground: '#111',
  mutedForeground: '#777',
  foreground: '#111',
  primary: '#b33',
  primaryForeground: '#fff',
  destructive: '#900',
};

const runtimeSentinel = 'PRIVATE_CHAT_PROMPT_SENTINEL';
const modelPathSentinel = '/private/models/secret-model.gguf';
const rawErrorSentinel = 'RAW_ERROR_WITH_PRIVATE_TEXT';
const originalLoad = Module._load;
let fileWrites = [];
let fileDeletes = [];
let shareCalls = [];
let shareFailure = null;
let sharingAvailable = true;
let onCloseCalls = 0;

const passthrough = (name) => (props) =>
  React.createElement(
    name,
    props,
    typeof props.children === 'function'
      ? props.children({ pressed: false })
      : props.children,
  );

Module._load = function load(request, parent, isMain) {
  if (request === 'react-native') {
    return {
      Modal: ({ visible, children, ...props }) =>
        visible ? React.createElement('Modal', props, children) : null,
      Platform: { OS: 'android', Version: 35 },
      Pressable: passthrough('Pressable'),
      ScrollView: passthrough('ScrollView'),
      StyleSheet: { create: (value) => value },
      Text: passthrough('Text'),
      View: passthrough('View'),
    };
  }
  if (request === 'expo-constants') {
    return {
      __esModule: true,
      default: {
        expoConfig: {
          version: '0.1.0-alpha.2',
          android: { versionCode: 2 },
        },
        nativeBuildVersion: '2',
      },
    };
  }
  if (request === 'expo-file-system/legacy') {
    return {
      cacheDirectory: '/cache/',
      EncodingType: { UTF8: 'utf8' },
      writeAsStringAsync: async (uri, content) => fileWrites.push({ uri, content }),
      deleteAsync: async (uri) => fileDeletes.push(uri),
    };
  }
  if (request === 'expo-sharing') {
    return {
      isAvailableAsync: async () => sharingAvailable,
      shareAsync: async (uri, options) => {
        shareCalls.push({ uri, options });
        if (shareFailure) throw shareFailure;
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function findByTestId(renderer, testID) {
  return renderer.root.findByProps({ testID });
}

function allText(renderer) {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node) => node.children)
    .filter((child) => typeof child === 'string')
    .join(' ')
    .replace(/\s+/g, ' ');
}

function createMetrics() {
  return [
    {
      name: 'inference.load',
      durationMs: 2345.6,
      details: { modelPath: modelPathSentinel, prompt: runtimeSentinel },
      recordedAt: 1_700_000_000_000,
    },
    {
      name: 'inference.failure',
      durationMs: null,
      details: {
        durationMs: 87.4,
        category: rawErrorSentinel,
        rawError: rawErrorSentinel,
      },
      recordedAt: 1_700_000_060_000,
    },
    {
      name: runtimeSentinel,
      durationMs: 19,
      details: { path: modelPathSentinel },
      recordedAt: 1_700_000_120_000,
    },
  ];
}

function testReportContainsOnlyWhitelistedDiagnostics() {
  const report = createPrivacySafeBugReport({
    appVersion: '0.1.0-alpha.2',
    appBuild: '2',
    platform: 'android',
    osVersion: 35,
    modelStatus: 'ready',
    metrics: createMetrics(),
    now: 1_700_000_180_000,
  });
  const serialized = serializePrivacySafeBugReport(report);

  assert.equal(report.app.name, 'Demi');
  assert.equal(report.app.version, '0.1.0-alpha.2');
  assert.equal(report.app.build, '2');
  assert.equal(report.device.platform, 'android');
  assert.equal(report.device.osVersion, '35');
  assert.equal(report.diagnostics.modelStatus, 'ready');
  assert.deepEqual(
    report.diagnostics.events.map((event) => event.category),
    ['model_load', 'inference_failure'],
  );
  assert.equal(report.diagnostics.events[0].durationMs, 2346);
  assert.equal(report.diagnostics.events[1].durationMs, 87);
  for (const sentinel of [
    runtimeSentinel,
    modelPathSentinel,
    rawErrorSentinel,
  ]) {
    assert.equal(serialized.includes(sentinel), false);
  }
  assert.ok(serialized.length <= MAX_BUG_REPORT_BYTES);
}

function testReportIsBoundedAndRejectsUnsafeMetadata() {
  const metrics = Array.from({ length: 45 }, (_, index) => ({
    name: 'inference.completion',
    durationMs: index,
    details: { prompt: runtimeSentinel },
    recordedAt: 1_700_000_000_000 + index,
  }));
  const report = createPrivacySafeBugReport({
    appVersion: `Demi ${runtimeSentinel}`,
    appBuild: modelPathSentinel,
    platform: runtimeSentinel,
    osVersion: rawErrorSentinel,
    modelStatus: rawErrorSentinel,
    metrics,
    now: 1_700_000_100_000,
  });
  const serialized = serializePrivacySafeBugReport(report);

  assert.equal(report.app.version, null);
  assert.equal(report.app.build, null);
  assert.equal(report.device.platform, 'other');
  assert.equal(report.device.osVersion, null);
  assert.equal(report.diagnostics.modelStatus, 'unknown');
  assert.equal(report.diagnostics.events.length, MAX_BUG_REPORT_EVENTS);
  assert.ok(serialized.length <= MAX_BUG_REPORT_BYTES);
  for (const sentinel of [
    runtimeSentinel,
    modelPathSentinel,
    rawErrorSentinel,
  ]) {
    assert.equal(serialized.includes(sentinel), false);
  }
}

async function mountExporter(metrics) {
  const { BugReportExport } = require('../components/BugReportExport.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(BugReportExport, {
        visible: true,
        onClose: () => {
          onCloseCalls += 1;
        },
        metrics,
        modelStatus: 'ready',
        colors,
      }),
    );
  });
  return renderer;
}

async function testPreviewAndCancelDoNotExport() {
  fileWrites = [];
  shareCalls = [];
  onCloseCalls = 0;
  const renderer = await mountExporter(createMetrics());

  assert.match(allText(renderer), /Review bug report/);
  assert.match(allText(renderer), /App: Demi 0\.1\.0-alpha\.2/);
  assert.match(allText(renderer), /Device: android/);
  assert.match(allText(renderer), /model_load/);
  assert.match(allText(renderer), /Never included/);
  assert.doesNotMatch(allText(renderer), new RegExp(runtimeSentinel));
  assert.doesNotMatch(allText(renderer), new RegExp(modelPathSentinel));
  assert.doesNotMatch(allText(renderer), new RegExp(rawErrorSentinel));

  await TestRenderer.act(async () => {
    findByTestId(renderer, 'cancel-bug-report').props.onPress();
  });
  assert.equal(onCloseCalls, 1);
  assert.equal(fileWrites.length, 0);
  assert.equal(shareCalls.length, 0);
  await TestRenderer.act(async () => renderer.unmount());
}

async function testShareExportsSafeFileAndCleansTemporaryCopy() {
  fileWrites = [];
  fileDeletes = [];
  shareCalls = [];
  shareFailure = null;
  sharingAvailable = true;
  const renderer = await mountExporter(createMetrics());

  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'share-bug-report').props.onPress();
  });
  assert.equal(fileWrites.length, 1);
  assert.equal(shareCalls.length, 1);
  assert.equal(shareCalls[0].options.mimeType, 'application/json');
  assert.equal(fileDeletes.length, 1);
  assert.match(fileDeletes[0], /^\/cache\/demi-bug-report-\d+\.json$/);
  for (const sentinel of [
    runtimeSentinel,
    modelPathSentinel,
    rawErrorSentinel,
  ]) {
    assert.equal(fileWrites[0].content.includes(sentinel), false);
  }
  assert.match(allText(renderer), /Demi did not upload this report/);
  await TestRenderer.act(async () => renderer.unmount());
}

async function testShareFailureIsGenericAndRecoverable() {
  fileWrites = [];
  fileDeletes = [];
  shareCalls = [];
  shareFailure = new Error(rawErrorSentinel);
  sharingAvailable = true;
  const renderer = await mountExporter(createMetrics());

  await TestRenderer.act(async () => {
    await findByTestId(renderer, 'share-bug-report').props.onPress();
  });
  assert.match(
    allText(renderer),
    /The report could not be prepared for sharing\. Nothing was uploaded/,
  );
  assert.doesNotMatch(allText(renderer), new RegExp(rawErrorSentinel));
  assert.equal(fileDeletes.length, 1);
  shareFailure = null;
  await TestRenderer.act(async () => renderer.unmount());
}

async function main() {
  testReportContainsOnlyWhitelistedDiagnostics();
  testReportIsBoundedAndRejectsUnsafeMetadata();
  await testPreviewAndCancelDoNotExport();
  await testShareExportsSafeFileAndCleansTemporaryCopy();
  await testShareFailureIsGenericAndRecoverable();
  console.log('Privacy-safe bug report tests passed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
  });
