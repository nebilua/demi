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
  ): Promise<SpeakResult>;
  stopAsync(): Promise<void>;
}

export default requireNativeModule<SecondBrainOfflineTtsModule>(
  'SecondBrainOfflineTts',
);