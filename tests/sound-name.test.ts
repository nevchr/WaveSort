import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { suggestSoundName, validateOutputFileName } from '../src/main/sound-name';
import type { AudioFileEntry } from '../src/shared/types';

function wav16(frames: number, sampleRate: number, sample: (frame: number) => number): Buffer {
  const dataBytes = frames * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < frames; index += 1) buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample(index) * 32767))), 44 + index * 2);
  return buffer;
}

async function fixture(contents: Buffer, extension: AudioFileEntry['extension'] = '.wav') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wavesort-name-'));
  const absolutePath = path.join(root, `hat${extension}`);
  await fs.writeFile(absolutePath, contents);
  const stats = await fs.stat(absolutePath);
  const entry: AudioFileEntry = {
    id: 'hat', absolutePath, relativePath: `hat${extension}`, fileName: `hat${extension}`,
    extension, size: stats.size, modifiedAt: stats.mtimeMs, category: 'hihats', family: 'closed-hat',
    form: 'one-shot', confidence: 0.8, reason: 'Fixture', tags: [],
  };
  return { root, entry };
}

test('suggests a short descriptive output name without editing the source', async () => {
  const audio = wav16(8_000, 40_000, (frame) => frame < 6_000 ? (Math.sin(frame * 2.1) + Math.sin(frame * 1.37)) * 0.22 * (1 - frame / 6_000) : 0);
  const { root, entry } = await fixture(audio);
  try {
    const result = await suggestSoundName(entry);
    assert.equal(result.status, 'suggested');
    if (result.status === 'suggested') {
      assert.match(result.fileName, /^Hi-Hat_(Tss|Tchik)_Short\.wav$/);
      assert.match(result.explanation, /heuristic/i);
    }
    assert.deepEqual(await fs.readFile(entry.absolutePath), audio);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('declines unsupported, loop, silent, long, and corrupt audio', async () => {
  const short = wav16(4_000, 40_000, () => 0);
  const { root, entry } = await fixture(short);
  try {
    assert.equal((await suggestSoundName(entry)).status, 'unavailable');
    assert.equal((await suggestSoundName({ ...entry, form: 'loop' })).status, 'unavailable');
    assert.equal((await suggestSoundName({ ...entry, extension: '.mp3' })).status, 'unavailable');
    await fs.writeFile(entry.absolutePath, Buffer.alloc(short.length));
    const changed = await fs.stat(entry.absolutePath);
    assert.equal((await suggestSoundName({ ...entry, modifiedAt: changed.mtimeMs })).status, 'unavailable');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('validates Windows output names and preserves the original extension', () => {
  assert.equal(validateOutputFileName('Hi-Hat_Tss_Short.WAV', 'hat.wav'), 'Hi-Hat_Tss_Short.wav');
  for (const proposed of ['CON.wav', 'LPT1.wav', 'bad/name.wav', 'bad\\name.wav', 'bad:name.wav', 'bad?.wav', 'bad .wav', 'hat.mp3', '../hat.wav', ' hat.wav']) {
    assert.throws(() => validateOutputFileName(proposed, 'hat.wav'), proposed);
  }
});
