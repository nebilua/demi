import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { getSecureRecordStorageBytes } from './secureLocalStorage';

export type StorageMetricStatus =
  | 'measured'
  | 'estimated'
  | 'partial'
  | 'unavailable';

export type StorageMetric = {
  bytes: number | null;
  status: StorageMetricStatus;
};

export type LocalStorageUsage = {
  measuredAt: number | null;
  total: StorageMetric;
  activeModel: StorageMetric;
  reclaimableModels: StorageMetric & { fileCount: number };
  conversations: StorageMetric;
  memories: StorageMetric;
  privacyState: StorageMetric;
  settingsAndProfile: StorageMetric;
  appFiles: StorageMetric;
  temporaryFiles: StorageMetric;
  freeDevice: StorageMetric;
};

type DirectoryScan = {
  bytes: number;
  files: number;
  complete: boolean;
};

export type LocalStorageUsageKeys = {
  settings: string;
  model: string;
  conversation: string;
  profile: string;
  memories: string;
  privacyState: string;
};

const unavailableMetric = (): StorageMetric => ({
  bytes: null,
  status: 'unavailable',
});

export function createUnavailableLocalStorageUsage(): LocalStorageUsage {
  return {
    measuredAt: null,
    total: unavailableMetric(),
    activeModel: unavailableMetric(),
    reclaimableModels: { ...unavailableMetric(), fileCount: 0 },
    conversations: unavailableMetric(),
    memories: unavailableMetric(),
    privacyState: unavailableMetric(),
    settingsAndProfile: unavailableMetric(),
    appFiles: unavailableMetric(),
    temporaryFiles: unavailableMetric(),
    freeDevice: unavailableMetric(),
  };
}

function estimatedMetric(bytes: number): StorageMetric {
  return { bytes, status: 'estimated' };
}

function measuredMetric(bytes: number): StorageMetric {
  return { bytes, status: 'measured' };
}

function mergeMetrics(...metrics: StorageMetric[]): StorageMetric {
  if (metrics.some((metric) => metric.bytes === null)) {
    return unavailableMetric();
  }
  return {
    bytes: metrics.reduce((total, metric) => total + (metric.bytes ?? 0), 0),
    status: metrics.some((metric) => metric.status === 'estimated')
      ? 'estimated'
      : 'measured',
  };
}

async function scanDirectory(
  uri: string,
  excludedDirectoryUri?: string,
): Promise<DirectoryScan> {
  let entries: string[];
  try {
    entries = await FileSystem.readDirectoryAsync(uri);
  } catch {
    return { bytes: 0, files: 0, complete: false };
  }

  let bytes = 0;
  let files = 0;
  let complete = true;
  for (const entry of entries) {
    const childUri = `${uri.replace(/\/$/, '')}/${entry}`;
    if (
      excludedDirectoryUri &&
      childUri.replace(/\/$/, '') === excludedDirectoryUri.replace(/\/$/, '')
    ) {
      continue;
    }
    try {
      const info = await FileSystem.getInfoAsync(childUri);
      if (!info.exists) {
        complete = false;
      } else if (info.isDirectory) {
        const nested = await scanDirectory(childUri, excludedDirectoryUri);
        bytes += nested.bytes;
        files += nested.files;
        complete = complete && nested.complete;
      } else if (typeof info.size === 'number') {
        bytes += info.size;
        files += 1;
      } else {
        complete = false;
      }
    } catch {
      complete = false;
    }
  }
  return { bytes, files, complete };
}

async function measureDirectory(
  uri: string | null | undefined,
  excludedDirectoryUri?: string,
): Promise<StorageMetric> {
  if (Platform.OS === 'web' || !uri) return unavailableMetric();
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return measuredMetric(0);
    if (!info.isDirectory) return unavailableMetric();
    const scan = await scanDirectory(uri, excludedDirectoryUri);
    return scan.complete ? measuredMetric(scan.bytes) : unavailableMetric();
  } catch {
    return unavailableMetric();
  }
}

