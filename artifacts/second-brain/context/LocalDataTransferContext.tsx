import * as FileSystem from "expo-file-system/legacy";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import { useApp, useChat } from "@/context/AppContext";
import { useCalendar } from "@/context/CalendarContext";
import { useResearch } from "@/context/ResearchContext";
import { useScheduledJobs } from "@/context/ScheduledJobsContext";
import {
  createLocalDataExport,
  parseLocalDataExport,
  summarizeLocalDataExport,
  toStoredReminder,
  toStoredScheduledJob,
  type LocalDataExport,
  type LocalDataExportRecords,
  type LocalDataImportSummary,
} from "@/lib/localDataTransfer";
import {
  removeSecureRecord,
  readSecureRecord,
  writeSecureRecord,
} from "@/lib/secureLocalStorage";

const RECORD_KEYS = {
  conversations: "conversation",
  memories: "approved-memories",
  profile: "profile",
  importantDates: "date-reminders",
  research: "research-library",
  scheduledJobs: "scheduled-jobs",
} as const;
const JOURNAL_KEY = "local-data-import-journal";

export type LocalDataTransferStatus =
  | "idle"
  | "exporting"
  | "awaiting-confirmation"
  | "importing"
  | "success"
  | "cancelled"
  | "error";

type LocalDataTransferValue = {
  status: LocalDataTransferStatus;
  message: string | null;
  importSummary: LocalDataImportSummary | null;
  exportLocalData: () => Promise<void>;
  chooseImportFile: () => Promise<void>;
  confirmImport: () => Promise<void>;
  cancelTransfer: () => void;
};

const LocalDataTransferContext = createContext<LocalDataTransferValue | null>(
  null,
);

function exportFileName() {
  return `demi-local-data-${new Date().toISOString().slice(0, 10)}.json`;
}

function importCancelled() {
  return new Error("LOCAL_DATA_IMPORT_CANCELLED");
}

