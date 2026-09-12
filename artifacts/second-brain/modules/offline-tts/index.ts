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

declare class SecondBrainOfflineTtsModule extends NativeModule {
  getOfflineVoicesAsync(): Promise<OfflineVoice[]>;
  speakAsync(
    text: string,
    language: string,
    rate: number,
    preferredVoiceId?: string | null,
  ): Promise<SpeakResult>;
  stopAsync(): Promise<void>;
  openTtsSettingsAsync(): Promise<void>;
}

export default requireNativeModule<SecondBrainOfflineTtsModule>(
  'SecondBrainOfflineTts',
);