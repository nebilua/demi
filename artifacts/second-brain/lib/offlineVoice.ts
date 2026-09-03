import { Platform } from 'react-native';
import type {
  ExpoSpeechRecognitionErrorCode,
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';

export type VoiceInputStatus =
  | 'unavailable'
  | 'checking'
  | 'needs-model'
  | 'idle'
  | 'listening'
  | 'processing'
  | 'error';

export type RecognitionModule =
  typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule;
export type OfflineTtsModule =
  typeof import('../modules/offline-tts').default;

let recognitionModule: RecognitionModule | null | undefined;
let offlineTtsModule: OfflineTtsModule | null | undefined;

export function getRecognitionModule(): RecognitionModule | null {
  if (recognitionModule !== undefined) return recognitionModule;
  if (Platform.OS === 'web') {
    recognitionModule = null;
    return recognitionModule;
  }

  try {
    recognitionModule = (
      require('expo-speech-recognition') as typeof import('expo-speech-recognition')
    ).ExpoSpeechRecognitionModule;
  } catch {
    recognitionModule = null;
  }

  return recognitionModule;
}

export function voiceErrorMessage(
  error: Pick<ExpoSpeechRecognitionErrorEvent, 'error' | 'message'>,
) {
  const messages: Partial<Record<ExpoSpeechRecognitionErrorCode, string>> = {
    aborted: '',
    'audio-capture':
      'The microphone could not start. Close other recording apps and try again.',
    interrupted: 'Listening was interrupted. Tap the microphone to try again.',
    'language-not-supported':
      'The English offline language pack is not installed on this device.',
    network:
      'Offline recognition data is missing. Install the local language pack in Settings.',
    'no-speech': 'No speech was detected. Tap the microphone and try again.',
    'not-allowed':
      'Microphone access is off. Enable it in Android Settings to use voice input.',
    'service-not-allowed':
      'On-device speech recognition is unavailable. Install the offline language pack in Settings.',
    busy: 'The local speech recognizer is busy. Wait a moment and try again.',
    client: 'The local speech recognizer stopped unexpectedly. Try again.',
    'speech-timeout': 'No speech was heard before listening timed out.',
    unknown: 'Voice input could not finish on this device.',
  };

  return messages[error.error] ?? error.message ?? 'Voice input could not finish.';
}

export async function canSpeakLocally() {
  const module = getOfflineTtsModule();
  if (!module) return false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const voices = await module.getOfflineVoicesAsync();
      return voices.length > 0;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
}

export async function stopLocalSpeech() {
  const module = getOfflineTtsModule();
  if (module) await module.stopAsync();
}

export async function speakLocally(
  text: string,
  options: {
    language: string;
    rate: number;
    onStart: () => void;
    onDone: () => void;
    onStopped: () => void;
    onError: (message: string) => void;
  },
) {
  const module = getOfflineTtsModule();
  if (!module) {
    options.onError(
      'Private spoken replies require the installed Android build.',
    );
    return;
  }

  options.onStart();
  try {
    const result = await module.speakAsync(
      text.slice(0, 3800),
      options.language,
      options.rate,
    );
    if (result.status === 'stopped') options.onStopped();
    else options.onDone();
  } catch (error) {
    options.onError(
      error instanceof Error
        ? error.message
        : 'No verified offline voice is installed.',
    );
  }
}

export type { ExpoSpeechRecognitionResultEvent };

function getOfflineTtsModule(): OfflineTtsModule | null {
  if (offlineTtsModule !== undefined) return offlineTtsModule;
  if (Platform.OS !== 'android') {
    offlineTtsModule = null;
    return offlineTtsModule;
  }

  try {
    offlineTtsModule = (
      require('../modules/offline-tts') as {
        default: OfflineTtsModule;
      }
    ).default;
  } catch {
    offlineTtsModule = null;
  }

  return offlineTtsModule;
}