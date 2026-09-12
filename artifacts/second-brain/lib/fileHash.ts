import * as FileSystem from 'expo-file-system/legacy';
import { sha256 } from 'js-sha256';
import { toByteArray } from 'base64-js';

export async function computeFileSha256(uri: string): Promise<string> {
  const fileInfo = await FileSystem.getInfoAsync(uri);
  if (!fileInfo.exists) throw new Error('File not found');

  const fileSize = fileInfo.size ?? 0;
  const chunkSize = 2 * 1024 * 1024;
  const hasher = sha256.create();

  for (let offset = 0; offset < fileSize; offset += chunkSize) {
    const length = Math.min(chunkSize, fileSize - offset);
    const base64Chunk = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: offset,
      length,
    });

    const bytes = toByteArray(base64Chunk);
    hasher.update(bytes);

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return hasher.hex();
}
