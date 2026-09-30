import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AudioFileEntry } from '../src/shared/types';
import { buildSortPlan, executeSortPlan, resumeSortOperation, undoSortOperation } from '../src/main/file-operations';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wavesort-operations-'));
  const sourceRoot = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  const journalDirectory = path.join(root, 'journals');
  const sourcePath = path.join(sourceRoot, 'raw kicks', 'kick.wav');
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.writeFile(sourcePath, Buffer.from('kick-fixture-data'));
  const stats = await fs.stat(sourcePath);
  const entry: AudioFileEntry = {
    id: 'kick-entry',
    absolutePath: sourcePath,
    relativePath: path.relative(sourceRoot, sourcePath),
    fileName: 'kick.wav',
    extension: '.wav',
    size: stats.size,
    modifiedAt: stats.mtimeMs,
    category: 'kicks',
    family: 'kick',
    form: 'unknown',
    confidence: 0.92,
    reason: 'Fixture category.',
    tags: [],
  };
  return { root, sourceRoot, destination, journalDirectory, sourcePath, entry };
}

test('builds a collision-safe copy plan and undoes only its output', async () => {
  const testFixture = await fixture();
  try {
    const existingPath = path.join(testFixture.destination, 'Kicks', 'kick.wav');
    await fs.mkdir(path.dirname(existingPath), { recursive: true });
    await fs.writeFile(existingPath, Buffer.from('pre-existing-file'));

    const context = {
      root: testFixture.sourceRoot,
      entries: new Map([[testFixture.entry.id, testFixture.entry]]),
      journalDirectory: testFixture.journalDirectory,
    };
    const plan = await buildSortPlan({ entryIds: [testFixture.entry.id], operation: 'copy', destination: testFixture.destination }, context);
    assert.equal(plan.readyCount, 1);
    assert.equal(plan.conflictCount, 1);
    assert.match(plan.items[0].targetPath ?? '', /kick \(2\)\.wav$/i);

    const progress: Array<{ percent: number; elapsedMs: number; bytesProcessed: number; bytesTotal: number }> = [];
    const result = await executeSortPlan(plan, context, (snapshot) => progress.push(snapshot));
    assert.equal(result.processed, 1);
    assert.equal(result.errors, 0);
    assert.equal(result.canUndo, true);
    assert.equal((await fs.readFile(existingPath, 'utf8')), 'pre-existing-file');
    assert.equal((await fs.readFile(plan.items[0].targetPath!, 'utf8')), 'kick-fixture-data');
    assert.equal(progress.at(-1)?.percent, 100);
    assert.ok((progress.at(-1)?.elapsedMs ?? -1) >= 0);
    assert.equal(progress.at(-1)?.bytesProcessed, progress.at(-1)?.bytesTotal);
    assert.equal((await fs.readdir(testFixture.journalDirectory)).some((name) => name.endsWith('.events.ndjson')), false);

    const undo = await undoSortOperation(result.operationId, context);
    assert.equal(undo.processed, 1);
    await assert.rejects(() => fs.access(plan.items[0].targetPath!));
    assert.equal((await fs.readFile(existingPath, 'utf8')), 'pre-existing-file');
  } finally {
    await fs.rm(testFixture.root, { recursive: true, force: true });
  }
});

test('moves only after destination verification and can restore the original', async () => {
  const testFixture = await fixture();
  try {
    const context = {
      root: testFixture.sourceRoot,
      entries: new Map([[testFixture.entry.id, testFixture.entry]]),
      journalDirectory: testFixture.journalDirectory,
    };
    const plan = await buildSortPlan({ entryIds: [testFixture.entry.id], operation: 'move', destination: testFixture.destination }, context);
    const result = await executeSortPlan(plan, context);
    assert.equal(result.processed, 1);
    await assert.rejects(() => fs.access(testFixture.sourcePath));
    await fs.access(plan.items[0].targetPath!);

    const undo = await undoSortOperation(result.operationId, context);
    assert.equal(undo.processed, 1);
    assert.equal((await fs.readFile(testFixture.sourcePath, 'utf8')), 'kick-fixture-data');
    await assert.rejects(() => fs.access(plan.items[0].targetPath!));
  } finally {
    await fs.rm(testFixture.root, { recursive: true, force: true });
  }
});

test('an accepted output name survives verified move and undo restores the original name', async () => {
  const testFixture = await fixture();
  try {
    const context = {
      root: testFixture.sourceRoot,
      entries: new Map([[testFixture.entry.id, testFixture.entry]]),
      journalDirectory: testFixture.journalDirectory,
    };
    const plan = await buildSortPlan({
      entryIds: [testFixture.entry.id], operation: 'move', destination: testFixture.destination,
      nameOverrides: { [testFixture.entry.id]: 'Kick_Thump_Short.wav' },
    }, context);
    const moved = await executeSortPlan(plan, context);
    assert.equal(moved.processed, 1);
    assert.equal(path.basename(plan.items[0].targetPath!), 'Kick_Thump_Short.wav');
    await assert.rejects(() => fs.access(testFixture.sourcePath));
    assert.equal((await fs.readFile(plan.items[0].targetPath!, 'utf8')), 'kick-fixture-data');
    const undone = await undoSortOperation(moved.operationId, context);
    assert.equal(undone.processed, 1);
    assert.equal((await fs.readFile(testFixture.sourcePath, 'utf8')), 'kick-fixture-data');
    await assert.rejects(() => fs.access(plan.items[0].targetPath!));
  } finally {
    await fs.rm(testFixture.root, { recursive: true, force: true });
  }
});

