import fs from 'node:fs/promises';
import type { AudioExtension, AudioMetadata } from '../shared/types';

const HEADER_BYTES = 64 * 1024;

function fallbackMetadata(extension: AudioExtension, fileSize: number): AudioMetadata {
  const codec = extension.slice(1).toUpperCase();
  const playbackSupport: AudioMetadata['playbackSupport'] = ['.wav', '.mp3', '.m4a', '.ogg', '.opus'].includes(extension)
    ? 'supported'
    : 'unknown';
  return { fileSize, codec, playbackSupport };
}

function readAscii(buffer: Buffer, offset: number, length: number): string {
  return buffer.subarray(offset, offset + length).toString('ascii');
}

function parseWav(buffer: Buffer, extension: AudioExtension, fileSize: number): AudioMetadata | null {
  if (buffer.length < 12 || readAscii(buffer, 0, 4) !== 'RIFF' || readAscii(buffer, 8, 4) !== 'WAVE') return null;
  const metadata = fallbackMetadata(extension, fileSize);
  let offset = 12;
  let dataBytes = 0;
  let byteRate = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = readAscii(buffer, offset, 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === 'fmt ' && chunkSize >= 16 && chunkStart + 16 <= buffer.length) {
      const formatTag = buffer.readUInt16LE(chunkStart);
      const channels = buffer.readUInt16LE(chunkStart + 2);
      const sampleRate = buffer.readUInt32LE(chunkStart + 4);
      byteRate = buffer.readUInt32LE(chunkStart + 8);
      const bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
      metadata.channels = channels;
      metadata.sampleRate = sampleRate;
      metadata.bitsPerSample = bitsPerSample;
      metadata.bitrateKbps = byteRate > 0 ? Math.round((byteRate * 8) / 1000) : undefined;
      metadata.codec = formatTag === 1 ? 'PCM' : formatTag === 3 ? 'IEEE float' : `WAV format ${formatTag}`;
    } else if (chunkId === 'data') {
      dataBytes = chunkSize;
      if (byteRate > 0) metadata.durationMs = Math.round((dataBytes / byteRate) * 1000);
    }
    const nextOffset = chunkStart + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset) break;
    offset = nextOffset;
  }
  if (!metadata.durationMs && dataBytes > 0 && byteRate > 0) metadata.durationMs = Math.round((dataBytes / byteRate) * 1000);
  return metadata;
}

function parseFlac(buffer: Buffer, extension: AudioExtension, fileSize: number): AudioMetadata | null {
  if (buffer.length < 4 || readAscii(buffer, 0, 4) !== 'fLaC') return null;
  const metadata = fallbackMetadata(extension, fileSize);
  metadata.codec = 'FLAC';
  let offset = 4;
  while (offset + 4 <= buffer.length) {
    const blockType = buffer[offset] & 0x7f;
    const blockSize = buffer.readUIntBE(offset + 1, 3);
    const blockStart = offset + 4;
    if (blockType === 0 && blockSize >= 34 && blockStart + 34 <= buffer.length) {
      const sampleRate = (buffer[blockStart + 10] << 12) | (buffer[blockStart + 11] << 4) | (buffer[blockStart + 12] >> 4);
      const channels = ((buffer[blockStart + 12] & 0x0e) >> 1) + 1;
      const bitsPerSample = (((buffer[blockStart + 12] & 0x01) << 4) | (buffer[blockStart + 13] >> 4)) + 1;
      const totalSamples = Number(
        (BigInt(buffer[blockStart + 13] & 0x0f) << 32n)
        | (BigInt(buffer[blockStart + 14]) << 24n)
        | (BigInt(buffer[blockStart + 15]) << 16n)
        | (BigInt(buffer[blockStart + 16]) << 8n)
        | BigInt(buffer[blockStart + 17]),
      );
      metadata.sampleRate = sampleRate;
      metadata.channels = channels;
      metadata.bitsPerSample = bitsPerSample;
      metadata.durationMs = sampleRate > 0 ? Math.round((totalSamples / sampleRate) * 1000) : undefined;
      metadata.bitrateKbps = fileSize > 0 && metadata.durationMs ? Math.round((fileSize * 8) / metadata.durationMs) : undefined;
      break;
    }
    offset = blockStart + blockSize;
    if (buffer[offset - 4] & 0x80) break;
  }
  return metadata;
}

function readExtended80(buffer: Buffer, offset: number): number {
  if (offset + 10 > buffer.length) return 0;
  const rawExponent = buffer.readUInt16BE(offset);
  if (rawExponent === 0) return 0;
  const exponent = rawExponent & 0x7fff;
  const mantissa = Number((BigInt(buffer.readUInt32BE(offset + 2)) << 32n) | BigInt(buffer.readUInt32BE(offset + 6)));
  const value = mantissa * 2 ** (exponent - 16383 - 63);
  return rawExponent & 0x8000 ? -value : value;
}

function parseAiff(buffer: Buffer, extension: AudioExtension, fileSize: number): AudioMetadata | null {
  if (buffer.length < 12 || readAscii(buffer, 0, 4) !== 'FORM') return null;
  const formType = readAscii(buffer, 8, 4);
  if (formType !== 'AIFF' && formType !== 'AIFC') return null;
  const metadata = fallbackMetadata(extension, fileSize);
  metadata.codec = 'PCM';
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = readAscii(buffer, offset, 4);
    const chunkSize = buffer.readUInt32BE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === 'COMM' && chunkSize >= 18 && chunkStart + 18 <= buffer.length) {
      const channels = buffer.readUInt16BE(chunkStart);
      const frames = buffer.readUInt32BE(chunkStart + 2);
      const bitsPerSample = buffer.readUInt16BE(chunkStart + 6);
      const sampleRate = readExtended80(buffer, chunkStart + 8);
      metadata.channels = channels;
      metadata.sampleRate = sampleRate || undefined;
      metadata.bitsPerSample = bitsPerSample;
      metadata.durationMs = sampleRate > 0 ? Math.round((frames / sampleRate) * 1000) : undefined;
      metadata.bitrateKbps = sampleRate > 0 && channels > 0 && bitsPerSample > 0 ? Math.round((sampleRate * channels * bitsPerSample) / 1000) : undefined;
      if (formType === 'AIFC' && chunkSize >= 22 && chunkStart + 22 <= buffer.length) metadata.codec = readAscii(buffer, chunkStart + 18, 4).trim() || 'AIFC';
    }
    const nextOffset = chunkStart + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset) break;
    offset = nextOffset;
  }
  return metadata;
}

export async function readAudioMetadata(filePath: string, extension: AudioExtension, fileSize: number): Promise<AudioMetadata> {
  const fallback = fallbackMetadata(extension, fileSize);
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const header = Buffer.alloc(HEADER_BYTES);
      const { bytesRead } = await handle.read(header, 0, HEADER_BYTES, 0);
      const boundedHeader = header.subarray(0, bytesRead);
      return parseWav(boundedHeader, extension, fileSize)
        ?? parseFlac(boundedHeader, extension, fileSize)
        ?? parseAiff(boundedHeader, extension, fileSize)
        ?? fallback;
    } finally {
      await handle.close();
    }
  } catch {
    return fallback;
  }
}

export function formatMetadataDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return undefined;
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
