const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

async function main() {
  const cloud = await import(
    pathToFileURL(path.resolve(__dirname, "../lib/cloudFallback.ts")).href
  );
  const privacy = await import(
    pathToFileURL(path.resolve(__dirname, "../lib/privacyCapabilities.ts")).href
  );

  const initial = privacy.createDefaultPrivacyState(1_700_000_000_000);
  assert.equal(
    cloud.getCloudFallbackPermission(initial, true).allowed,
    false,
  );
  assert.deepEqual(
    cloud.decideInferenceRoute({
      localAllowed: true,
      localAvailable: true,
      cloudAllowed: true,
    }),
    { kind: "local" },
  );
  assert.deepEqual(
    cloud.decideInferenceRoute({
      localAllowed: true,
      localAvailable: false,
      cloudAllowed: true,
    }),
    { kind: "cloud", reason: "local-engine-unavailable" },
  );
  assert.deepEqual(
    cloud.decideInferenceRoute({
      localAllowed: true,
      localAvailable: false,
      cloudAllowed: false,
    }),
    { kind: "blocked", reason: "provider-not-approved" },
  );
  assert.deepEqual(
    cloud.decideInferenceRoute({
      localAllowed: false,
      localAvailable: false,
      cloudAllowed: true,
    }),
    { kind: "blocked", reason: "privacy" },
  );
  assert.equal(
    cloud.getCloudFallbackPermission(
      {
        ...initial,
        capabilities: {
          ...initial.capabilities,
          "network.remote-inference": {
            ...initial.capabilities["network.remote-inference"],
            approval: "approved",
            approvedAt: 1_700_000_000_000,
            expiresAt: null,
          },
        },
      },
      true,
    ).allowed,
    true,
  );
  assert.equal(
    cloud.getCloudFallbackPermission(
      {
        ...initial,
        globalPause: true,
      },
      true,
    ).allowed,
    false,
  );

  const bounded = cloud.buildCloudRequest({
    task: "chat",
    reason: "local-engine-unavailable",
    userInput: `Contact ada@example.com. ${"private text ".repeat(400)} token_sk_live_123456789`,
  });
  assert.ok(bounded.input.length <= cloud.CLOUD_FALLBACK_LIMITS.maxInputChars);
  assert.doesNotMatch(bounded.input, /ada@example\.com/);
  assert.doesNotMatch(bounded.input, /token_sk_live_123456789/);

  let networkCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async (_input, init) => {
    networkCalls += 1;
    assert.equal(init.method, "POST");
    const requestBody = JSON.parse(init.body);
    assert.equal(requestBody.task, "chat");
    assert.ok(requestBody.input.length <= cloud.CLOUD_FALLBACK_LIMITS.maxInputChars);
    return new Response(JSON.stringify({ output: "bounded cloud answer" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  // Building a request is pure and does not contact the network.
  assert.equal(networkCalls, 0);
  assert.equal(
    await cloud.requestCloudInference(bounded),
    "bounded cloud answer",
  );
  assert.equal(networkCalls, 1);

  global.fetch = async () =>
    new Response(JSON.stringify({ code: "quota", message: "quota" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  await assert.rejects(
    cloud.requestCloudInference(bounded),
    (error) => error.status === "quota",
  );

  global.fetch = async () =>
    new Response(JSON.stringify({ code: "provider-failed", message: "failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  await assert.rejects(
    cloud.requestCloudInference(bounded),
    (error) => error.status === "failed",
  );

  const controller = new AbortController();
  global.fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
      controller.abort();
    });
  await assert.rejects(
    cloud.requestCloudInference(bounded, { signal: controller.signal }),
    (error) => error.status === "cancelled",
  );

  global.fetch = originalFetch;
  console.log("Cloud fallback checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});