test('blocks a source file that changed after scanning', async () => {
  const testFixture = await fixture();
  try {
    const context = {
      root: testFixture.sourceRoot,
      entries: new Map([[testFixture.entry.id, testFixture.entry]]),
      journalDirectory: testFixture.journalDirectory,
    };
    const plan = await buildSortPlan({ entryIds: [testFixture.entry.id], operation: 'copy', destination: testFixture.destination }, context);
    await fs.writeFile(testFixture.sourcePath, Buffer.from('changed-after-plan'));
    assert.equal(plan.readyCount, 1);

    const result = await executeSortPlan(plan, context);
    assert.equal(result.processed, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.errors, 1);
    assert.equal(result.items[0].status, 'changed');
    await assert.rejects(() => fs.access(testFixture.destination));
  } finally {
    await fs.rm(testFixture.root, { recursive: true, force: true });
  }
});

test('reports a source that disappears after the plan is built', async () => {
  const testFixture = await fixture();
  try {
    const context = {
      root: testFixture.sourceRoot,
      entries: new Map([[testFixture.entry.id, testFixture.entry]]),
      journalDirectory: testFixture.journalDirectory,
    };
    const plan = await buildSortPlan({ entryIds: [testFixture.entry.id], operation: 'copy', destination: testFixture.destination }, context);
    await fs.unlink(testFixture.sourcePath);

    const result = await executeSortPlan(plan, context);
    assert.equal(result.processed, 0);
    assert.equal(result.errors, 1);
    assert.equal(result.items[0].status, 'missing');
    await assert.rejects(() => fs.access(testFixture.destination));
  } finally {
    await fs.rm(testFixture.root, { recursive: true, force: true });
  }
});

test('uses family and form to build nested destination folders', async () => {
  const testFixture = await fixture();
  try {
    const oneShotEntry: AudioFileEntry = {
      ...testFixture.entry,
      category: 'oneshots',
      family: 'kick',
      form: 'one-shot',
    };
    const context = {
      root: testFixture.sourceRoot,
      entries: new Map([[oneShotEntry.id, oneShotEntry]]),
      journalDirectory: testFixture.journalDirectory,
    };
    const plan = await buildSortPlan({ entryIds: [oneShotEntry.id], operation: 'copy', destination: testFixture.destination }, context);
    assert.match(plan.items[0].targetPath ?? '', /One-Shots[\\/]Kicks[\\/]kick\.wav$/i);
  } finally {
    await fs.rm(testFixture.root, { recursive: true, force: true });
  }
});

test('resumes a cancelled journal without duplicating completed outputs', async () => {
  const testFixture = await fixture();
  try {
    const secondPath = path.join(testFixture.sourceRoot, 'raw kicks', 'kick-two.wav');
    await fs.writeFile(secondPath, Buffer.from('second-kick-fixture'));
    const secondStats = await fs.stat(secondPath);
    const secondEntry: AudioFileEntry = {
      ...testFixture.entry,
      id: 'second-kick-entry',
      absolutePath: secondPath,
      relativePath: path.relative(testFixture.sourceRoot, secondPath),
      fileName: 'kick-two.wav',
      size: secondStats.size,
      modifiedAt: secondStats.mtimeMs,
    };
    const context = {
      root: testFixture.sourceRoot,
      entries: new Map([[testFixture.entry.id, testFixture.entry], [secondEntry.id, secondEntry]]),
      journalDirectory: testFixture.journalDirectory,
    };
    const plan = await buildSortPlan({ entryIds: [testFixture.entry.id, secondEntry.id], operation: 'copy', destination: testFixture.destination,
      nameOverrides: { [testFixture.entry.id]: 'Kick_Second_Thump.wav' } }, context);
    const controller = new AbortController();
    const result = await executeSortPlan(plan, context, (progress) => {
      if (progress.phase === 'executing' && progress.processed === 1) controller.abort();
    }, controller.signal);

    assert.equal(result.cancelled, true);
    assert.equal(result.processed, 1);
    assert.equal(result.canResume, true);
    await fs.access(plan.items[0].targetPath!);
    await assert.rejects(() => fs.access(plan.items[1].targetPath!));

    const resumed = await resumeSortOperation(result.operationId, context);
    assert.equal(resumed.cancelled, false);
    assert.equal(resumed.processed, 1);
    assert.equal(resumed.canResume, false);
    await fs.access(plan.items[0].targetPath!);
    await fs.access(plan.items[1].targetPath!);
    assert.equal(path.basename(plan.items[1].targetPath!), 'Kick_Second_Thump.wav');
  } finally {
    await fs.rm(testFixture.root, { recursive: true, force: true });
  }
});

