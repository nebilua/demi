const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

async function main() {
  const privacy = await import(
    pathToFileURL(path.resolve(__dirname, "../lib/privacyCapabilities.ts")).href
  );
  const now = 1_700_000_000_000;
  const initial = privacy.createDefaultPrivacyState(now);

  assert.equal(
    privacy.isCapabilityActive(initial, "local.inference", now),
    true,
  );
  assert.equal(
    privacy.isCapabilityActive(initial, "network.remote-inference", now),
    false,
  );
  assert.equal(
    initial.capabilities["network.connectors"].approval,
    "not-granted",
  );
  assert.equal(
    initial.capabilities["network.model-download"].approval,
    "not-granted",
  );
  assert.equal(initial.screenPolicy.retention, "discard-immediately");
  assert.deepEqual(initial.screenPolicy.excludedApps, []);

  const paused = privacy.updateCapabilityGrant(
    initial,
    "local.inference",
    "paused",
    now + 1,
  );
  assert.equal(
    privacy.isCapabilityActive(paused, "local.inference", now + 1),
    false,
  );
  const resumed = privacy.updateCapabilityGrant(
    paused,
    "local.inference",
    "approved",
    now + 2,
  );
  assert.equal(
    privacy.isCapabilityActive(resumed, "local.inference", now + 2),
    true,
  );

  const globallyPaused = { ...resumed, globalPause: true };
  assert.equal(
    privacy.isCapabilityActive(globallyPaused, "local.inference", now + 2),
    false,
  );

  const redacted = privacy.redactPrivacyText(
    "Contact ada@example.com, 555-123-4567 with token_sk_live_123456789.",
  );
  assert.doesNotMatch(redacted, /ada@example\.com/);
  assert.doesNotMatch(redacted, /555-123-4567/);
  assert.doesNotMatch(redacted, /token_sk_live_123456789/);

  const withHistory = privacy.appendPrivacyAuditEvent(resumed, {
    capabilityId: "local.inference",
    action: "local-inference",
    status: "completed",
    summary: "The user prompt was intentionally omitted.",
  }, now);
  assert.equal(withHistory.auditEvents.length, 1);
  assert.equal(
    privacy.prunePrivacyState(
      {
        ...withHistory,
        auditEvents: [
          ...withHistory.auditEvents,
          {
            ...withHistory.auditEvents[0],
            id: "expired",
            retentionUntil: now - 1,
          },
        ],
      },
      now,
    ).auditEvents.length,
    1,
  );

  const parsed = privacy.parsePrivacyState(
    JSON.stringify({
      ...withHistory,
      version: 1,
      capabilities: {
        ...withHistory.capabilities,
        "network.remote-inference": {
          ...withHistory.capabilities["network.remote-inference"],
          approval: "approved",
          expiresAt: now - 1,
        },
      },
    }),
    now,
  );
  assert.equal(
    parsed.capabilities["network.remote-inference"].approval,
    "expired",
  );
  assert.equal(
    privacy.isCapabilityActive(parsed, "network.remote-inference", now),
    false,
  );
  const screenPolicyParsed = privacy.parsePrivacyState(
    JSON.stringify({
      ...initial,
      screenPolicy: {
        retention: "save-only-on-request",
        excludedApps: ["com.example.bank", "  private app  ", "", 42],
      },
    }),
    now,
  );
  assert.equal(screenPolicyParsed.screenPolicy.retention, "save-only-on-request");
  assert.deepEqual(screenPolicyParsed.screenPolicy.excludedApps, [
    "com.example.bank",
    "private app",
  ]);

  console.log("Privacy capability checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});