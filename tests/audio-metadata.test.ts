import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readAudioMetadata } from '../src/main/audio-metadata';
import { deleteAliasRule, deleteVerifiedLabel, readCorrections, readReviewProfile, readSettings, saveAliasRule, saveCorrection, saveSettings, saveVerifiedLabel } from '../src/main/profile-store';

async function makeRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('extracts bounded WAV metadata without decoding the full file', async () => {
  const root = await makeRoot('wavesort-metadata-');
  try {
    const filePath = path.join(root, 'kick.wav');
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(48_000, 24);
    header.writeUInt32LE(192_000, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(192_000, 40);
    await fs.writeFile(filePath, header);

    const metadata = await readAudioMetadata(filePath, '.wav', header.byteLength);
    assert.equal(metadata.codec, 'PCM');
    assert.equal(metadata.channels, 2);
    assert.equal(metadata.sampleRate, 48_000);
    assert.equal(metadata.bitsPerSample, 16);
    assert.equal(metadata.durationMs, 1_000);
    assert.equal(metadata.playbackSupport, 'supported');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('persists corrections by canonical source root and relative path', async () => {
  const root = await makeRoot('wavesort-profile-');
  try {
    const profilePath = path.join(root, 'profile.json');
    const sourceRoot = path.join(root, 'Library');
    await fs.mkdir(sourceRoot);
    await saveCorrection(profilePath, sourceRoot, path.join('Drums', 'kick.wav'), 'kicks');
    await saveCorrection(profilePath, sourceRoot, path.join('Drums', 'snare.wav'), 'snares');

    const corrections = await readCorrections(profilePath, sourceRoot);
    assert.deepEqual(corrections, {
      [path.join('Drums', 'kick.wav')]: 'kicks',
      [path.join('Drums', 'snare.wav')]: 'snares',
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('persists a validated local accent-color setting', async () => {
  const root = await makeRoot('wavesort-settings-');
  try {
    const profilePath = path.join(root, 'profile.json');
    assert.equal((await readSettings(profilePath)).accentColor, '#d9ad6b');
    await saveSettings(profilePath, { accentColor: '#22c55e' });
    assert.equal((await readSettings(profilePath)).accentColor, '#22c55e');
    await assert.rejects(() => saveSettings(profilePath, { accentColor: 'green' }), /accent color is invalid/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('persists root-scoped aliases and verified labels without changing corrections', async () => {
  const root = await makeRoot('wavesort-review-profile-');
  try {
    const profilePath = path.join(root, 'profile.json');
    const firstRoot = path.join(root, 'PackA');
    const secondRoot = path.join(root, 'PackB');
    await saveCorrection(profilePath, firstRoot, 'hat.wav', 'hihats');
    await saveAliasRule(profilePath, firstRoot, { term: 'zzhat', category: 'hihats' });
    await saveAliasRule(profilePath, firstRoot, { term: 'ZZHAT', category: 'open-hats' });
    await saveVerifiedLabel(profilePath, firstRoot, 'hat.wav', { category: 'open-hats', fingerprint: 'a'.repeat(64) });
    const profile = await readReviewProfile(profilePath, firstRoot);
    assert.deepEqual(profile.aliasRules, [{ term: 'zzhat', category: 'open-hats' }]);
    assert.deepEqual(profile.verifiedLabels['hat.wav'], { category: 'open-hats', fingerprint: 'a'.repeat(64) });
    assert.equal((await readCorrections(profilePath, firstRoot))['hat.wav'], 'hihats');
    assert.deepEqual(await readReviewProfile(profilePath, secondRoot), { aliasRules: [], verifiedLabels: {} });
    await deleteAliasRule(profilePath, firstRoot, 'zzhat');
    assert.deepEqual((await readReviewProfile(profilePath, firstRoot)).aliasRules, []);
    await deleteVerifiedLabel(profilePath, firstRoot, 'hat.wav');
    assert.deepEqual((await readReviewProfile(profilePath, firstRoot)).verifiedLabels, {});
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
