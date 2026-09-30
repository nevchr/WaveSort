import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAliasRules, matchAliasRule, validateAliasRule } from '../src/shared/alias-rules';
import { classifyAudioFile } from '../src/shared/classifier';
import { benchmarkCandidates, benchmarkMetrics, previewAliasRule, similarEntries } from '../src/shared/review-tools';
import type { AudioFileEntry } from '../src/shared/types';

function entry(relativePath: string, overrides: Partial<AudioFileEntry> = {}): AudioFileEntry {
  const fileName = relativePath.split('/').at(-1)!;
  const classified = classifyAudioFile(relativePath, fileName);
  return {
    ...classified, id: relativePath, absolutePath: `C:/fixture/${relativePath}`, relativePath, fileName,
    extension: '.wav', size: 1, modifiedAt: 0, fingerprint: 'a'.repeat(64), ...overrides,
  };
}

test('library aliases match whole normalized filename cues and leave base classifier intact', () => {
  const rule = validateAliasRule({ term: '  hhats  ', category: 'hihats' });
  assert.equal(rule.term, 'hhats');
  assert.equal(matchAliasRule('hhats-02.wav', [rule])?.category, 'hihats');
  assert.equal(matchAliasRule('shhatsound.wav', [rule]), undefined);
  assert.equal(matchAliasRule('mystery.wav', [{ term: 'wav', category: 'hihats' }]), undefined);
  const base = classifyAudioFile('misc/zzhit.wav', 'zzhit.wav');
  const applied = applyAliasRules(base, 'zzhit.wav', [{ term: 'zzhit', category: 'snares' }]);
  assert.equal(base.category, 'other');
  assert.equal(applied.category, 'snares');
  assert.match(applied.reason, /Library alias/);
  assert.throws(() => validateAliasRule({ term: '../hat', category: 'hihats' }));
  assert.throws(() => validateAliasRule({ term: 'hat', category: 'not-a-category' }));
});

test('benchmark metrics use raw predictions, not saved corrections, and separate review decisions', () => {
  const entries = [
    entry('Pack/kick01.wav', { category: 'snares', tags: ['saved-correction'] }),
    entry('Pack/snare01.wav'),
    entry('Pack/mystery.wav'),
  ];
  const labels = {
    'Pack/kick01.wav': { category: 'kicks', fingerprint: 'a'.repeat(64) },
    'Pack/snare01.wav': { category: 'kicks', fingerprint: 'a'.repeat(64) },
    'Pack/mystery.wav': { category: 'percs', fingerprint: 'a'.repeat(64) },
  } as const;
  const result = benchmarkMetrics(entries, labels, []);
  assert.equal(result.labeled, 3);
  assert.equal(result.correct, 1);
  assert.equal(result.wrong, 1);
  assert.equal(result.needsReview, 1);
  assert.equal(result.autoPrecision, 0.5);
  assert.equal(result.reviewRate, 1 / 3);
  assert.equal(benchmarkMetrics(entries, { ...labels, 'Pack/kick01.wav': { category: 'kicks', fingerprint: 'b'.repeat(64) } }, []).labeled, 2);
});

test('stratified queue, similar names, and rule preview stay bounded and explicit', () => {
  const entries = [
    entry('Pack/HHats/hhats (1) @maker.wav'),
    entry('Pack/HHats/hhats (2) @maker.wav'),
    entry('Other/HHats/hhats (3) @maker.wav'),
    entry('Pack/Kicks/kick01.wav'),
    entry('Pack/Kicks/kick02.wav'),
    entry('Pack/Misc/zzhit.wav'),
    entry('Pack/Misc/zzhit2.wav', { tags: ['saved-correction'], category: 'claps' }),
  ];
  const similar = similarEntries(entries[0], entries);
  assert.deepEqual(similar.map((item) => item.id), entries.slice(0, 2).map((item) => item.id));
  const queue = benchmarkCandidates(entries, 1);
  assert.equal(new Set(queue.map((item) => item.id)).size, queue.length);
  assert.ok(queue.some((item) => item.category === 'other'));
  assert.ok(queue.some((item) => item.category === 'hihats'));
  const preview = previewAliasRule(entries, { term: 'zzhit', category: 'snares' });
  assert.equal(preview.matched, 2);
  assert.equal(preview.changed, 1);
  assert.equal(preview.protectedCorrections, 1);
});
