const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  const transfer = await import(
    pathToFileURL(path.resolve(__dirname, "../lib/localDataTransfer.ts")).href
  );
  const { sha256 } = await import("js-sha256");

  const reminder = {
    id: "date-1",
    label: "Launch",
    eventName: "Project launch",
    date: "2027-01-15",
    time: "09:30",
    notes: "Prepare the announcement.",
    repeatsAnnually: false,
    remindMinutesBefore: 60,
    notificationState: "pending",
    notificationError: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  };
  const records = {
    conversations: [
      { id: "turn-1", role: "user", content: "Hello", createdAt: 1 },
      { id: "turn-2", role: "assistant", content: "Hi", createdAt: 2 },
    ],
    memories: [],
    profile: {
      displayName: "Alex",
      context: "Prefers concise answers.",
      onboardingCompleted: true,
    },
    importantDates: [reminder],
    research: [],
    scheduledJobs: [],
  };

  const exported = transfer.createLocalDataExport(records, 123);
  const text = JSON.stringify(exported);
  const parsed = transfer.parseLocalDataExport(text);
  assert.equal(parsed.version, 1);
  assert.deepEqual(
    transfer.summarizeLocalDataExport(parsed).importantDates,
    1,
  );
  assert.deepEqual(
    parsed.excluded,
    transfer.LOCAL_DATA_EXCLUDED_CATEGORIES,
  );
  assert.equal(parsed.records.importantDates[0].notificationId, undefined);

  const tampered = JSON.parse(text);
  tampered.records.profile.displayName = "Changed";
  assert.throws(
    () => transfer.parseLocalDataExport(JSON.stringify(tampered)),
    /integrity/,
  );

  const duplicate = JSON.parse(text);
  duplicate.records.conversations = [
    records.conversations[0],
    records.conversations[0],
  ];
  const { integrity: duplicateIntegrity, ...duplicateWithoutIntegrity } =
    duplicate;
  duplicate.integrity = {
    ...duplicateIntegrity,
    digest: sha256(JSON.stringify(duplicateWithoutIntegrity)),
  };
  assert.throws(
    () => transfer.parseLocalDataExport(JSON.stringify(duplicate)),
    /unsupported or incomplete schema/,
  );

  const partial = JSON.parse(text);
  delete partial.records.research;
  assert.throws(
    () => transfer.parseLocalDataExport(JSON.stringify(partial)),
    /unsupported or incomplete schema/,
  );

  assert.throws(
    () =>
      transfer.parseLocalDataExport(
        "x".repeat(transfer.MAX_LOCAL_DATA_EXPORT_BYTES + 1),
      ),
    /too large/,
  );

  const invalidDate = JSON.parse(text);
  invalidDate.records.importantDates[0].date = "2027-02-31";
  const { integrity: invalidDateIntegrity, ...invalidDateWithoutIntegrity } =
    invalidDate;
  invalidDate.integrity = {
    ...invalidDateIntegrity,
    digest: sha256(JSON.stringify(invalidDateWithoutIntegrity)),
  };
  assert.throws(
    () => transfer.parseLocalDataExport(JSON.stringify(invalidDate)),
    /unsupported or incomplete schema/,
  );

  console.log("Local data transfer checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});