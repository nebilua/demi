const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const contextSource = fs.readFileSync(
    path.resolve(__dirname, "../context/AppContext.tsx"),
    "utf8",
  );
  const homeSource = fs.readFileSync(
    path.resolve(__dirname, "../app/index.tsx"),
    "utf8",
  );
  const diagnostics = await import(
    pathToFileURL(path.resolve(__dirname, "../lib/runtimeDiagnostics.ts")).href
  );

  assert.match(contextSource, /startRuntimeMetric\("startup\.local-data"\)/);
  assert.match(contextSource, /startRuntimeMetric\("conversation\.persist"/);
  assert.match(contextSource, /startRuntimeMetric\("inference\.reply"/);
  assert.match(contextSource, /startRuntimeMetric\(\s*"inference\.memory-candidate"/);
  assert.match(contextSource, /STREAM_UI_UPDATE_INTERVAL_MS = 50/);
  assert.match(homeSource, /recordRuntimeEvent\('chat\.render'/);
  assert.match(homeSource, /React\.memo/);

  diagnostics.resetRuntimeDiagnostics();
  const finishStartup = diagnostics.startRuntimeMetric("startup.local-data");
  finishStartup({ savedTurns: 12 });
  const finishPersistence = diagnostics.startRuntimeMetric("conversation.persist");
  finishPersistence({ turnCount: 12 });
  diagnostics.recordRuntimeEvent("conversation.stream-render", {
    contentLength: 240,
  });
  const metrics = diagnostics.getRuntimeDiagnostics();
  assert.deepEqual(
    metrics.map((metric) => metric.name),
    [
      "startup.local-data",
      "conversation.persist",
      "conversation.stream-render",
    ],
  );
  assert.ok(metrics.every((metric) => metric.recordedAt > 0));
  assert.ok(metrics[0].durationMs >= 0);

  console.log(
    JSON.stringify(
      {
        diagnostic: "local-runtime-efficiency",
        instrumented: [
          "startup.local-data",
          "conversation.persist",
          "inference.reply",
          "inference.memory-candidate",
          "settings.update",
          "chat.render",
          "conversation.stream-render",
        ],
        streamPaintIntervalMs: 50,
        sampleMetrics: metrics.map(({ name, durationMs, count, details }) => ({
          name,
          durationMs,
          count,
          details,
        })),
        note:
          "Development builds log real timings; this check validates the metric contract and bounded stream update policy.",
      },
      null,
      2,
    ),
  );
}

const { pathToFileURL } = require("node:url");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});