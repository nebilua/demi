const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rootDir = path.resolve(__dirname, "../../..");
const docsDir = path.join(rootDir, "docs");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function checkLocalReadmeLinks(readme) {
  const links = [...readme.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map(
    ([, label, href]) => ({ label, href }),
  );
  const localLinks = links.filter(
    ({ href }) => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href),
  );

  for (const { label, href } of localLinks) {
    const target = decodeURIComponent(href.split(/[?#]/, 1)[0]);
    assert.ok(
      target && fs.existsSync(path.resolve(rootDir, target)),
      `README link "${label}" must resolve: ${href}`,
    );
  }

  const targetForLabel = (pattern) =>
    links.find(({ label }) => pattern.test(label))?.href;
  assert.equal(
    targetForLabel(/privacy and data handling|how Demi handles your data/i),
    "docs/PRIVACY.md",
    "README must link to the canonical privacy guide",
  );
  assert.equal(
    targetForLabel(/(?:technical )?architecture/i),
    "docs/ARCHITECTURE.md",
    "README must link to the canonical architecture guide",
  );
  assert.equal(
    targetForLabel(/android (?:alpha )?release checklist/i),
    "docs/ANDROID_ALPHA_RELEASE.md",
    "README must link to the canonical Android alpha checklist",
  );
  assert.ok(fs.existsSync(path.join(docsDir, "ANDROID_ALPHA_RELEASE.md")));
}

function assertNoOutdatedVoiceClaims(label, text) {
  const oldAndroidServiceClaims = [
    /\b(?:uses?|requires?|depends? on|relies? on|falls? back to)\s+(?:the\s+)?(?:device['’]s\s+)?(?:android(?:['’]s)?\s+)?(?:speech[- ]recognition|text[- ]to[- ]speech|speech services?|voice engine)\b/i,
    /\bandroid(?:['’]s)?\s+(?:speech[- ]recognition|text[- ]to[- ]speech|speech services?|voice engine)(?:\s+\w+){0,4}\s+(?:is|are)\s+(?:used|required|needed|the default)\b/i,
  ];
  const languagePackDependency = [
    /\b(?:requires?|needs?|must install|install(?:ation)? requires?)\b.{0,80}\b(?:offline\s+)?language pack\b/i,
    /\b(?:offline\s+)?language pack\b.{0,80}\b(?:required|needed|must be installed|a dependency)\b/i,
  ];
  for (const pattern of [...oldAndroidServiceClaims, ...languagePackDependency]) {
    const matches = [...text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
    for (const match of matches) {
      const sentenceStart = Math.max(
        text.lastIndexOf(".", match.index),
        text.lastIndexOf("!", match.index),
        text.lastIndexOf("?", match.index),
        text.lastIndexOf("\n", match.index),
      ) + 1;
      const sentencePrefix = text.slice(sentenceStart, match.index);
      assert.ok(
        /\b(?:not|never|no|neither|without)\b|\b(?:does|do|is|are)n['’]?t\b/i.test(
          sentencePrefix,
        ),
        `${label} must not imply an outdated voice dependency`,
      );
    }
  }
}

function assertBundledVoiceDescription(label, text, { namesRequired }) {
  assert.match(text, /\bbundl\w*\b/i, `${label} should describe bundled voice assets`);
  assert.match(
    text,
    /\b(?:offline|on-device|locally)\b/i,
    `${label} should describe voice processing as local`,
  );
  if (namesRequired) {
    assert.match(text, /\bMoonshine\b/i, `${label} should name Moonshine`);
    assert.match(text, /\bPiper\b/i, `${label} should name Piper`);
  }
  assertNoOutdatedVoiceClaims(label, text);
}

function assertRemoteFallbackDescription(label, text, inputLimit) {
  const normalizedText = text.replace(/\s+/g, " ");
  assert.match(normalizedText, /remote inference/i, `${label} should identify remote inference`);
  assert.match(
    normalizedText,
    /current[- ]task.{0,50}(?:input|request)|(?:input|request).{0,50}current[- ]task/i,
    `${label} should limit remote inference to the current task`,
  );
  assert.match(
    normalizedText,
    new RegExp(`\\b${inputLimit.toLocaleString("en-US")}\\s+characters?\\b`),
    `${label} should state the current input limit`,
  );
  for (const term of ["email", "phone", "secret"]) {
    assert.match(
      normalizedText,
      new RegExp(term, "i"),
      `${label} should document ${term} redaction`,
    );
  }
  assert.match(
    normalizedText,
    /\btask\b.{0,80}\b(?:reason|why)\b|\b(?:reason|why)\b.{0,80}\btask\b/i,
    `${label} should explain that the task and fallback reason are identified`,
  );

  const exclusions = normalizedText
    .split(/[.!?]\s+/)
    .find(
      (sentence) =>
        /(?:not included|not sent|not saved|excluded|never sends?)/i.test(sentence) &&
        /\bhistory\b/i.test(sentence) &&
        /\bprofile\b/i.test(sentence),
    );
  assert.ok(
    exclusions,
    `${label} should explicitly exclude saved history and profile data from the request`,
  );
}

async function main() {
  const [cloud, privacy] = await Promise.all([
    import(pathToFileURL(path.join(rootDir, "artifacts/second-brain/lib/cloudFallback.ts")).href),
    import(pathToFileURL(path.join(rootDir, "artifacts/second-brain/lib/privacyCapabilities.ts")).href),
  ]);

  const readme = readProjectFile("README.md");
  const guides = {
    privacy: readProjectFile("docs/PRIVACY.md"),
    architecture: readProjectFile("docs/ARCHITECTURE.md"),
    alphaChecklist: readProjectFile("docs/ANDROID_ALPHA_RELEASE.md"),
  };

  checkLocalReadmeLinks(readme);
  assertBundledVoiceDescription("README", readme, { namesRequired: false });
  assertBundledVoiceDescription("Privacy guide", guides.privacy, { namesRequired: true });
  assertBundledVoiceDescription("Architecture guide", guides.architecture, {
    namesRequired: true,
  });
  assertBundledVoiceDescription("Android alpha checklist", guides.alphaChecklist, {
    namesRequired: true,
  });

  const voiceInput = privacy.CAPABILITY_DEFINITIONS.find(
    ({ id }) => id === "local.voice-input",
  );
  const voiceOutput = privacy.CAPABILITY_DEFINITIONS.find(
    ({ id }) => id === "local.voice-output",
  );
  assert.match(voiceInput.purpose, /bundled.*Moonshine/i);
  assert.match(voiceOutput.purpose, /bundled.*Piper/i);

  const currentInputLimit = cloud.CLOUD_FALLBACK_LIMITS.maxInputChars;
  for (const [label, text] of [
    ["Privacy guide", guides.privacy],
    ["Architecture guide", guides.architecture],
  ]) {
    assertRemoteFallbackDescription(label, text, currentInputLimit);
  }

  const currentTaskRequest = cloud.buildCloudRequest({
    task: "chat",
    reason: "local-engine-unavailable",
    userInput: "Email ada@example.com; phone +1 (555) 867-5309; token_sk_live_123456789.",
  });
  assert.deepEqual(
    Object.keys(currentTaskRequest).sort(),
    ["input", "reason", "task"],
    "The request should contain only the current task input and routing metadata",
  );
  assert.ok(currentTaskRequest.input.length <= currentInputLimit);
  assert.doesNotMatch(currentTaskRequest.input, /ada@example\.com|555/);
  assert.doesNotMatch(currentTaskRequest.input, /token_sk_live_123456789/);

  console.log("Public voice and cloud privacy guide checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
