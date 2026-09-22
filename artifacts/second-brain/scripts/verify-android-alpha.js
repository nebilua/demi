#!/usr/bin/env node

/**
 * Run every deterministic regression check that contributes to the Android
 * alpha gate. Native APK validation is intentionally separate because it
 * requires a configured Android SDK/NDK and can build a release artifact.
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectDir = path.resolve(__dirname, "..");
const checks = [
  ["build cleanup", "test:build-cleanup"],
  ["build port handling", "test:build-port"],
  ["static artifact health and reachability", "test:static-build"],
  ["static release cleanup", "test:release-cleanup"],
  ["static build lock", "test:build-lock"],
  ["static build failure cleanup", "test:build-failure"],
  ["feature flows", "test:feature-flows"],
  ["component failure handling", "test:component-failures"],
  ["voice boundaries", "test:voice-boundaries"],
  ["Android release identity", "test:android-release"],
  ["Android reminders", "test:android-reminders"],
  ["scheduled jobs", "test:scheduled-jobs"],
  ["privacy capabilities", "test:privacy"],
  ["cloud fallback boundaries", "test:cloud-fallback"],
  ["tool registry", "test:tool-registry"],
  ["sandboxed code actions", "test:sandbox-code"],
  ["research library", "test:research"],
];

function runCheck(label, scriptName, index) {
  console.log(`\n[${index}/${checks.length}] ${label} (${scriptName})`);
  const result = spawnSync("pnpm", ["run", scriptName], {
    cwd: projectDir,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(
      `FAILED: ${scriptName} could not start: ${result.error.message}`,
    );
    return false;
  }
  if (result.status !== 0) {
    const detail = result.signal
      ? `signal ${result.signal}`
      : `exit status ${result.status ?? "unknown"}`;
    console.error(`FAILED: ${scriptName} (${detail})`);
    return false;
  }
  console.log(`PASSED: ${scriptName}`);
  return true;
}

const failures = [];
for (const [index, [label, scriptName]] of checks.entries()) {
  if (!runCheck(label, scriptName, index + 1)) failures.push(scriptName);
}

if (failures.length > 0) {
  console.error(
    `\nAndroid alpha deterministic gate failed (${failures.length}/${checks.length}):`,
  );
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `\nAndroid alpha deterministic gate passed: ${checks.length} checks completed.`,
  );
}
