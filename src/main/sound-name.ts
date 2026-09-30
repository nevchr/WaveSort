import fs from 'node:fs/promises';
import path from 'node:path';
import type { AudioFileEntry, SoundNameSuggestion } from '../shared/types';

const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const MAX_DURATION_SECONDS = 3;
const HEADER_BYTES = 64 * 1024;
const ANALYSIS_TIMEOUT_MS = 4_000;

/** A destination basename only; never accepts a path or an extension change. */
export function validateOutputFileName(proposed: unknown, original: string): string {
  if (typeof proposed !== 'string' || !proposed || proposed.length > 180 || proposed !== proposed.trim()) {
    throw new Error('The suggested filename must be 1–180 characters without leading or trailing spaces.');
  }
  if (/[<>:"/\\|?*\x00-\x1f]/.test(proposed) || /[. ]$/.test(proposed)) {
    throw new Error('The suggested filename contains characters Windows cannot use.');
  }
  const extension = path.extname(original);
  if (!extension || !proposed.toLowerCase().endsWith(extension.toLowerCase())) {
    throw new Error(`Keep the original ${extension || 'audio'} extension in the suggested filename.`);
  }
  const stem = proposed.slice(0, -extension.length);
  if (!stem || /[. ]$/.test(stem) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(stem)) {
    throw new Error('That filename is reserved or invalid on Windows.');
  }
  return `${stem}${extension}`;
}

interface WavFormat {
  dataOffset: number;
  dataBytes: number;
  channels: number;
  sampleRate: number;
  bits: number;
  format: number;
  frameBytes: number;
}

function parseWavHeader(header: Buffer, fileSize: number): WavFormat | null {
  if (header.length < 12 || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let format: Omit<WavFormat, 'dataOffset' | 'dataBytes'> | null = null;
  let dataOffset = -1;
  let dataBytes = 0;
  while (offset + 8 <= header.length) {
    const size = header.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (header.toString('ascii', offset, offset + 4) === 'fmt ' && size >= 16 && start + 16 <= header.length) {
      const tag = header.readUInt16LE(start);
      const channels = header.readUInt16LE(start + 2);
      const sampleRate = header.readUInt32LE(start + 4);
      const bits = header.readUInt16LE(start + 14);
      const frameBytes = channels * (bits / 8);
      if ((tag === 1 && [16, 24].includes(bits) || tag === 3 && bits === 32)
        && channels >= 1 && channels <= 2 && sampleRate >= 8_000 && sampleRate <= 192_000
        && Number.isInteger(frameBytes) && frameBytes > 0 && header.readUInt16LE(start + 12) === frameBytes) {
        format = { channels, sampleRate, bits, format: tag, frameBytes };
      }
    } else if (header.toString('ascii', offset, offset + 4) === 'data') {
      dataOffset = start;
      dataBytes = size;
      break;
    }
    const next = start + size + (size % 2);
    if (next <= offset || next > fileSize) break;
    offset = next;
  }
  if (!format || dataOffset < 0 || dataBytes <= 0 || dataOffset + dataBytes > fileSize || dataBytes % format.frameBytes !== 0) return null;
  return { ...format, dataOffset, dataBytes };
}

function readSample(data: Buffer, offset: number, format: WavFormat): number {
  if (format.format === 3) return data.readFloatLE(offset);
  if (format.bits === 16) return data.readInt16LE(offset) / 32768;
  return data.readIntLE(offset, 3) / 8388608;
}

function prefixFor(entry: AudioFileEntry): string {
  const byFamily: Record<string, string> = {
    'closed-hat': 'Hi-Hat', 'open-hat': 'Open-Hat', kick: 'Kick', snare: 'Snare', clap: 'Clap',
    perc: 'Perc', rim: 'Rim', tom: 'Tom', cymbal: 'Cymbal', fx: 'FX', '808': '808', bass: 'Bass',
  };
  return byFamily[entry.family] ?? (entry.category === 'fx' ? 'FX' : 'Sound');
}

export function suggestFromPcm(data: Buffer, format: WavFormat, entry: AudioFileEntry): SoundNameSuggestion {
  const frames = data.length / format.frameBytes;
  const step = Math.max(1, Math.floor(format.sampleRate / 4000));
  const blockFrames = Math.max(1, Math.floor(format.sampleRate / 40));
  const blocks = Math.ceil(frames / blockFrames);
  const energy = new Float64Array(blocks);
  const counts = new Uint32Array(blocks);
  let peak = 0;
  let crossings = 0;
  let samples = 0;
  let previous = 0;
  for (let frame = 0; frame < frames; frame += step) {
    let sample = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      const value = readSample(data, frame * format.frameBytes + channel * (format.bits / 8), format);
      if (!Number.isFinite(value) || Math.abs(value) > 1.1) return { status: 'unavailable', reason: 'The audio data could not be analyzed reliably.' };
      sample += value / format.channels;
    }
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    if (samples > 0 && (sample >= 0) !== (previous >= 0)) crossings += 1;
    previous = sample;
    const block = Math.floor(frame / blockFrames);
    energy[block] += sample * sample;
    counts[block] += 1;
    samples += 1;
  }
  if (peak < 0.015) return { status: 'unavailable', reason: 'The sound is too quiet for a useful suggestion.' };
  const rms = Array.from(energy, (value, index) => Math.sqrt(value / Math.max(1, counts[index])));
  const highest = Math.max(...rms);
  const peakBlock = rms.indexOf(highest);
  const activeBlocks = rms.filter((value) => value > Math.max(0.008, highest * 0.12)).length;
  const activeSeconds = activeBlocks / 40;
  const tail = rms.slice(Math.floor(rms.length * 0.75));
  const tailAverage = tail.reduce((sum, value) => sum + value, 0) / Math.max(1, tail.length);
  if (peakBlock > 8 || tailAverage > highest * 0.5 || activeSeconds > 2.5) {
    return { status: 'unavailable', reason: 'No clear isolated attack and decay were found.' };
  }
  const zcr = crossings / Math.max(1, samples - 1);
  const bright = zcr > 0.17;
  const noisy = zcr > 0.10;
  const short = activeSeconds < 0.38;
  const sharp = peakBlock <= 2;
  let word: string;
  if (bright && short) word = sharp ? 'Tss' : 'Tchik';
  else if (bright) word = 'Shhh';
  else if (noisy && short) word = 'Tchik';
  else if (noisy) word = 'Psh';
  else if (short) word = zcr < 0.035 ? 'Thump' : 'Tik';
  else word = 'Thrum';
  const description = `${short ? 'short' : 'ringing'}, ${bright ? 'bright, noisy' : noisy ? 'noisy' : 'low/tonal'} ${sharp ? 'attack' : 'onset'}`;
  return {
    status: 'suggested',
    fileName: `${prefixFor(entry)}_${word}_${short ? 'Short' : 'Tail'}${path.extname(entry.fileName)}`,
    explanation: `Heuristic suggestion from a ${description}. The sound type prefix comes from the reviewed category; this does not reclassify the file.`,
  };
}

export async function suggestSoundName(entry: AudioFileEntry): Promise<SoundNameSuggestion> {
  if (entry.form === 'loop' || entry.form === 'stem' || entry.form === 'texture') {
    return { status: 'unavailable', reason: 'Loops, stems, and textures are outside sound-name V1.' };
  }
  if (entry.extension !== '.wav') return { status: 'unavailable', reason: 'Sound-name V1 supports uncompressed PCM/float WAV only.' };
  if (entry.size > MAX_AUDIO_BYTES) return { status: 'unavailable', reason: 'This file is too large for bounded sound-name analysis.' };
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(entry.absolutePath, 'r');
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size !== entry.size || Math.abs(stats.mtimeMs - entry.modifiedAt) > 1) {
      return { status: 'unavailable', reason: 'The file changed after scanning. Rescan it first.' };
    }
    const file = await handle.readFile({ signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS) });
    const after = await handle.stat();
    if (file.length !== stats.size || after.size !== stats.size || Math.abs(after.mtimeMs - stats.mtimeMs) > 1) {
      return { status: 'unavailable', reason: 'The file changed during analysis. Rescan it first.' };
    }
    const format = parseWavHeader(file.subarray(0, Math.min(HEADER_BYTES, file.length)), file.length);
    if (!format) return { status: 'unavailable', reason: 'This WAV encoding or file structure is unsupported or corrupt.' };
    const duration = format.dataBytes / format.frameBytes / format.sampleRate;
    if (duration < 0.04 || duration > MAX_DURATION_SECONDS || format.dataBytes > MAX_AUDIO_BYTES) {
      return { status: 'unavailable', reason: 'Only isolated sounds between 0.04 and 3 seconds are supported.' };
    }
    const data = file.subarray(format.dataOffset, format.dataOffset + format.dataBytes);
    await new Promise<void>((resolve) => setImmediate(resolve));
    return suggestFromPcm(data, format, entry);
  } catch {
    return { status: 'unavailable', reason: 'The audio file could not be analyzed.' };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
