import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const PREFIX = 'second-brain.secure.v1.';
const CHUNK_SIZE = 1800;

type Manifest = {
  version: 1;
  generation: string;
  chunks: number;
  length: number;
  writtenAt: number;
};

export type SecureStorageProtection =
  | 'encrypted-on-android'
  | 'local-preview-only';

function manifestKey(key: string) {
  return `${PREFIX}${key}.manifest`;
}

function chunkKey(key: string, generation: string, index: number) {
  return `${PREFIX}${key}.${generation}.chunk.${index}`;
}

let writeQueue: Promise<void> = Promise.resolve();

async function getRaw(key: string) {
  return Platform.OS === 'web'
    ? AsyncStorage.getItem(key)
    : SecureStore.getItemAsync(key);
}

async function setRaw(key: string, value: string) {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
}

async function removeRaw(key: string) {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

export function getSecureStorageProtection(): SecureStorageProtection {
  return Platform.OS === 'android'
    ? 'encrypted-on-android'
    : 'local-preview-only';
}

export async function readSecureRecord(key: string): Promise<string | null> {
  const rawManifest = await getRaw(manifestKey(key));
  if (!rawManifest) return null;

  let manifest: Manifest;
  try {
    manifest = JSON.parse(rawManifest) as Manifest;
  } catch {
    throw new Error('SECURE_RECORD_CORRUPT');
  }
  if (
    manifest.version !== 1 ||
    typeof manifest.generation !== 'string' ||
    !Number.isInteger(manifest.chunks) ||
    manifest.chunks < 1 ||
    manifest.chunks > 500
  ) {
    throw new Error('SECURE_RECORD_CORRUPT');
  }

  const chunks = await Promise.all(
    Array.from({ length: manifest.chunks }, (_, index) =>
      getRaw(chunkKey(key, manifest.generation, index)),
    ),
  );
  if (chunks.some((chunk) => chunk === null)) {
    throw new Error('SECURE_RECORD_CORRUPT');
  }
  const value = chunks.join('');
  if (value.length !== manifest.length) {
    throw new Error('SECURE_RECORD_CORRUPT');
  }
  return value;
}

async function commitSecureRecord(key: string, value: string) {
  const previousManifestRaw = await getRaw(manifestKey(key));
  const previousManifest = previousManifestRaw
    ? (JSON.parse(previousManifestRaw) as Partial<Manifest>)
    : null;
  const chunks = value.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'gs')) ?? [''];
  const generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  await Promise.all(
    chunks.map((chunk, index) =>
      setRaw(chunkKey(key, generation, index), chunk),
    ),
  );
  const staged = await Promise.all(
    chunks.map((_, index) => getRaw(chunkKey(key, generation, index))),
  );
  if (staged.join('') !== value) {
    throw new Error('SECURE_WRITE_VERIFICATION_FAILED');
  }
  await setRaw(
    manifestKey(key),
    JSON.stringify({
      version: 1,
      generation,
      chunks: chunks.length,
      length: value.length,
      writtenAt: Date.now(),
    } satisfies Manifest),
  );

  const oldCount =
    typeof previousManifest?.chunks === 'number' ? previousManifest.chunks : 0;
  const oldGeneration =
    typeof previousManifest?.generation === 'string'
      ? previousManifest.generation
      : null;
  if (oldGeneration && oldGeneration !== generation) {
    await Promise.all(
      Array.from({ length: oldCount }, (_, index) =>
        removeRaw(chunkKey(key, oldGeneration, index)).catch(() => undefined),
      ),
    );
  }
}

export async function writeSecureRecord(key: string, value: string) {
  const operation = writeQueue.then(() => commitSecureRecord(key, value));
  writeQueue = operation.catch(() => undefined);
  return operation;
}

async function commitRemoveSecureRecord(key: string) {
  const rawManifest = await getRaw(manifestKey(key));
  let count = 0;
  let generation = 'missing';
  try {
    const parsed = rawManifest ? (JSON.parse(rawManifest) as Manifest) : null;
    count = parsed?.chunks ?? 0;
    generation = parsed?.generation ?? generation;
  } catch {
    count = 0;
  }
  await removeRaw(manifestKey(key));
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      removeRaw(chunkKey(key, generation, index)).catch(() => undefined),
    ),
  );
}

export async function removeSecureRecord(key: string) {
  const operation = writeQueue.then(() => commitRemoveSecureRecord(key));
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export async function migratePlaintextRecord(
  secureKey: string,
  legacyKey: string,
) {
  const existing = await readSecureRecord(secureKey);
  const legacy = await AsyncStorage.getItem(legacyKey);
  if (existing !== null) {
    if (legacy !== null) await AsyncStorage.removeItem(legacyKey);
    return existing;
  }
  if (legacy === null) return null;
  await writeSecureRecord(secureKey, legacy);
  const verified = await readSecureRecord(secureKey);
  if (verified !== legacy) throw new Error('SECURE_MIGRATION_VERIFICATION_FAILED');
  await AsyncStorage.removeItem(legacyKey);
  return verified;
}