async function measureModelFiles(
  activeModelUri: string | null,
): Promise<{
  activeModel: StorageMetric;
  reclaimableModels: StorageMetric & { fileCount: number };
}> {
  const emptyReclaimable = { ...measuredMetric(0), fileCount: 0 };
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) {
    return {
      activeModel: unavailableMetric(),
      reclaimableModels: { ...unavailableMetric(), fileCount: 0 },
    };
  }

  const modelsDirectory = `${FileSystem.documentDirectory}models`;
  try {
    const directoryInfo = await FileSystem.getInfoAsync(modelsDirectory);
    if (!directoryInfo.exists) {
      return {
        activeModel: activeModelUri ? unavailableMetric() : measuredMetric(0),
        reclaimableModels: emptyReclaimable,
      };
    }
    if (!directoryInfo.isDirectory) {
      return {
        activeModel: unavailableMetric(),
        reclaimableModels: { ...unavailableMetric(), fileCount: 0 },
      };
    }

    const entries = await FileSystem.readDirectoryAsync(modelsDirectory);
    let activeBytes = 0;
    let activeFound = !activeModelUri;
    let reclaimableBytes = 0;
    let reclaimableFiles = 0;
    let complete = true;
    const normalizedActiveUri = activeModelUri?.replace(/\/$/, '');

    for (const entry of entries) {
      const candidateUri = `${modelsDirectory}/${entry}`;
      try {
        const info = await FileSystem.getInfoAsync(candidateUri);
        if (!info.exists) {
          complete = false;
        } else if (info.isDirectory) {
          const nested = await scanDirectory(candidateUri);
          reclaimableBytes += nested.bytes;
          reclaimableFiles += nested.files;
          complete = complete && nested.complete;
        } else if (typeof info.size === 'number') {
          if (candidateUri.replace(/\/$/, '') === normalizedActiveUri) {
            activeBytes += info.size;
            activeFound = true;
          } else {
            reclaimableBytes += info.size;
            reclaimableFiles += 1;
          }
        } else {
          complete = false;
        }
      } catch {
        complete = false;
      }
    }

    return {
      activeModel:
        complete && activeFound ? measuredMetric(activeBytes) : unavailableMetric(),
      reclaimableModels: {
        ...(complete ? measuredMetric(reclaimableBytes) : unavailableMetric()),
        fileCount: complete ? reclaimableFiles : 0,
      },
    };
  } catch {
    return {
      activeModel: unavailableMetric(),
      reclaimableModels: { ...unavailableMetric(), fileCount: 0 },
    };
  }
}

async function measureAsyncStorageValue(key: string): Promise<StorageMetric> {
  try {
    const value = await AsyncStorage.getItem(key);
    return estimatedMetric(value ? value.length : 0);
  } catch {
    return unavailableMetric();
  }
}

async function measureSecureStorageValue(key: string): Promise<StorageMetric> {
  try {
    const bytes = await getSecureRecordStorageBytes(key);
    return bytes === null ? unavailableMetric() : estimatedMetric(bytes);
  } catch {
    return unavailableMetric();
  }
}

async function measureSafely<T>(
  operation: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await operation();
  } catch {
    return fallback;
  }
}

export async function measureLocalStorageUsage(
  activeModelUri: string | null,
  keys: LocalStorageUsageKeys,
): Promise<LocalStorageUsage> {
  const [
    modelFiles,
    appFiles,
    temporaryFiles,
    freeDevice,
    settings,
    model,
    conversations,
    profile,
    memories,
    privacyState,
  ] = await Promise.all([
    measureSafely(
      () => measureModelFiles(activeModelUri),
      {
        activeModel: unavailableMetric(),
        reclaimableModels: { ...unavailableMetric(), fileCount: 0 },
      },
    ),
    measureSafely(
      () =>
        measureDirectory(
          FileSystem.documentDirectory,
          FileSystem.documentDirectory
            ? `${FileSystem.documentDirectory}models`
            : undefined,
        ),
      unavailableMetric(),
    ),
    measureSafely(
      () => measureDirectory(FileSystem.cacheDirectory),
      unavailableMetric(),
    ),
    measureSafely(
      async () =>
        Platform.OS === 'web'
          ? unavailableMetric()
          : measuredMetric(await FileSystem.getFreeDiskStorageAsync()),
      unavailableMetric(),
    ),
    measureSafely(() => measureAsyncStorageValue(keys.settings), unavailableMetric()),
    measureSafely(() => measureAsyncStorageValue(keys.model), unavailableMetric()),
    measureSafely(
      () => measureSecureStorageValue(keys.conversation),
      unavailableMetric(),
    ),
    measureSafely(
      () => measureSecureStorageValue(keys.profile),
      unavailableMetric(),
    ),
    measureSafely(
      () => measureSecureStorageValue(keys.memories),
      unavailableMetric(),
    ),
    measureSafely(
      () => measureSecureStorageValue(keys.privacyState),
      unavailableMetric(),
    ),
  ]);

  const settingsAndProfile = mergeMetrics(settings, model, profile);
  const trackedMetrics = [
    modelFiles.activeModel,
    modelFiles.reclaimableModels,
    conversations,
    memories,
    privacyState,
    settingsAndProfile,
    appFiles,
    temporaryFiles,
  ];
  const totalBytes = trackedMetrics.every((metric) => metric.bytes !== null)
    ? trackedMetrics.reduce((total, metric) => total + (metric.bytes ?? 0), 0)
    : null;
  const totalStatus: StorageMetricStatus =
    totalBytes === null
      ? trackedMetrics.some((metric) => metric.bytes !== null)
        ? 'partial'
        : 'unavailable'
      : trackedMetrics.some((metric) => metric.status === 'estimated')
        ? 'estimated'
        : 'measured';

  return {
    measuredAt: Date.now(),
    total: { bytes: totalBytes, status: totalStatus },
    activeModel: modelFiles.activeModel,
    reclaimableModels: modelFiles.reclaimableModels,
    conversations,
    memories,
    privacyState,
    settingsAndProfile,
    appFiles,
    temporaryFiles,
    freeDevice,
  };
}