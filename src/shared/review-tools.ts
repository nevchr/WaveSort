import { applyAliasRules, matchAliasRule, normalizeCue } from './alias-rules';
import { classifyAudioFile } from './classifier';
import type { AliasRule, AudioFileEntry, CategoryId, VerifiedLabel } from './types';

export interface BenchmarkMetrics {
  labeled: number;
  correct: number;
  wrong: number;
  needsReview: number;
  autoPrecision: number | null;
  reviewRate: number | null;
  wrongExamples: Array<{ fileName: string; predicted: CategoryId; verified: CategoryId }>;
}

export function predictedCategory(entry: Pick<AudioFileEntry, 'relativePath' | 'fileName'>, rules: readonly AliasRule[]): CategoryId {
  return applyAliasRules(classifyAudioFile(entry.relativePath, entry.fileName), entry.fileName, rules).category;
}

export function needsReview(entry: Pick<AudioFileEntry, 'relativePath' | 'fileName'>, rules: readonly AliasRule[]): boolean {
  const result = applyAliasRules(classifyAudioFile(entry.relativePath, entry.fileName), entry.fileName, rules);
  return result.category === 'other' || result.confidence < 0.52;
}

export function benchmarkMetrics(
  entries: readonly AudioFileEntry[], labels: Readonly<Record<string, VerifiedLabel>>, rules: readonly AliasRule[],
): BenchmarkMetrics {
  let labeled = 0;
  let correct = 0;
  let wrong = 0;
  let review = 0;
  const wrongExamples: BenchmarkMetrics['wrongExamples'] = [];
  for (const entry of entries) {
    const label = labels[entry.relativePath];
    if (!label || !entry.fingerprint || label.fingerprint !== entry.fingerprint) continue;
    labeled += 1;
    if (needsReview(entry, rules)) review += 1;
    else {
      const predicted = predictedCategory(entry, rules);
      if (predicted === label.category) correct += 1;
      else {
        wrong += 1;
        if (wrongExamples.length < 12) wrongExamples.push({ fileName: entry.fileName, predicted, verified: label.category });
      }
    }
  }
  const decided = correct + wrong;
  return {
    labeled, correct, wrong, needsReview: review,
    autoPrecision: decided ? correct / decided : null,
    reviewRate: labeled ? review / labeled : null,
    wrongExamples,
  };
}

function stableRank(value: string): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** A small reproducible, category-stratified queue; labels remain user-verified. */
export function benchmarkCandidates(entries: readonly AudioFileEntry[], perCategory = 4): AudioFileEntry[] {
  const buckets = new Map<CategoryId, AudioFileEntry[]>();
  for (const entry of entries) {
    const bucket = buckets.get(entry.category) ?? [];
    bucket.push(entry);
    buckets.set(entry.category, bucket);
  }
  const chosen: AudioFileEntry[] = [];
  for (const [category, bucket] of buckets) {
    const targetCount = category === 'other' ? Math.max(12, perCategory) : perCategory;
    let bucketChosen = 0;
    const byFolder = new Map<string, AudioFileEntry[]>();
    for (const entry of bucket) {
      const folder = entry.relativePath.split(/[\\/]/).slice(0, -1).join('/').toLowerCase();
      const group = byFolder.get(folder) ?? [];
      group.push(entry);
      byFolder.set(folder, group);
    }
    const folders = [...byFolder.entries()].sort((a, b) => stableRank(a[0]) - stableRank(b[0]));
    for (const [, group] of folders) group.sort((a, b) => stableRank(a.relativePath) - stableRank(b.relativePath));
    while (bucketChosen < targetCount && folders.some(([, group]) => group.length)) {
      for (const [, group] of folders) {
        if (bucketChosen >= targetCount) break;
        const candidate = group.shift();
        if (candidate) { chosen.push(candidate); bucketChosen += 1; }
      }
    }
  }
  return chosen.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function similarKey(entry: AudioFileEntry): string | null {
  const folder = entry.relativePath.split(/[\\/]/).slice(0, -1).join('/').toLowerCase();
  const stem = entry.fileName.slice(0, -entry.extension.length)
    .replace(/@[a-z0-9_-]+/gi, ' ')
    .replace(/\((?:copy\s*)?\d+\)/gi, ' ');
  const words = normalizeCue(stem).split(' ').filter((word) => word && !/^\d+$/.test(word));
  const name = words.join(' ');
  if (name.length < 3 || ['sample', 'audio', 'sound', 'untitled'].includes(name)) return null;
  return `${folder}\0${name}`;
}

export function similarEntries(active: AudioFileEntry, entries: readonly AudioFileEntry[]): AudioFileEntry[] {
  const key = similarKey(active);
  return key ? entries.filter((entry) => similarKey(entry) === key) : [];
}

export interface AliasPreview {
  matched: number;
  changed: number;
  protectedCorrections: number;
  examples: Array<{ fileName: string; before: CategoryId; after: CategoryId }>;
}

export function previewAliasRule(entries: readonly AudioFileEntry[], proposed: AliasRule): AliasPreview {
  let matched = 0;
  let changed = 0;
  let protectedCorrections = 0;
  const examples: AliasPreview['examples'] = [];
  for (const entry of entries) {
    if (!matchAliasRule(entry.fileName, [proposed])) continue;
    matched += 1;
    if (entry.tags.includes('saved-correction')) {
      protectedCorrections += 1;
      continue;
    }
    if (entry.category !== proposed.category) {
      changed += 1;
      if (examples.length < 8) examples.push({ fileName: entry.fileName, before: entry.category, after: proposed.category });
    }
  }
  return { matched, changed, protectedCorrections, examples };
}
