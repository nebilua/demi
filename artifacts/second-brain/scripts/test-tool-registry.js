const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

async function main() {
  const registry = await import(
    pathToFileURL(path.resolve(__dirname, "../lib/toolRegistry.ts")).href
  );
  const privacy = await import(
    pathToFileURL(path.resolve(__dirname, "../lib/privacyCapabilities.ts")).href
  );

  const ids = registry.TOOL_REGISTRY.map((tool) => tool.id);
  assert.ok(ids.includes("local.files.transform"));
  assert.ok(ids.includes("local.calendar.delete"));
  assert.ok(ids.includes("local.contacts.read"));
  assert.ok(ids.includes("connector.gmail.read"));
  assert.equal(
    registry.validateToolInput({
      toolId: "local.files.transform",
      documentId: "doc-1",
      instruction: "Summarize this",
    }).ok,
    true,
  );
  assert.equal(
    registry.validateToolInput({
      toolId: "local.files.transform",
      documentId: "doc-1",
      instruction: " ".repeat(4),
    }).ok,
    false,
  );
  assert.equal(
    registry.validateToolInput({
      toolId: "connector.gmail.read",
      query: "in:inbox",
      recordLimit: 10,
    }).error,
    "No Gmail connector is connected.",
  );
  const preflight = registry.createToolPreflight(
    "connector.google-calendar.read",
    "Events between 2026-09-20 and 2026-09-27",
  );
  assert.equal(preflight.network, "Network required; nothing is sent until confirmed");
  assert.equal(preflight.confirmation, "Fresh confirmation required before this action");
  const defaults = privacy.createDefaultPrivacyState(1_700_000_000_000);
  assert.equal(defaults.capabilities["local.files"].approval, "approved");
  assert.equal(defaults.capabilities["local.contacts"].approval, "not-granted");
  console.log("Tool registry checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});