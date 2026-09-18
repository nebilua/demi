import { Platform } from "react-native";
import type {
  ExpoSpeechRecognitionErrorCode,
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";
import type { OfflineVoice } from "../modules/offline-tts";

export type { OfflineVoice };

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
  | "offline-language-missing"
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

export type RecognitionModule =
  typeof import("expo-speech-recognition").ExpoSpeechRecognitionModule;
export type OfflineTtsModule = typeof import("../modules/offline-tts").default;

let recognitionModule: RecognitionModule | null | undefined;
let offlineTtsModule: OfflineTtsModule | null | undefined;

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

export function getRecognitionModule(): RecognitionModule | null {
  if (recognitionModule !== undefined) return recognitionModule;
  if (Platform.OS === "web") {
    recognitionModule = null;
    return recognitionModule;
  }

  try {
    recognitionModule = (
      require("expo-speech-recognition") as typeof import("expo-speech-recognition")
    ).ExpoSpeechRecognitionModule;
  } catch {
    recognitionModule = null;
  }

  return recognitionModule;
}

export function voiceErrorMessage(
  error: Pick<ExpoSpeechRecognitionErrorEvent, "error" | "message">,
) {
  const messages: Partial<Record<ExpoSpeechRecognitionErrorCode, string>> = {
    aborted: "",
    "audio-capture":
      "The microphone could not start. Close other recording apps and try again.",
    interrupted: "Listening was interrupted. Tap the microphone to try again.",
    "language-not-supported":
      "The English offline language pack is not installed on this device.",
    network:
      "Offline recognition data is missing. Install the local language pack in Settings.",
    "no-speech": "No speech was detected. Tap the microphone and try again.",
    "not-allowed":
      "Microphone access is off. Enable it in Android Settings to use voice input.",
    "service-not-allowed":
      "On-device speech recognition is unavailable. Install the offline language pack in Settings.",
    busy: "The local speech recognizer is busy. Wait a moment and try again.",
    client: "The local speech recognizer stopped unexpectedly. Try again.",
    "speech-timeout": "No speech was heard before listening timed out.",
    unknown: "Voice input could not finish on this device.",
  };

  return (
    messages[error.error] ?? error.message ?? "Voice input could not finish."
  );
}

export function voiceSelfTestDiagnosis(
  error: Pick<ExpoSpeechRecognitionErrorEvent, "error" | "message">,
): Omit<VoiceSelfTestResult, "kind" | "transcript"> {
  switch (error.error) {
    case "aborted":
      return {
        outcome: "cancelled",
        title: "Microphone test cancelled",
        detail: "The on-device recognizer stopped before it returned a result.",
        nextAction:
          "Run the test again and speak a short phrase when prompted.",
      };
    case "not-allowed":
      return {
        outcome: "permission-denied",
        title: "Microphone permission is off",
        detail: "Android did not grant this app access to the microphone.",
        nextAction:
          "Allow microphone access in Android Settings, then run the test again.",
      };
    case "language-not-supported":
    case "network":
      return {
        outcome: "offline-language-missing",
        title: "Offline language data is missing",
        detail:
          "Android could not use the selected language for on-device recognition.",
        nextAction:
          "Install the selected offline language pack above, then run the test again.",
      };
    case "service-not-allowed":
      return {
        outcome: "recognizer-unavailable",
        title: "On-device recognizer is unavailable",
        detail:
          "Android does not have a recognizer that can run this test locally.",
        nextAction:
          "Install or enable an on-device speech recognition service, then run the test again.",
      };
    case "no-speech":
    case "speech-timeout":
      return {
        outcome: "error",
        title: "No speech was detected",
        detail:
          "The microphone opened, but the recognizer did not hear a phrase.",
        nextAction:
          "Tap the test again and speak close to the device microphone.",
      };
    default:
      return {
        outcome: "error",
        title: "Microphone test could not finish",
        detail: error.message || voiceErrorMessage(error),
        nextAction: "Close other recording apps and run the test again.",
      };
  }
}

export async function canSpeakLocally() {
  const voices = await getOfflineVoices();
  return voices.length > 0;
}

export async function getOfflineVoices(): Promise<OfflineVoice[]> {
  const module = getOfflineTtsModule();
  if (!module) return [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await module.getOfflineVoicesAsync();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return [];
}

export async function stopLocalSpeech() {
  const module = getOfflineTtsModule();
  if (module) await module.stopAsync();
}

export async function openLocalVoiceSettings() {
  const module = getOfflineTtsModule();
  if (!module) {
    throw new Error("The Android text-to-speech module is not available.");
  }
  await module.openTtsSettingsAsync();
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
  const module = getOfflineTtsModule();
  if (!module) {
    options.onError(
      "Private spoken replies require the installed Android build.",
    );
    return;
  }

  options.onStart();
  try {
    const result = await module.speakAsync(
      text.slice(0, 3800),
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
        : "No verified offline voice is installed.",
    );
  }
}

export type { ExpoSpeechRecognitionResultEvent };

function getOfflineTtsModule(): OfflineTtsModule | null {
  if (offlineTtsModule !== undefined) return offlineTtsModule;
  if (Platform.OS !== "android") {
    offlineTtsModule = null;
    return offlineTtsModule;
  }

  try {
    offlineTtsModule = (
      require("../modules/offline-tts") as {
        default: OfflineTtsModule;
      }
    ).default;
  } catch {
    offlineTtsModule = null;
  }

  return offlineTtsModule;
}
