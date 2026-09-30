import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import type { Stats } from 'node:fs';

const WINDOW_BYTES = 64 * 1024;

/**
 * Hashes a bounded prefix and suffix rather than reading an entire sample.
 * Size and modification time remain part of the comparison, so this is an
 * identity check for operation safety, not a content-addressed storage hash.
 */
export async function fastFingerprint(filePath: string, stats?: Stats): Promise<string> {
  const fileStats = stats ?? await fs.stat(filePath);
  const handle = await fs.open(filePath, 'r');
  try {
    const hash = createHash('sha256');
    hash.update(`size:${fileStats.size};`);
    const windowSize = Math.min(WINDOW_BYTES, fileStats.size);
    if (windowSize > 0) {
      const first = Buffer.alloc(windowSize);
      const firstRead = await handle.read(first, 0, windowSize, 0);
      hash.update(first.subarray(0, firstRead.bytesRead));
      if (fileStats.size > windowSize) {
        const last = Buffer.alloc(windowSize);
        const lastRead = await handle.read(last, 0, windowSize, Math.max(0, fileStats.size - windowSize));
        hash.update(last.subarray(0, lastRead.bytesRead));
      }
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}
