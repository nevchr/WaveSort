import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanDirectory } from '../src/main/scanner';
import { buildSortPlan } from '../src/main/file-operations';

async function makeRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('scans supported audio, reports progress, and skips policy directories', async () => {
  const root = await makeRoot('wavesort-scanner-');
  try {
    await fs.mkdir(path.join(root, 'Drums', 'Kicks'), { recursive: true });
    await fs.mkdir(path.join(root, 'Loops'), { recursive: true });
    await fs.mkdir(path.join(root, 'WaveSort Sorted'), { recursive: true });
    await fs.writeFile(path.join(root, 'Drums', 'Kicks', 'kick.wav'), 'kick');
    await fs.writeFile(path.join(root, 'Loops', 'melody loop.wav'), 'loop');
    await fs.writeFile(path.join(root, 'notes.txt'), 'not audio');
    await fs.writeFile(path.join(root, 'WaveSort Sorted', 'already-sorted.wav'), 'ignored');

    const progress: string[] = [];
    const result = await scanDirectory(root, {
      scanId: 'scanner-fixture',
      onProgress: (snapshot) => progress.push(snapshot.phase),
    });

    assert.equal(result.complete, true);
    assert.equal(result.status, 'complete');
    assert.equal(result.entries.length, 2);
    assert.equal(result.ignoredFiles, 1);
    assert.equal(result.issues.length, 0);
    assert.equal(result.entries.find((entry) => entry.fileName === 'melody loop.wav')?.form, 'loop');
    assert.equal(progress.at(-1), 'complete');
    assert.ok(progress.includes('scanning'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('cancels a scan and returns a partial, non-sortable result', async () => {
  const root = await makeRoot('wavesort-scan-cancel-');
  try {
    await Promise.all(Array.from({ length: 64 }, (_, index) => fs.writeFile(path.join(root, `kick-${index}.wav`), 'kick')));
    const controller = new AbortController();
    const progress: string[] = [];
    const result = await scanDirectory(root, {
      scanId: 'cancel-fixture',
      signal: controller.signal,
      onProgress: (snapshot) => {
        progress.push(snapshot.phase);
        if (snapshot.phase === 'scanning' && snapshot.classified >= 24) controller.abort();
      },
    });

    assert.equal(result.complete, false);
    assert.equal(result.status, 'cancelled');
    assert.ok(result.entries.length > 0);
    assert.ok(result.entries.length < 64);
    assert.equal(progress.at(-1), 'cancelled');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('stops at the scan safety limit with an actionable issue', async () => {
  const root = await makeRoot('wavesort-scan-limit-');
  try {
    await Promise.all(Array.from({ length: 5 }, (_, index) => fs.writeFile(path.join(root, `sample-${index}.wav`), 'sample')));
    const result = await scanDirectory(root, { scanId: 'limit-fixture', maxAudioFiles: 3 });

    assert.equal(result.complete, false);
    assert.equal(result.status, 'limit');
    assert.equal(result.entries.length, 3);
    assert.equal(result.issues[0]?.kind, 'scan-limit');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('reuses the scan cache and reports added, changed, and removed files', async () => {
  const root = await makeRoot('wavesort-scan-cache-');
  const cachePath = path.join(root, 'scan-cache.json');
  try {
    const kickPath = path.join(root, 'kick.wav');
    const loopPath = path.join(root, 'melody-loop.wav');
    await fs.writeFile(kickPath, 'kick');
    await fs.writeFile(loopPath, 'loop');

    const first = await scanDirectory(root, { scanId: 'cache-first', cachePath });
    assert.equal(first.addedCount, 2);
    assert.equal(first.cacheReused, 0);
    assert.equal(first.changedCount, 0);
    assert.equal(first.removedCount, 0);

    const second = await scanDirectory(root, { scanId: 'cache-second', cachePath });
    assert.equal(second.cacheReused, 2);
    assert.equal(second.addedCount, 0);
    assert.equal(second.changedCount, 0);
    assert.equal(second.removedCount, 0);

    await fs.writeFile(kickPath, 'kick changed');
    const third = await scanDirectory(root, { scanId: 'cache-third', cachePath });
    assert.equal(third.cacheReused, 1);
    assert.equal(third.changedCount, 1);
    assert.equal(third.addedCount, 0);
    assert.equal(third.removedCount, 0);

    await fs.rm(loopPath);
    const fourth = await scanDirectory(root, { scanId: 'cache-fourth', cachePath });
    assert.equal(fourth.cacheReused, 1);
    assert.equal(fourth.changedCount, 0);
    assert.equal(fourth.removedCount, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('applies saved corrections after cached classification', async () => {
  const root = await makeRoot('wavesort-scan-correction-');
  const cachePath = path.join(root, 'scan-cache.json');
  try {
    const filePath = path.join(root, 'mystery.wav');
    await fs.writeFile(filePath, 'unknown');
    const first = await scanDirectory(root, { scanId: 'correction-first', cachePath });
    assert.equal(first.entries[0]?.category, 'other');

    const second = await scanDirectory(root, {
      scanId: 'correction-second',
      cachePath,
      corrections: { 'mystery.wav': 'kicks' },
    });
    assert.equal(second.cacheReused, 1);
    assert.equal(second.entries[0]?.category, 'kicks');
    assert.ok(second.entries[0]?.tags.includes('saved-correction'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('reclassifies unchanged files when the classifier profile version changes', async () => {
  const root = await makeRoot('wavesort-scan-profile-');
  const cachePath = path.join(root, 'scan-cache.json');
  try {
    await fs.writeFile(path.join(root, 'hhats (1).wav'), 'hat-fixture');
    const first = await scanDirectory(root, { scanId: 'profile-first', cachePath });
    assert.equal(first.entries[0]?.category, 'hihats');
    const cache = JSON.parse(await fs.readFile(cachePath, 'utf8')) as { roots: Record<string, { classifierVersion: string }> };
    for (const cachedRoot of Object.values(cache.roots)) cachedRoot.classifierVersion = 'taxonomy-older';
    await fs.writeFile(cachePath, JSON.stringify(cache));
    const second = await scanDirectory(root, { scanId: 'profile-second', cachePath });
    assert.equal(second.cacheReused, 0);
    assert.equal(second.entries[0]?.category, 'hihats');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('updates cached classifications with alias rules while preserving saved corrections', async () => {
  const root = await makeRoot('wavesort-scan-alias-');
  const cachePath = path.join(root, 'scan-cache.json');
  try {
    await fs.writeFile(path.join(root, 'zzhat1.wav'), 'hat');
    await fs.writeFile(path.join(root, 'zzhat2.wav'), 'hat');
    const first = await scanDirectory(root, { scanId: 'alias-first', cachePath });
    assert.equal(first.entries[0]?.category, 'other');
    const second = await scanDirectory(root, {
      scanId: 'alias-second', cachePath,
      aliasRules: [{ term: 'zzhat', category: 'hihats' }],
      corrections: { 'zzhat2.wav': 'open-hats' },
    });
    assert.equal(second.cacheReused, 2);
    assert.equal(second.entries.find((entry) => entry.fileName === 'zzhat1.wav')?.category, 'hihats');
    assert.equal(second.entries.find((entry) => entry.fileName === 'zzhat2.wav')?.category, 'open-hats');
    const aliased = second.entries.find((entry) => entry.fileName === 'zzhat1.wav')!;
    const plan = await buildSortPlan({ entryIds: [aliased.id], operation: 'copy', destination: path.join(root, 'output') }, {
      root, entries: new Map(second.entries.map((entry) => [entry.id, entry])), journalDirectory: path.join(root, 'journals'),
    });
    assert.match(plan.items[0].targetPath ?? '', /Hi-hats[\\/]zzhat1\.wav$/i);
    const third = await scanDirectory(root, { scanId: 'alias-third', cachePath });
    assert.equal(third.cacheReused, 2);
    assert.equal(third.entries[0]?.category, 'other');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
