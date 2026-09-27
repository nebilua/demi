import { Platform } from "react-native";
import type {
  OfflineVoice,
  RecognitionResultEvent,
  RecognitionStatusEvent,
  VoiceReadiness,
} from "../modules/offline-tts";

export type {
  OfflineVoice,
  RecognitionResultEvent,
  RecognitionStatusEvent,
  VoiceReadiness,
};

export type VoiceInputStatus =
  | "unavailable"
  | "checking"
  | "needs-model"
  | "idle"
  | "listening"
  | "processing"
  | "error";

export type VoiceSelfTestOutcome =
  | "running"
  | "passed"
  | "permission-denied"
  | "recognizer-unavailable"
  | "cancelled"
  | "error";

export type VoiceSelfTestResult = {
  kind: "recognition" | "tts";
  outcome: VoiceSelfTestOutcome;
  title: string;
  detail: string;
  nextAction: string;
  transcript?: string;
};

export type OfflineVoiceModule = typeof import("../modules/offline-tts").default;

let voiceModule: OfflineVoiceModule | null | undefined;

export function getVoiceModule(): OfflineVoiceModule | null {
  if (voiceModule !== undefined) return voiceModule;
  if (Platform.OS !== "android") {
    voiceModule = null;
    return voiceModule;
  }

  try {
    voiceModule = (
      require("../modules/offline-tts") as {
        default: OfflineVoiceModule;
      }
    ).default;
  } catch {
    voiceModule = null;
  }
  return voiceModule;
}

export function voiceMatchesLanguage(
  voiceLanguage: string,
  targetLanguage: string,
) {
  const voiceLocale = voiceLanguage.toLowerCase().replace(/_/g, "-");
  const targetLocale = targetLanguage.toLowerCase().replace(/_/g, "-");
  return (
    voiceLocale === targetLocale ||
    voiceLocale.split("-")[0] === targetLocale.split("-")[0]
  );
}

export async function getVoiceReadiness(): Promise<VoiceReadiness> {
  const module = getVoiceModule();
  if (!module) {
    return {
      ready: false,
      inputAvailable: false,
      outputAvailable: false,
      language: "en-US",
      error: "Bundled offline speech is available in the installed Android app.",
    };
  }
  return module.getVoiceStatusAsync();
}

export async function prepareVoiceModels(): Promise<VoiceReadiness> {
  const module = getVoiceModule();
  if (!module) {
    throw new Error(
      "Bundled offline speech is available in the installed Android app.",
    );
  }
  return module.prepareVoiceModelsAsync();
}

export async function getOfflineVoices(): Promise<OfflineVoice[]> {
  const module = getVoiceModule();
  if (!module) return [];
  return module.getOfflineVoicesAsync();
}

export async function startLocalRecognition(sessionId: number) {
  const module = getVoiceModule();
  if (!module) {
    throw new Error(
      "Offline listening needs the installed Android build. It is not included in Expo Go or the browser preview.",
    );
  }
  await module.startRecognitionAsync(sessionId);
}

export async function stopLocalRecognition(sessionId: number) {
  await getVoiceModule()?.stopRecognitionAsync(sessionId);
}

export async function cancelLocalRecognition(sessionId: number) {
  await getVoiceModule()?.cancelRecognitionAsync(sessionId);
}

export async function stopLocalSpeech() {
  await getVoiceModule()?.stopSpeechAsync();
}

export async function speakLocally(
  text: string,
  options: {
    language: string;
    rate: number;
    preferredVoiceId?: string | null;
    onStart: () => void;
    onDone: () => void;
    onStopped: () => void;
    onError: (message: string) => void;
  },
) {
  const module = getVoiceModule();
  if (!module) {
    options.onError(
      "Private spoken replies require the installed Android build.",
    );
    return;
  }

  options.onStart();
  try {
    const result = await module.speakAsync(
      text.slice(0, 3_800),
      options.language,
      options.rate,
      options.preferredVoiceId ?? null,
    );
    if (result.status === "stopped") options.onStopped();
    else options.onDone();
  } catch (error) {
    options.onError(
      error instanceof Error
        ? error.message
        : "The bundled offline voice could not speak this response.",
    );
  }
}

export function voiceErrorMessage(message?: string) {
  return message || "Bundled offline speech could not finish.";
}

export function voiceSelfTestDiagnosis(message?: string) {
  const detail = voiceErrorMessage(message);
  return {
    outcome: "error" as const,
    title: "Microphone test could not finish",
    detail,
    nextAction: "Close other recording apps and run the test again.",
  };
}