import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useApp, useChat } from "@/context/AppContext";
import { isCapabilityActive } from "@/lib/privacyCapabilities";
import {
  buildResearchPrompt,
  createResearchDocument,
  fetchApprovedWebSource,
  MAX_RESEARCH_DOCUMENTS,
  MAX_RESEARCH_LIBRARY_CHARS,
  retrieveResearchPassages,
  validateResearchUrl,
  webSourceToPassage,
  type ResearchDocument,
  type RetrievedPassage,
} from "@/lib/research";
import { readSecureRecord, writeSecureRecord } from "@/lib/secureLocalStorage";

const RESEARCH_LIBRARY_KEY = "research-library";

type ResearchMode = "local" | "web";
type ResearchContextValue = {
  documents: ResearchDocument[];
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  pickDocuments: () => Promise<void>;
  archiveDocument: (id: string, archived: boolean) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  runResearch: (query: string, mode: ResearchMode, webUrl?: string) => Promise<void>;
  cancelResearch: () => void;
  clearResult: () => void;
  answer: string | null;
  passages: RetrievedPassage[];
  busy: boolean;
  error: string | null;
  routeLabel: string | null;
  storageReady: boolean;
  reloadStoredData: () => Promise<void>;
};

const ResearchContext = createContext<ResearchContextValue | null>(null);

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseLibrary(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as ResearchDocument[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (document) =>
        document &&
        typeof document.id === "string" &&
        typeof document.name === "string" &&
        Array.isArray(document.chunks),
    );
  } catch {
    return [];
  }
}

