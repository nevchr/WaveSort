import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { classifyAudioFile, isAudioFile } from '../shared/classifier';
import { applyAliasRules } from '../shared/alias-rules';
import { familyForCategory } from '../shared/taxonomy';
import { fastFingerprint } from './fingerprint';
import { readAudioMetadata } from './audio-metadata';
import type { AliasRule, AudioFileEntry, CategoryId, ScanIssue, ScanProgress, ScanResult } from '../shared/types';

const DEFAULT_MAX_AUDIO_FILES = 100_000;
const PROGRESS_INTERVAL = 24;
const CLASSIFIER_PROFILE_VERSION = 'taxonomy-2026-09-26-2';
const IGNORED_DIRECTORY_NAMES = new Set(['node_modules', '__macosx', 'system volume information', 'wavesort sorted']);

export interface ScanOptions {
  scanId: string;
  signal?: AbortSignal;
  maxAudioFiles?: number;
  cachePath?: string;
  corrections?: Readonly<Record<string, CategoryId>>;
  aliasRules?: readonly AliasRule[];
  onProgress?: (progress: ScanProgress) => void;
}

interface ScanCounters {
  directoriesVisited: number;
  filesVisited: number;
  audioFound: number;
  classified: number;
  ignoredFiles: number;
  cacheReused: number;
  changedCount: number;
}

interface ScanCacheRoot {
  classifierVersion: string;
  entries: Record<string, AudioFileEntry>;
}

interface ScanCacheDocument {
  version: 1;
  roots: Record<string, ScanCacheRoot>;
}

function progressSnapshot(
  scanId: string,
  phase: ScanProgress['phase'],
  counters: ScanCounters,
  issues: ScanIssue[],
  currentPath?: string,
): ScanProgress {
  return {
    scanId,
    phase,
    ...counters,
    issueCount: issues.length,
    currentPath,
  };
}

function addIssue(issues: ScanIssue[], issue: ScanIssue): void {
  if (issues.length < 100) issues.push(issue);
}

function idForRelativePath(relativePath: string): string {
  return Buffer.from(relativePath).toString('base64url');
}

function rootKey(root: string): string {
  return path.resolve(root).toLowerCase();
}

function isWithin(parent: string, candidate: string): boolean {
  const normalizedParent = path.resolve(parent).toLowerCase();
  const normalizedCandidate = path.resolve(candidate).toLowerCase();
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

function applyCorrection(entry: AudioFileEntry, category: CategoryId): AudioFileEntry {
  const family = category === 'oneshots' || category === 'loops' ? entry.family : familyForCategory(category);
  const form = category === 'oneshots' ? 'one-shot' : category === 'loops' ? 'loop' : entry.form;
  return {
    ...entry,
    category,
    family,
    form,
    confidence: 1,
    reason: `Saved correction: ${category}.`,
    tags: [...new Set([...entry.tags, 'saved-correction'])],
  };
}

async function readCache(cachePath: string | undefined, root: string): Promise<Map<string, AudioFileEntry>> {
  if (!cachePath) return new Map();
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath, 'utf8')) as ScanCacheDocument;
    const cachedRoot = parsed.version === 1 ? parsed.roots?.[rootKey(root)] : undefined;
    if (!cachedRoot || cachedRoot.classifierVersion !== CLASSIFIER_PROFILE_VERSION || !cachedRoot.entries) return new Map();
    return new Map(Object.entries(cachedRoot.entries));
  } catch {
    return new Map();
  }
}

