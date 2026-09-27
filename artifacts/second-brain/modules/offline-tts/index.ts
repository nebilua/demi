import { NativeModule, requireNativeModule } from 'expo';

export type OfflineVoice = {
  id: string;
  name: string;
  language: string;
};

export type SpeakResult = {
  status: 'completed' | 'stopped';
  voiceId: string;
};

export type VoiceReadiness = {
  ready: boolean;
  inputAvailable: boolean;
  outputAvailable: boolean;
  language: string;
  error: string | null;
};

export type RecognitionResultEvent = {
  sessionId: number;
  transcript: string;
  isFinal: boolean;
};

export type RecognitionStatusEvent = {
  sessionId: number;
  status: 'listening' | 'processing' | 'completed' | 'cancelled' | 'error';
  message?: string;
};

type SecondBrainOfflineTtsEventMap = {
  recognitionResult: (event: RecognitionResultEvent) => void;
  recognitionStatus: (event: RecognitionStatusEvent) => void;
};

declare class SecondBrainOfflineTtsModule extends NativeModule<SecondBrainOfflineTtsEventMap> {
  getVoiceStatusAsync(): Promise<VoiceReadiness>;
  prepareVoiceModelsAsync(): Promise<VoiceReadiness>;
  getOfflineVoicesAsync(): Promise<OfflineVoice[]>;
  startRecognitionAsync(sessionId: number): Promise<void>;
  stopRecognitionAsync(sessionId: number): Promise<void>;
  cancelRecognitionAsync(sessionId: number): Promise<void>;
  speakAsync(
    text: string,
    language: string,
    rate: number,
    preferredVoiceId?: string | null,
  ): Promise<SpeakResult>;
  stopSpeechAsync(): Promise<void>;
}

export default requireNativeModule<SecondBrainOfflineTtsModule>(
  'SecondBrainOfflineTts',
);