export function LocalDataTransferProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const app = useApp();
  const chat = useChat();
  const calendar = useCalendar();
  const research = useResearch();
  const scheduled = useScheduledJobs();
  const [status, setStatus] = useState<LocalDataTransferStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [importSummary, setImportSummary] =
    useState<LocalDataImportSummary | null>(null);
  const pendingImportRef = useRef<LocalDataExport | null>(null);
  const operationRef = useRef(0);

  useEffect(() => {
    let active = true;
    void readSecureRecord(JOURNAL_KEY)
      .then(async (raw) => {
        if (!raw) return;
        let journal: {
          version?: number;
          previous?: Record<keyof typeof RECORD_KEYS, string | null>;
        };
        try {
          journal = JSON.parse(raw) as typeof journal;
        } catch {
          throw new Error("The interrupted local import journal is unreadable.");
        }
        if (
          journal.version !== 1 ||
          !journal.previous ||
          Object.keys(RECORD_KEYS).some(
            (category) =>
              !(category in journal.previous!) ||
              (journal.previous![category as keyof typeof RECORD_KEYS] !== null &&
                typeof journal.previous![category as keyof typeof RECORD_KEYS] !== "string"),
          )
        ) {
          throw new Error("The interrupted local import journal is invalid.");
        }
        await restoreRawRecords(journal.previous);
        await removeSecureRecord(JOURNAL_KEY);
        await refreshContexts();
        if (active) {
          setStatus("success");
          setMessage("An interrupted local import was safely rolled back.");
        }
      })
      .catch((error) => {
        if (active) {
          setStatus("error");
          setMessage(
            error instanceof Error
              ? error.message
              : "An interrupted local import needs recovery before another transfer.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function beginOperation() {
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    return operation;
  }

  function isCurrent(operation: number) {
    return operationRef.current === operation;
  }

  function recordsFromState(): LocalDataExportRecords {
    return {
      conversations: chat.turns,
      memories: app.memories,
      profile: app.profile,
      importantDates: calendar.reminders.map((item) => ({
        ...item,
        notificationState: "pending" as const,
        notificationError: null,
        notificationId: undefined,
        retiredNotificationIds: undefined,
      })),
      research: research.documents,
      scheduledJobs: scheduled.jobs.map((item) => ({
        ...item,
        notificationId: null,
        lastError: null,
      })),
    };
  }

  async function readRawRecords() {
    const entries = await Promise.all(
      Object.entries(RECORD_KEYS).map(async ([category, key]) => [
        category,
        await readSecureRecord(key),
      ]),
    );
    return Object.fromEntries(entries) as Record<
      keyof typeof RECORD_KEYS,
      string | null
    >;
  }

  async function writeRawRecord(
    category: keyof typeof RECORD_KEYS,
    value: string,
  ) {
    await writeSecureRecord(RECORD_KEYS[category], value);
    const verified = await readSecureRecord(RECORD_KEYS[category]);
    if (verified !== value) throw new Error("LOCAL_DATA_WRITE_VERIFICATION_FAILED");
  }

  async function writePackageRecords(
    value: LocalDataExport,
    operation: number,
  ) {
    const records = value.records;
    const rawByCategory: Record<keyof typeof RECORD_KEYS, string> = {
      conversations: JSON.stringify(records.conversations),
      memories: JSON.stringify(records.memories),
      profile: JSON.stringify(records.profile),
      importantDates: JSON.stringify(records.importantDates.map(toStoredReminder)),
      research: JSON.stringify(records.research),
      scheduledJobs: JSON.stringify(records.scheduledJobs.map(toStoredScheduledJob)),
    };
    for (const category of Object.keys(RECORD_KEYS) as Array<
      keyof typeof RECORD_KEYS
    >) {
      if (!isCurrent(operation)) throw importCancelled();
      setMessage(`Verifying ${category.replace(/([A-Z])/g, " $1").toLowerCase()}…`);
      await writeRawRecord(category, rawByCategory[category]);
    }
  }

  async function restoreRawRecords(
    previous: Record<keyof typeof RECORD_KEYS, string | null>,
  ) {
    for (const category of Object.keys(RECORD_KEYS) as Array<
      keyof typeof RECORD_KEYS
    >) {
      const value = previous[category];
      if (value === null) {
        await removeSecureRecord(RECORD_KEYS[category]);
      } else {
        await writeRawRecord(category, value);
      }
    }
  }

  async function refreshContexts() {
    await Promise.all([
      app.reloadRecoverableData(),
      calendar.reloadStoredData(),
      research.reloadStoredData(),
      scheduled.reloadStoredData(),
    ]);
  }

  async function exportLocalData() {
    const operation = beginOperation();
    setStatus("exporting");
    setMessage("Preparing a verified local-only export…");
    setImportSummary(null);
    try {
      if (
        !app.settingsReady ||
        !app.privacyReady ||
        !chat.isConversationReady ||
        !calendar.isReady ||
        !research.storageReady ||
        !scheduled.isReady
      ) {
        throw new Error("Local data is still opening. Try the export again in a moment.");
      }
      const value = createLocalDataExport(recordsFromState());
      const text = JSON.stringify(value);
      let savedText = text;
      if (Platform.OS === "android") {
        const permissions =
          await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!isCurrent(operation)) throw importCancelled();
        if (!permissions.granted) {
          setStatus("cancelled");
          setMessage("Export cancelled. No local data was uploaded or changed.");
          return;
        }
        const uri = await FileSystem.StorageAccessFramework.createFileAsync(
          permissions.directoryUri,
          exportFileName(),
          "application/json",
        );
        await FileSystem.writeAsStringAsync(uri, text);
        savedText = await FileSystem.readAsStringAsync(uri);
      } else if (Platform.OS === "web" && typeof document !== "undefined") {
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = exportFileName();
        anchor.click();
        URL.revokeObjectURL(url);
      } else {
        if (!FileSystem.documentDirectory) {
          throw new Error("This device does not expose a local export destination.");
        }
        const uri = `${FileSystem.documentDirectory}${exportFileName()}`;
        await FileSystem.writeAsStringAsync(uri, text);
        savedText = await FileSystem.readAsStringAsync(uri);
      }
      parseLocalDataExport(savedText);
      setStatus("success");
      setMessage("Local export verified. It was saved without uploading your data.");
    } catch (error) {
      if (error instanceof Error && error.message === "LOCAL_DATA_IMPORT_CANCELLED") {
        setStatus("cancelled");
        setMessage("Export cancelled. No local data was uploaded or changed.");
      } else {
        setStatus("error");
        setMessage(
          error instanceof Error
            ? `Local export failed: ${error.message}`
            : "Local export failed. Your local data was not changed.",
        );
      }
    }
  }

  async function chooseImportFile() {
    const operation = beginOperation();
    setStatus("exporting");
    setMessage("Opening the local export picker…");
    setImportSummary(null);
    try {
      const DocumentPicker = await import("expo-document-picker");
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/json",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!isCurrent(operation) || result.canceled) {
        setStatus("cancelled");
        setMessage("Import cancelled. Your current local data is unchanged.");
        return;
      }
      const asset = result.assets[0];
      if (!asset) throw new Error("No local export file was selected.");
      if (asset.size !== undefined && asset.size > 2_000_000) {
        throw new Error("This local export is too large to open safely.");
      }
      const text = await FileSystem.readAsStringAsync(asset.uri);
      const parsed = parseLocalDataExport(text);
      if (!isCurrent(operation)) throw importCancelled();
      pendingImportRef.current = parsed;
      setImportSummary(summarizeLocalDataExport(parsed, text.length));
      setStatus("awaiting-confirmation");
      setMessage("Export verified. Review the replacement summary before importing.");
    } catch (error) {
      if (error instanceof Error && error.message === "LOCAL_DATA_IMPORT_CANCELLED") {
        setStatus("cancelled");
        setMessage("Import cancelled. Your current local data is unchanged.");
      } else {
        pendingImportRef.current = null;
        setStatus("error");
        setMessage(
          error instanceof Error
            ? `Import rejected: ${error.message}`
            : "Import rejected. Your current local data is unchanged.",
        );
      }
    }
  }

  async function confirmImport() {
    const value = pendingImportRef.current;
    if (!value) return;
    const operation = beginOperation();
    setStatus("importing");
    setMessage("Saving the verified export without replacing it until each record is checked…");
    let previous: Record<keyof typeof RECORD_KEYS, string | null> | null = null;
    try {
      previous = await readRawRecords();
      await writeSecureRecord(
        JOURNAL_KEY,
        JSON.stringify({ version: 1, previous }),
      );
      await writePackageRecords(value, operation);
      if (!isCurrent(operation)) throw importCancelled();
      await removeSecureRecord(JOURNAL_KEY);
      if (!isCurrent(operation)) throw importCancelled();
      pendingImportRef.current = null;
      if (!isCurrent(operation)) throw importCancelled();
      await refreshContexts();
      setStatus("success");
      setMessage("Local import verified. The selected records now replace the previous local records.");
    } catch (error) {
      if (previous) {
        try {
          await restoreRawRecords(previous);
          await removeSecureRecord(JOURNAL_KEY);
          await refreshContexts();
        } catch {
          setStatus("error");
          setMessage(
            "Import stopped and recovery is pending. Reopen Settings before making another local-data change.",
          );
          return;
        }
      }
      pendingImportRef.current = null;
      setStatus(
        error instanceof Error && error.message === "LOCAL_DATA_IMPORT_CANCELLED"
          ? "cancelled"
          : "error",
      );
      setMessage(
        error instanceof Error && error.message === "LOCAL_DATA_IMPORT_CANCELLED"
          ? "Import cancelled. Your current local data was restored."
          : "Import failed. Your current local data was restored unchanged.",
      );
    }
  }

  function cancelTransfer() {
    operationRef.current += 1;
    pendingImportRef.current = null;
    setImportSummary(null);
    setStatus("cancelled");
    setMessage("Local data transfer cancelled. Your current data is unchanged.");
  }

  const value = {
    status,
    message,
    importSummary,
    exportLocalData,
    chooseImportFile,
    confirmImport,
    cancelTransfer,
  };

  return (
    <LocalDataTransferContext.Provider value={value}>
      {children}
    </LocalDataTransferContext.Provider>
  );
}

export function useLocalDataTransfer() {
  const context = useContext(LocalDataTransferContext);
  if (context) return context;
  return {
    status: "idle" as const,
    message: null,
    importSummary: null,
    exportLocalData: async () => undefined,
    chooseImportFile: async () => undefined,
    confirmImport: async () => undefined,
    cancelTransfer: () => undefined,
  };
}