test('cancels undo after the current file and leaves remaining outputs intact', async () => {
  const testFixture = await fixture();
  try {
    const secondPath = path.join(testFixture.sourceRoot, 'raw kicks', 'kick-two.wav');
    await fs.writeFile(secondPath, Buffer.from('second-kick-fixture'));
    const secondStats = await fs.stat(secondPath);
    const secondEntry: AudioFileEntry = {
      ...testFixture.entry,
      id: 'second-kick-entry',
      absolutePath: secondPath,
      relativePath: path.relative(testFixture.sourceRoot, secondPath),
      fileName: 'kick-two.wav',
      size: secondStats.size,
      modifiedAt: secondStats.mtimeMs,
    };
    const context = {
      root: testFixture.sourceRoot,
      entries: new Map([[testFixture.entry.id, testFixture.entry], [secondEntry.id, secondEntry]]),
      journalDirectory: testFixture.journalDirectory,
    };
    const plan = await buildSortPlan({ entryIds: [testFixture.entry.id, secondEntry.id], operation: 'copy', destination: testFixture.destination }, context);
    const copied = await executeSortPlan(plan, context);
    const controller = new AbortController();
    const undone = await undoSortOperation(copied.operationId, context, (progress) => {
      if (progress.phase === 'undoing' && progress.processed === 1) controller.abort();
    }, controller.signal);

    assert.equal(undone.cancelled, true);
    assert.equal(undone.processed, 1);
    assert.equal(undone.canUndo, true);
    await assert.rejects(() => fs.access(plan.items[0].targetPath!));
    await fs.access(plan.items[1].targetPath!);
  } finally {
    await fs.rm(testFixture.root, { recursive: true, force: true });
  }
});

test('uses an accepted name only for a collision-safe destination and journals it through resume and undo', async () => {
  const testFixture = await fixture();
  try {
    const context = {
      root: testFixture.sourceRoot,
      entries: new Map([[testFixture.entry.id, testFixture.entry]]),
      journalDirectory: testFixture.journalDirectory,
    };
    const existing = path.join(testFixture.destination, 'Kicks', 'Kick_Thump_Short.wav');
    await fs.mkdir(path.dirname(existing), { recursive: true });
    await fs.writeFile(existing, 'leave-me-alone');
    const plan = await buildSortPlan({
      entryIds: [testFixture.entry.id], operation: 'copy', destination: testFixture.destination,
      nameOverrides: { [testFixture.entry.id]: 'Kick_Thump_Short.wav' },
    }, context);
    assert.equal(plan.items[0].fileName, 'kick.wav');
    assert.equal(plan.items[0].outputFileName, 'Kick_Thump_Short (2).wav');
    assert.equal(plan.items[0].status, 'conflict');
    const result = await executeSortPlan(plan, context);
    const journal = JSON.parse(await fs.readFile(path.join(context.journalDirectory, `${result.operationId}.json`), 'utf8')) as { items: Array<{ targetPath: string }> };
    assert.equal(journal.items[0].targetPath, plan.items[0].targetPath);
    assert.equal((await fs.readFile(testFixture.sourcePath, 'utf8')), 'kick-fixture-data');
    assert.equal((await fs.readFile(existing, 'utf8')), 'leave-me-alone');
    assert.equal((await resumeSortOperation(result.operationId, context)).processed, 0);
    assert.equal((await undoSortOperation(result.operationId, context)).processed, 1);
    await assert.rejects(() => fs.access(plan.items[0].targetPath!));
    assert.equal((await fs.readFile(existing, 'utf8')), 'leave-me-alone');
  } finally {
    await fs.rm(testFixture.root, { recursive: true, force: true });
  }
});

test('rejects unsafe or unrelated name overrides before planning', async () => {
  const testFixture = await fixture();
  try {
    const context = {
      root: testFixture.sourceRoot,
      entries: new Map([[testFixture.entry.id, testFixture.entry]]),
      journalDirectory: testFixture.journalDirectory,
    };
    for (const name of ['CON.wav', 'kick/escape.wav', 'kick.mp3']) {
      await assert.rejects(() => buildSortPlan({ entryIds: [testFixture.entry.id], operation: 'copy', destination: testFixture.destination, nameOverrides: { [testFixture.entry.id]: name } }, context));
    }
    await assert.rejects(() => buildSortPlan({ entryIds: [testFixture.entry.id], operation: 'copy', destination: testFixture.destination, nameOverrides: { unrelated: 'Safe.wav' } }, context));
  } finally {
    await fs.rm(testFixture.root, { recursive: true, force: true });
  }
});