export function ResearchProvider({ children }: { children: React.ReactNode }) {
  const {
    privacyReady,
    privacyState,
    engineStatus,
    runCloudFallback,
    recordPrivacyAction,
    recordAgentTrace,
  } = useApp();
  const { runLocalInference } = useChat();
  const [documents, setDocuments] = useState<ResearchDocument[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [passages, setPassages] = useState<RetrievedPassage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routeLabel, setRouteLabel] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const operationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void readSecureRecord(RESEARCH_LIBRARY_KEY)
      .then((value) => {
        if (active) setDocuments(parseLibrary(value));
      })
      .catch(() => {
        if (active) setError("The encrypted research library could not be opened.");
      })
      .finally(() => {
        if (active) setStorageReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function persist(next: ResearchDocument[]) {
    await writeSecureRecord(RESEARCH_LIBRARY_KEY, JSON.stringify(next));
    setDocuments(next);
  }

  async function reloadStoredData() {
    const value = await readSecureRecord(RESEARCH_LIBRARY_KEY);
    setDocuments(parseLibrary(value));
    setError(null);
  }

  async function pickDocuments() {
    if (!privacyReady || !isCapabilityActive(privacyState, "local.files")) {
      setError("Selected file access is paused or revoked in Settings.");
      return;
    }
    if (documents.length >= MAX_RESEARCH_DOCUMENTS) {
      setError(`Keep the private library to ${MAX_RESEARCH_DOCUMENTS} documents or fewer.`);
      return;
    }
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/plain", "text/markdown", "text/csv", "application/json"],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      const imported: ResearchDocument[] = [];
      let libraryChars = documents.reduce(
        (total, document) =>
          total + document.chunks.reduce((size, chunk) => size + chunk.text.length, 0),
        0,
      );
      for (const asset of result.assets.slice(0, MAX_RESEARCH_DOCUMENTS - documents.length)) {
        const size = asset.size ?? 0;
        if (size > 120_000) {
          throw new Error("This file is too large for private indexing. Choose a file under 120 KB.");
        }
        if (Platform.OS !== "web") {
          try {
            const freeBytes = await FileSystem.getFreeDiskStorageAsync();
            const requiredBytes = Math.max(size * 2, 2 * 1024 * 1024);
            if (freeBytes < requiredBytes) {
              throw new Error("There is not enough free device storage to safely index this file.");
            }
          } catch (caught) {
            if (caught instanceof Error && caught.message.includes("not enough free")) throw caught;
            // Some preview/native runtimes do not expose a storage measurement.
          }
        }
        const content = await FileSystem.readAsStringAsync(asset.uri);
        const document = createResearchDocument({
          id: createId(),
          name: asset.name,
          mimeType: asset.mimeType ?? "text/plain",
          sizeBytes: size || content.length,
          importedAt: Date.now(),
          text: content,
        });
        const documentChars = document.chunks.reduce((total, chunk) => total + chunk.text.length, 0);
        if (libraryChars + documentChars > MAX_RESEARCH_LIBRARY_CHARS) {
          throw new Error("The private research library is full. Archive or delete a file before adding another.");
        }
        libraryChars += documentChars;
        imported.push(document);
      }
      if (!imported.length) return;
      const next = [...documents, ...imported];
      await persist(next);
      setSelectedIds((current) => [...current, ...imported.map((document) => document.id)]);
      await recordPrivacyAction({
        capabilityId: "local.files",
        action: "research-documents-imported",
        status: "completed",
        summary: `Indexed ${imported.length} selected document${imported.length === 1 ? "" : "s"} locally; content stayed encrypted on this device.`,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The selected files could not be indexed locally.");
      await recordAgentTrace({
        capabilityId: "local.files",
        phase: "tool-call",
        status: "failed",
        summary: "Research document indexing failed; document content omitted.",
      }).catch(() => undefined);
    }
  }

  async function updateDocument(id: string, update: (document: ResearchDocument) => ResearchDocument) {
    const next = documents.map((document) => (document.id === id ? update(document) : document));
    await persist(next);
  }

  async function archiveDocument(id: string, archived: boolean) {
    await updateDocument(id, (document) => ({
      ...document,
      archivedAt: archived ? Date.now() : null,
    }));
    if (archived) setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
  }

  async function deleteDocument(id: string) {
    await persist(documents.filter((document) => document.id !== id));
    setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
    setPassages((current) => current.filter((passage) => passage.documentId !== id));
  }

  async function runResearch(query: string, mode: ResearchMode, webUrl?: string) {
    const normalizedQuery = query.trim().slice(0, 500);
    if (!normalizedQuery) {
      setError("Ask a research question first.");
      return;
    }
    if (!privacyReady || !isCapabilityActive(privacyState, "local.inference")) {
      setError("Local model inference is paused or revoked in Settings.");
      return;
    }
    const operation = ++operationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setAnswer(null);
    setPassages([]);
    try {
      const selected = documents.filter(
        (document) => selectedIds.includes(document.id) && !document.archivedAt,
      );
      let evidence = retrieveResearchPassages(selected, normalizedQuery);
      if (mode === "web") {
        if (!privacyReady || !isCapabilityActive(privacyState, "network.web-research")) {
          throw new Error("Web research is off. Enable it in Settings before approving a request.");
        }
        const validation = validateResearchUrl(webUrl ?? "");
        if (!validation.ok) throw new Error(validation.error);
        await recordPrivacyAction({
          capabilityId: "network.web-research",
          action: "web-research-request",
          status: "allowed",
          summary: `User approved one HTTPS source for web research: ${validation.url}`,
        });
        const source = await fetchApprovedWebSource(validation.url!, controller.signal);
        evidence = [webSourceToPassage(source), ...evidence].slice(0, 6);
        setRouteLabel("Web source fetched with consent · interpretation ran on the on-device model");
      } else {
        setRouteLabel("No network · interpretation ran on the on-device model");
      }
      setPassages(evidence);
       let usedCloudFallback = false;
       let result: string;
       try {
         result = await runLocalInference(buildResearchPrompt(normalizedQuery, evidence, mode), (token) => {
           if (operation === operationRef.current) setAnswer((current) => `${current ?? ""}${token}`);
         });
       } catch (localError) {
         if (
           engineStatus === "ready" &&
           !(localError instanceof Error && /out of memory|allocation|failed to (create context|load model)|native offline engine|browser preview/i.test(localError.message))
         ) {
           throw localError;
         }
         usedCloudFallback = true;
         result = await runCloudFallback(
           "research",
           engineStatus === "ready" ? "local-runtime-failure" : "local-engine-unavailable",
           normalizedQuery,
           controller.signal,
         );
         setRouteLabel("Cloud fallback · only the redacted research question was sent; local evidence stayed on this device");
       }
      if (operation !== operationRef.current) return;
      setAnswer(result);
      await recordPrivacyAction({
         capabilityId: usedCloudFallback
           ? "network.remote-inference"
           : mode === "web"
             ? "network.web-research"
             : "local.files",
         action: usedCloudFallback
           ? "cloud-research-completed"
           : mode === "web"
             ? "web-research-completed"
             : "local-research-completed",
        status: "completed",
         summary: usedCloudFallback
           ? "Cloud research completed from the bounded question; local evidence and raw source content stayed on this device."
           : mode === "web"
             ? "Web research completed; raw web content was not saved."
             : "Local research completed from selected encrypted documents.",
      });
    } catch (caught) {
      if (controller.signal.aborted) {
        setError("Research cancelled before the result was completed.");
        return;
      }
      setError(caught instanceof Error ? caught.message : "Research could not be completed.");
      await recordPrivacyAction({
        capabilityId: mode === "web" ? "network.web-research" : "local.files",
        action: mode === "web" ? "web-research-failed" : "local-research-failed",
        status: "failed",
        summary: "Research failed; source contents omitted.",
      }).catch(() => undefined);
    } finally {
      if (operation === operationRef.current) {
        setBusy(false);
        abortRef.current = null;
      }
    }
  }

  function cancelResearch() {
    operationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setError("Research cancelled. No result was saved.");
  }

  const value = useMemo(
    () => ({
      documents,
      selectedIds,
      setSelectedIds,
      pickDocuments,
      archiveDocument,
      deleteDocument,
      runResearch,
      cancelResearch,
      clearResult: () => {
        setAnswer(null);
        setPassages([]);
        setRouteLabel(null);
        setError(null);
      },
      answer,
      passages,
      busy,
      error,
      routeLabel,
      storageReady,
      reloadStoredData,
    }),
    [documents, selectedIds, answer, passages, busy, error, routeLabel, storageReady, privacyReady, privacyState],
  );

  return <ResearchContext.Provider value={value}>{children}</ResearchContext.Provider>;
}

export function useResearch() {
  const context = useContext(ResearchContext);
  if (!context) throw new Error("useResearch must be used inside ResearchProvider");
  return context;
}