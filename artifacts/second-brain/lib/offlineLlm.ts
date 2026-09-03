import * as Device from 'expo-device';
import { Platform } from 'react-native';
import type { LlamaContext, RNLlamaOAICompatibleMessage } from 'llama.rn';

export const DEFAULT_CONTEXT_SIZE = 2048;
export const LOW_MEMORY_CONTEXT_SIZE = 1024;

const GIB = 1024 * 1024 * 1024;
const STOP_WORDS = [
  '</s>',
  '<|end|>',
  '<|eot_id|>',
  '<|end_of_text|>',
  '<|im_end|>',
  '<|EOT|>',
  '<|END_OF_TURN_TOKEN|>',
  '<|end_of_turn|>',
  '<|endoftext|>',
];

export type DeviceCompatibility = {
  deviceName: string;
  memoryBytes: number | null;
  memoryLabel: string;
  contextSize: number;
  maxRecommendedModelBytes: number;
  recommendation: string;
  nativeRuntimeAvailable: boolean;
  architectureSupported: boolean;
};

export type LocalModel = {
  id: string;
  name: string;
  uri: string;
  sizeBytes: number;
  importedAt: number;
  contextSize: number;
};

export type RuntimeDetails = {
  modelDescription: string;
  gpuEnabled: boolean;
  systemInfo: string;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export function formatBytes(bytes: number) {
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

export function getDeviceCompatibility(): DeviceCompatibility {
  const memoryBytes = Device.totalMemory;
  const architectures = Device.supportedCpuArchitectures ?? [];
  const architectureSupported =
    Platform.OS !== 'android' ||
    architectures.length === 0 ||
    architectures.some(
      (architecture) =>
        architecture.toLowerCase().includes('arm64') ||
        architecture.toLowerCase().includes('x86_64') ||
        architecture.toLowerCase().includes('x86-64'),
    );
  const contextSize =
    memoryBytes !== null && memoryBytes < 6 * GIB
      ? LOW_MEMORY_CONTEXT_SIZE
      : DEFAULT_CONTEXT_SIZE;
  const maxRecommendedModelBytes =
    memoryBytes === null
      ? 1.5 * GIB
      : Math.max(0.75 * GIB, Math.min(5.5 * GIB, memoryBytes * 0.42));

  let recommendation = 'Choose a Q4_K_M GGUF model around 1–3B parameters.';
  if (memoryBytes !== null && memoryBytes < 6 * GIB) {
    recommendation =
      'Use a Q4 GGUF model under 1.5 GB. Larger models are blocked to protect this device.';
  } else if (memoryBytes !== null && memoryBytes >= 8 * GIB) {
    recommendation =
      'A Q4 GGUF model around 3B parameters should run comfortably.';
  }

  return {
    deviceName: Device.modelName ?? 'This device',
    memoryBytes,
    memoryLabel: memoryBytes === null ? 'Memory unknown' : formatBytes(memoryBytes),
    contextSize,
    maxRecommendedModelBytes,
    recommendation,
    nativeRuntimeAvailable: Platform.OS !== 'web',
    architectureSupported,
  };
}

export function assertModelFitsDevice(
  model: LocalModel,
  compatibility: DeviceCompatibility,
) {
  if (!compatibility.architectureSupported) {
    throw new Error(
      'This Android CPU is not supported. The offline engine requires a 64-bit ARM or x86-64 device.',
    );
  }

  if (model.sizeBytes > compatibility.maxRecommendedModelBytes) {
    throw new Error(
      `${model.name} needs more memory than is safe on this device. Choose a GGUF model smaller than ${formatBytes(
        compatibility.maxRecommendedModelBytes,
      )}.`,
    );
  }
}

export async function loadNativeModel(
  model: LocalModel,
  compatibility: DeviceCompatibility,
  onProgress: (progress: number) => void,
): Promise<{ context: LlamaContext; details: RuntimeDetails }> {
  if (!compatibility.nativeRuntimeAvailable) {
    throw new Error(
      'Offline inference is available in the installed Android app, not in the browser preview.',
    );
  }

  assertModelFitsDevice(model, compatibility);

  let llama: typeof import('llama.rn');
  try {
    llama = require('llama.rn') as typeof import('llama.rn');
  } catch {
    throw new Error(
      'The native offline engine is not included in this preview build. Install the Android build and try again.',
    );
  }

  const context = await llama.initLlama(
    {
      model: model.uri,
      n_ctx: model.contextSize,
      n_batch: 256,
      n_ubatch: 128,
      n_threads: compatibility.memoryBytes !== null && compatibility.memoryBytes < 6 * GIB ? 3 : 4,
      n_gpu_layers: 0,
      use_mmap: true,
      use_mlock: false,
      no_extra_bufts: compatibility.memoryBytes !== null && compatibility.memoryBytes < 6 * GIB,
      use_progress_callback: true,
    },
    (progress) => onProgress(Math.max(0, Math.min(100, progress))),
  );

  return {
    context,
    details: {
      modelDescription: context.model.desc || model.name,
      gpuEnabled: context.gpu,
      systemInfo: context.systemInfo,
    },
  };
}

export async function streamCompletion(
  context: LlamaContext,
  messages: ChatMessage[],
  onToken: (token: string) => void,
) {
  const formattedMessages: RNLlamaOAICompatibleMessage[] = [
    {
      role: 'system',
      content:
        'You are Second Brain, a private on-device thinking partner. Be calm, concise, practical, and honest. Never claim to access the internet or cloud services.',
    },
    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  const result = await context.completion(
    {
      messages: formattedMessages,
      n_predict: 384,
      temperature: 0.7,
      top_k: 40,
      top_p: 0.9,
      min_p: 0.05,
      penalty_repeat: 1.08,
      stop: STOP_WORDS,
      enable_thinking: false,
    },
    ({ token }) => {
      if (token) onToken(token);
    },
  );

  return (result.content || result.text).trim();
}