async function writeCache(cachePath: string | undefined, root: string, entries: AudioFileEntry[]): Promise<void> {
  if (!cachePath) return;
  let document: ScanCacheDocument = { version: 1, roots: {} };
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath, 'utf8')) as ScanCacheDocument;
    if (parsed.version === 1 && parsed.roots) document = parsed;
  } catch {
    // A missing or corrupt cache is safely replaced after a complete scan.
  }
  document.roots[rootKey(root)] = {
    classifierVersion: CLASSIFIER_PROFILE_VERSION,
    entries: Object.fromEntries(entries.map((entry) => [entry.relativePath, entry])),
  };
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(document), 'utf8');
    await fs.rename(temporaryPath, cachePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function scanDirectory(rootInput: string, options: ScanOptions): Promise<ScanResult> {
  const requestedRoot = path.resolve(rootInput);
  let root: string;
  try {
    root = await fs.realpath(requestedRoot);
  } catch {
    throw new Error('That source path is not a readable folder.');
  }

  const rootStats = await fs.stat(root).catch(() => null);
  if (!rootStats?.isDirectory()) throw new Error('That source path is not a readable folder.');

  const started = Date.now();
  const entries: AudioFileEntry[] = [];
  const cacheEntries: AudioFileEntry[] = [];
  const issues: ScanIssue[] = [];
  const previousEntries = await readCache(options.cachePath, root);
  const seenRelativePaths = new Set<string>();
  const visitedDirectories = new Set<string>([rootKey(root)]);
  const pending = [root];
  const counters: ScanCounters = {
    directoriesVisited: 0,
    filesVisited: 0,
    audioFound: 0,
    classified: 0,
    ignoredFiles: 0,
    cacheReused: 0,
    changedCount: 0,
  };
  const maxAudioFiles = options.maxAudioFiles ?? DEFAULT_MAX_AUDIO_FILES;
  let lastProgressAt = 0;
  let status: ScanResult['status'] = 'complete';

  const emitProgress = (phase: ScanProgress['phase'], currentPath?: string, force = false): void => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 80 && counters.filesVisited % PROGRESS_INTERVAL !== 0) return;
    lastProgressAt = now;
    options.onProgress?.(progressSnapshot(options.scanId, phase, counters, issues, currentPath));
  };

  while (pending.length) {
    if (options.signal?.aborted) {
      status = 'cancelled';
      break;
    }

    const currentDirectory = pending.pop()!;
    counters.directoriesVisited += 1;
    emitProgress('scanning', currentDirectory);

    let directoryEntries;
    try {
      directoryEntries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      addIssue(issues, {
        kind: 'inaccessible-directory',
        path: currentDirectory,
        message: error instanceof Error ? error.message : 'The directory could not be read.',
      });
      emitProgress('scanning', currentDirectory, true);
      continue;
    }

    for (const directoryEntry of directoryEntries) {
      if (options.signal?.aborted) {
        status = 'cancelled';
        break;
      }

      const absolutePath = path.join(currentDirectory, directoryEntry.name);
      counters.filesVisited += 1;

      if (directoryEntry.isSymbolicLink()) {
        addIssue(issues, {
          kind: 'symlink-skipped',
          path: absolutePath,
          message: 'Skipped a symbolic link so the scan cannot leave the selected source folder.',
        });
        emitProgress('scanning', absolutePath);
        continue;
      }

      if (directoryEntry.isDirectory()) {
        const normalizedDirectoryName = directoryEntry.name.toLowerCase();
        if (!directoryEntry.name.startsWith('.') && !IGNORED_DIRECTORY_NAMES.has(normalizedDirectoryName)) {
          try {
            const canonicalDirectory = await fs.realpath(absolutePath);
            if (!isWithin(root, canonicalDirectory)) {
              addIssue(issues, {
                kind: 'symlink-skipped',
                path: absolutePath,
                message: 'Skipped a reparse point that resolves outside the selected source folder.',
              });
            } else if (!visitedDirectories.has(rootKey(canonicalDirectory))) {
              visitedDirectories.add(rootKey(canonicalDirectory));
              pending.push(canonicalDirectory);
            }
          } catch (error) {
            addIssue(issues, {
              kind: 'inaccessible-directory',
              path: absolutePath,
              message: error instanceof Error ? error.message : 'The directory could not be resolved.',
            });
          }
        }
        emitProgress('scanning', absolutePath);
        continue;
      }

      if (!directoryEntry.isFile()) {
        emitProgress('scanning', absolutePath);
        continue;
      }

      if (!isAudioFile(directoryEntry.name)) {
        counters.ignoredFiles += 1;
        emitProgress('scanning', absolutePath);
        continue;
      }

      counters.audioFound += 1;
      if (entries.length >= maxAudioFiles) {
        status = 'limit';
        addIssue(issues, {
          kind: 'scan-limit',
          path: absolutePath,
          message: `The scan stopped after ${maxAudioFiles.toLocaleString()} audio files. Narrow the source folder or increase the scan limit in a future settings panel.`,
        });
        emitProgress('limit', absolutePath, true);
        break;
      }

      try {
        const canonicalFile = await fs.realpath(absolutePath);
        if (!isWithin(root, canonicalFile)) {
          addIssue(issues, {
            kind: 'symlink-skipped',
            path: absolutePath,
            message: 'Skipped a file that resolves outside the selected source folder.',
          });
          emitProgress('scanning', absolutePath);
          continue;
        }
        const stats = await fs.stat(canonicalFile);
        if (!stats.isFile()) continue;
        const relativePath = path.relative(root, canonicalFile);
        const extension = path.extname(directoryEntry.name).toLowerCase() as AudioFileEntry['extension'];
        const cached = previousEntries.get(relativePath);
        const unchanged = cached
          && cached.size === stats.size
          && Math.abs(cached.modifiedAt - stats.mtimeMs) <= 1
          && cached.extension === extension;
        const classification = unchanged ? cached : classifyAudioFile(relativePath, directoryEntry.name);
        if (unchanged) counters.cacheReused += 1;
        else if (cached) counters.changedCount += 1;
        seenRelativePaths.add(relativePath);
        const fingerprint = unchanged && cached?.fingerprint
          ? cached.fingerprint
          : await fastFingerprint(canonicalFile, stats);
        const metadata = unchanged && cached?.metadata
          ? cached.metadata
          : await readAudioMetadata(canonicalFile, extension, stats.size);
        const baseEntry: AudioFileEntry = {
          id: idForRelativePath(relativePath),
          absolutePath: canonicalFile,
          relativePath,
          fileName: directoryEntry.name,
          extension,
          size: stats.size,
          modifiedAt: stats.mtimeMs,
          category: classification.category,
          family: classification.family,
          form: classification.form,
          confidence: classification.confidence,
          reason: classification.reason,
          tags: classification.tags,
          fingerprint,
          metadata,
        };
        cacheEntries.push(baseEntry);
        const correction = options.corrections?.[relativePath];
        const withAlias = options.aliasRules?.length
          ? { ...baseEntry, ...applyAliasRules(baseEntry, baseEntry.fileName, options.aliasRules) }
          : baseEntry;
        entries.push(correction ? applyCorrection(withAlias, correction) : withAlias);
        counters.classified += 1;
      } catch (error) {
        addIssue(issues, {
          kind: 'inaccessible-file',
          path: absolutePath,
          message: error instanceof Error ? error.message : 'The audio file could not be inspected.',
        });
      }

      emitProgress('scanning', absolutePath);
    }

    if (status !== 'complete' || options.signal?.aborted) {
      if (options.signal?.aborted) status = 'cancelled';
      break;
    }
  }

  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base' }));
  const complete = status === 'complete';
  if (complete) await writeCache(options.cachePath, root, cacheEntries).catch(() => undefined);
  emitProgress(complete ? 'complete' : status, root, true);
  const counts = {} as ScanResult['counts'];
  for (const entry of entries) counts[entry.category] = (counts[entry.category] ?? 0) + 1;

  return {
    root,
    defaultDestination: path.join(root, 'WaveSort Sorted'),
    entries,
    counts,
    ignoredFiles: counters.ignoredFiles,
    complete,
    status,
    issues,
    cacheReused: counters.cacheReused,
    addedCount: complete ? entries.filter((entry) => !previousEntries.has(entry.relativePath)).length : 0,
    changedCount: counters.changedCount,
    removedCount: complete ? [...previousEntries.keys()].filter((relativePath) => !seenRelativePaths.has(relativePath)).length : 0,
    scanDurationMs: Date.now() - started,
  };
}
