const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

async function main() {
  const sandbox = await import(
    pathToFileURL(path.resolve(__dirname, "../lib/sandboxCode.ts")).href
  );
  const input = {
    id: "rows-1",
    name: "orders.json",
    mimeType: "application/json",
    sizeBytes: 100,
    content: JSON.stringify([
      { name: "Ada", amount: 4, status: "open" },
      { name: "Grace", amount: 6, status: "closed" },
      { name: "Lin", amount: 10, status: "open" },
    ]),
  };

  const count = await sandbox.executeSandboxCode({
    source: '{"version":1,"operation":"count"}',
    inputs: [input],
  });
  assert.equal(count.status, "completed");
  assert.match(count.output, /"count": 3/);
  assert.deepEqual(count.generatedFiles, []);
  assert.equal(count.stdout, "");

  const average = await sandbox.executeSandboxCode({
    source: '{"version":1,"operation":"average","field":"amount"}',
    inputs: [input],
  });
  assert.equal(average.status, "completed");
  assert.match(average.output, /"average": 6\.666/);

  const filtered = await sandbox.executeSandboxCode({
    source: '{"version":1,"operation":"filter","field":"status","equals":"open"}',
    inputs: [input],
  });
  assert.equal(filtered.status, "completed");
  assert.match(filtered.output, /Ada/);
  assert.doesNotMatch(filtered.output, /Grace/);

  const csv = await sandbox.executeSandboxCode({
    source: '{"version":1,"operation":"sum","field":"amount"}',
    inputs: [{
      id: "csv-1",
      name: "orders.csv",
      mimeType: "text/csv",
      sizeBytes: 35,
      content: "name,amount\nAda,4\nGrace,6\n",
    }],
  });
  assert.equal(csv.status, "completed");
  assert.match(csv.output, /"sum": 10/);

  const calculation = await sandbox.executeSandboxCode({
    source: '{"version":1,"operation":"calculate","expression":"(12 + 8) * 3"}',
    inputs: [input],
  });
  assert.equal(calculation.status, "completed");
  assert.match(calculation.output, /"result": 60/);

  for (const source of [
    '{"version":1,"operation":"calculate","expression":"globalThis.process"}',
    '{"version":1,"operation":"calculate","expression":"fetch(1)"}',
    '{"version":1,"operation":"calculate","expression":"require(\"fs\")"}',
    '{"version":1,"operation":"count","path":"../../secrets"}',
  ]) {
    const rejected = await sandbox.executeSandboxCode({ source, inputs: [input] });
    assert.equal(rejected.status, "failed");
  }

  const cancelled = await sandbox.executeSandboxCode({
    source: '{"version":1,"operation":"count"}',
    inputs: [input],
    isCancelled: () => true,
  });
  assert.equal(cancelled.status, "cancelled");

  const oversized = await sandbox.executeSandboxCode({
    source: '{"version":1,"operation":"count"}',
    inputs: [{
      ...input,
      content: "x".repeat(sandbox.SANDBOX_LIMITS.maxInputBytes + 1),
    }],
  });
  assert.equal(oversized.status, "failed");
  assert.match(oversized.stderr, /larger than/);

  const secret = await sandbox.executeSandboxCode({
    source: '{"version":1,"operation":"select","fields":["email"]}',
    inputs: [{
      ...input,
      content: JSON.stringify([{ email: "ada@example.com", token: "sk_live_123456789" }]),
    }],
  });
  assert.equal(secret.status, "completed");
  assert.doesNotMatch(secret.output, /ada@example.com/);
  assert.doesNotMatch(secret.output, /sk_live_123456789/);

  console.log("Sandbox code action checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});