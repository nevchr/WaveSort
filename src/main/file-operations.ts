import { createReadStream, createWriteStream } from 'node:fs';
import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CATEGORY_BY_ID } from '../shared/categories';
import { destinationSegments, familyForCategory } from '../shared/taxonomy';
import { fastFingerprint } from './fingerprint';
import { validateOutputFileName } from './sound-name';
import type {
  AudioFileEntry,
  CategoryId,
  OperationProgress,
  SortPlan,
  SortPlanItem,
  SortRequest,
  SortResult,
} from '../shared/types';

const MAX_PLAN_ITEMS = 100_000;
const STAT_TOLERANCE_MS = 1;

export interface FileOperationContext {
  root: string;
  entries: ReadonlyMap<string, AudioFileEntry>;
  journalDirectory: string;
}

type JournalItemStatus = 'pending' | 'processed' | 'skipped' | 'changed' | 'missing' | 'error' | 'copied-not-removed' | 'cancelled' | 'undone';

interface JournalItem {
  entryId: string;
  sourcePath: string;
  targetPath?: string;
  category: CategoryId;
  sourceSize: number;
  sourceModifiedAt: number;
  sourceFingerprint?: string;
  status: JournalItemStatus;
  message: string;
}

interface OperationJournal {
  action: 'sort';
  operationId: string;
  planId: string;
  operation: SortRequest['operation'];
  destination: string;
  createdAt: number;
  completedAt?: number;
  items: JournalItem[];
}

interface JournalEvent {
  entryId: string;
  status: JournalItemStatus;
  message: string;
}

interface ReadyFileState {
  kind: 'ready';
  stats: Stats;
  fingerprint: string;
}

type FileState = ReadyFileState | { kind: 'missing' | 'changed'; message: string };

function isWithin(parent: string, candidate: string): boolean {
  const normalizedParent = path.resolve(parent).toLowerCase();
  const normalizedCandidate = path.resolve(candidate).toLowerCase();
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

function pathKey(filePath: string): string {
  return path.resolve(filePath).toLowerCase();
}

async function canonicalWritePath(candidatePath: string): Promise<string> {
  const missingSegments: string[] = [];
  let cursor = path.resolve(candidatePath);
  while (true) {
    try {
      const canonical = await fs.realpath(cursor);
      const stats = await fs.stat(canonical);
      if (!stats.isDirectory()) throw new Error('The destination must be a folder.');
      return path.join(canonical, ...missingSegments);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missingSegments.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function assertSourceInsideRoot(root: string, sourcePath: string): Promise<void> {
  const canonicalRoot = await fs.realpath(root);
  let canonicalSource: string;
  try {
    canonicalSource = await fs.realpath(sourcePath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  if (!isWithin(canonicalRoot, canonicalSource)) throw new Error('The source path no longer resolves inside the scanned folder.');
}

async function assertTargetInsideDestination(destination: string, targetPath: string): Promise<void> {
  const [canonicalDestination, canonicalParent] = await Promise.all([fs.realpath(destination), fs.realpath(path.dirname(targetPath))]);
  if (!isWithin(canonicalDestination, canonicalParent)) throw new Error('The destination path no longer resolves inside the planned folder.');
}

function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_BY_ID, value);
}

function isSortOperation(value: unknown): value is SortRequest['operation'] {
  return value === 'copy' || value === 'move';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findAvailableTargetPath(
  targetDirectory: string,
  fileName: string,
  reserved: Set<string>,
): Promise<{ targetPath: string; conflict: boolean }> {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let index = 1;

  while (index < MAX_PLAN_ITEMS + 2) {
    const candidateName = index === 1 ? fileName : `${baseName} (${index})${extension}`;
    const targetPath = path.join(targetDirectory, candidateName);
    const key = pathKey(targetPath);
    if (!reserved.has(key) && !(await exists(targetPath))) {
      reserved.add(key);
      return { targetPath, conflict: index > 1 };
    }
    index += 1;
  }

  throw new Error(`Could not find an available filename for ${fileName}.`);
}

function planClassification(entry: AudioFileEntry, category: CategoryId): Pick<SortPlanItem, 'family' | 'form'> {
  if (category === 'oneshots') return { family: entry.family, form: 'one-shot' };
  if (category === 'loops') return { family: entry.family, form: 'loop' };
  return { family: familyForCategory(category), form: entry.form };
}

function sourceMatches(stats: Stats, expectedSize: number, expectedModifiedAt: number): boolean {
  return stats.isFile() && stats.size === expectedSize && Math.abs(stats.mtimeMs - expectedModifiedAt) <= STAT_TOLERANCE_MS;
}

async function readFileState(
  sourcePath: string,
  expectedSize: number,
  expectedModifiedAt: number,
  expectedFingerprint?: string,
): Promise<FileState> {
  try {
    const stats = await fs.lstat(sourcePath, { bigint: false });
    if (stats.isSymbolicLink()) return { kind: 'changed', message: 'The source became a symbolic link after scanning. Rescan before sorting it.' };
    if (!sourceMatches(stats, expectedSize, expectedModifiedAt)) {
      return { kind: 'changed', message: 'The source changed after scanning. Rescan before sorting it.' };
    }
    const fingerprint = await fastFingerprint(sourcePath, stats);
    if (expectedFingerprint && fingerprint !== expectedFingerprint) {
      return { kind: 'changed', message: 'The source content changed after scanning. Rescan before sorting it.' };
    }
    return { kind: 'ready', stats, fingerprint };
  } catch (error) {
    return { kind: 'missing', message: `The source is no longer available: ${errorMessage(error, 'file not found')}` };
  }
}

async function readSourceState(entry: AudioFileEntry): Promise<FileState> {
  return readFileState(entry.absolutePath, entry.size, entry.modifiedAt, entryFingerprint(entry));
}

function entryFingerprint(entry: AudioFileEntry): string | undefined {
  return typeof (entry as AudioFileEntry & { fingerprint?: unknown }).fingerprint === 'string'
    ? (entry as AudioFileEntry & { fingerprint: string }).fingerprint
    : undefined;
}

function blockedItem(
  entryId: string,
  operation: SortRequest['operation'],
  message: string,
  status: SortPlanItem['status'],
  entry?: AudioFileEntry,
): SortPlanItem {
  return {
    entryId,
    sourcePath: entry?.absolutePath ?? '',
    relativePath: entry?.relativePath ?? entryId,
    fileName: entry?.fileName ?? entryId,
    category: entry?.category ?? 'other',
    family: entry?.family ?? 'unknown',
    form: entry?.form ?? 'unknown',
    operation,
    status,
    message,
    sourceSize: entry?.size ?? 0,
    sourceModifiedAt: entry?.modifiedAt ?? 0,
    sourceFingerprint: entryFingerprint(entry ?? ({} as AudioFileEntry)) ?? '',
  };
}

export async function buildSortPlan(request: SortRequest, context: FileOperationContext): Promise<SortPlan> {
  if (!isSortOperation(request.operation)) throw new Error('Choose either copy or move.');
  if (!request.destination || typeof request.destination !== 'string') throw new Error('Choose a destination folder.');

  const destination = await canonicalWritePath(request.destination.trim());
  if (destination === path.parse(destination).root) throw new Error('Choose a specific destination folder, not a drive root.');
  if (pathKey(destination) === pathKey(context.root)) throw new Error('Choose a destination different from the scanned source folder.');
  if (!request.entryIds.length) throw new Error('Select at least one file to sort.');
  if (request.entryIds.length > MAX_PLAN_ITEMS) throw new Error(`A single plan cannot contain more than ${MAX_PLAN_ITEMS.toLocaleString()} files.`);

  const uniqueEntryIds = [...new Set(request.entryIds)];
  const selectedIds = new Set(uniqueEntryIds);
  for (const [entryId, proposed] of Object.entries(request.nameOverrides ?? {})) {
    if (!selectedIds.has(entryId) || !context.entries.has(entryId)) throw new Error('A suggested filename refers to a file outside this plan.');
    validateOutputFileName(proposed, context.entries.get(entryId)!.fileName);
  }
  const selectedEntries = uniqueEntryIds
    .map((entryId) => ({ entryId, entry: context.entries.get(entryId) }))
    .sort((a, b) => (a.entry?.relativePath ?? a.entryId).localeCompare(b.entry?.relativePath ?? b.entryId, undefined, { sensitivity: 'base' }));

  const warnings: string[] = [];
  if (isWithin(context.root, destination)) {
    warnings.push('The destination is inside the source folder. WaveSort will not scan its default output folder, but custom destinations inside the source should be reviewed carefully.');
  }
  if (request.operation === 'move') {
    warnings.push('Move removes the original only after the destination copy has been verified. A journal is written for recovery.');
  }

  const reserved = new Set<string>();
  const items: SortPlanItem[] = [];

  for (const selected of selectedEntries) {
    const entry = selected.entry;
    if (!entry) {
      items.push(blockedItem(selected.entryId, request.operation, 'This file is no longer part of the current scan. Rescan the source folder.', 'invalid'));
      continue;
    }

    const override = request.overrides?.[entry.id];
    const category = override ?? entry.category;
    if (!isCategoryId(category)) {
      items.push(blockedItem(entry.id, request.operation, 'The selected category is not valid.', 'invalid', entry));
      continue;
    }

    const classification = planClassification(entry, category);
    const state = await readSourceState(entry);
    if (state.kind !== 'ready') {
      items.push(blockedItem(entry.id, request.operation, state.message, state.kind, entry));
      continue;
    }

    const targetDirectory = path.join(destination, ...destinationSegments(category, classification.family, classification.form));
    try {
      const outputFileName = request.nameOverrides?.[entry.id]
        ? validateOutputFileName(request.nameOverrides[entry.id], entry.fileName)
        : entry.fileName;
      const available = await findAvailableTargetPath(targetDirectory, outputFileName, reserved);
      items.push({
        entryId: entry.id,
        sourcePath: entry.absolutePath,
        relativePath: entry.relativePath,
        fileName: entry.fileName,
        outputFileName: path.basename(available.targetPath),
        category,
        family: classification.family,
        form: classification.form,
        operation: request.operation,
        targetPath: available.targetPath,
        status: available.conflict ? 'conflict' : 'ready',
        message: available.conflict
          ? 'That filename already exists at the destination; WaveSort will use a numbered filename.'
          : 'Ready to process.',
        sourceSize: state.stats.size,
        sourceModifiedAt: state.stats.mtimeMs,
        sourceFingerprint: state.fingerprint,
      });
    } catch (error) {
      items.push(blockedItem(entry.id, request.operation, errorMessage(error, 'Could not reserve a destination filename.'), 'invalid', entry));
    }
  }

  return {
    planId: randomUUID(),
    createdAt: Date.now(),
    root: context.root,
    destination,
    operation: request.operation,
    items,
    readyCount: items.filter((item) => item.status === 'ready' || item.status === 'conflict').length,
    conflictCount: items.filter((item) => item.status === 'conflict').length,
    blockedCount: items.filter((item) => item.status !== 'ready' && item.status !== 'conflict').length,
    warnings,
  };
}

function journalPath(context: FileOperationContext, operationId: string): string {
  return path.join(context.journalDirectory, `${operationId}.json`);
}

function journalEventsPath(context: FileOperationContext, operationId: string): string {
  return path.join(context.journalDirectory, `${operationId}.events.ndjson`);
}

async function writeJournal(context: FileOperationContext, journal: OperationJournal): Promise<void> {
  await fs.mkdir(context.journalDirectory, { recursive: true });
  const finalPath = journalPath(context, journal.operationId);
  const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(journal, null, 2), 'utf8');
    await fs.rename(temporaryPath, finalPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function appendJournalEvent(context: FileOperationContext, journal: OperationJournal, item: JournalItem): Promise<void> {
  await fs.mkdir(context.journalDirectory, { recursive: true });
  const event: JournalEvent = { entryId: item.entryId, status: item.status, message: item.message };
  await fs.appendFile(journalEventsPath(context, journal.operationId), `${JSON.stringify(event)}\n`, 'utf8');
}

async function finalizeJournal(context: FileOperationContext, journal: OperationJournal): Promise<void> {
  await writeJournal(context, journal);
  await fs.rm(journalEventsPath(context, journal.operationId), { force: true });
}

async function readJournal(context: FileOperationContext, operationId: string): Promise<OperationJournal> {
  const raw = await fs.readFile(journalPath(context, operationId), 'utf8');
  const parsed = JSON.parse(raw) as OperationJournal;
  if (parsed.action !== 'sort' || parsed.operationId !== operationId || !Array.isArray(parsed.items) || !isSortOperation(parsed.operation)) {
    throw new Error('The operation journal is not valid.');
  }
  try {
    const eventLines = (await fs.readFile(journalEventsPath(context, operationId), 'utf8')).split(/\r?\n/).filter(Boolean);
    for (const line of eventLines) {
      try {
        const event = JSON.parse(line) as JournalEvent;
        if (typeof event.entryId !== 'string' || typeof event.message !== 'string' || !isJournalItemStatus(event.status)) continue;
        const item = parsed.items.find((candidate) => candidate.entryId === event.entryId);
        if (item) {
          item.status = event.status;
          item.message = event.message;
        }
      } catch {
        // A process can be interrupted while appending the final line. The
        // target/source state remains authoritative during the next resume.
      }
    }
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  for (const item of parsed.items) {
    if (item.sourcePath && !isWithin(context.root, item.sourcePath)) throw new Error('The operation journal contains a source outside the scanned folder.');
    if (item.targetPath && !isWithin(parsed.destination, item.targetPath)) throw new Error('The operation journal contains a destination outside the planned folder.');
  }
  return parsed;
}

function isJournalItemStatus(value: unknown): value is JournalItemStatus {
  return value === 'pending' || value === 'processed' || value === 'skipped' || value === 'changed' || value === 'missing' || value === 'error' || value === 'copied-not-removed' || value === 'cancelled' || value === 'undone';
}

async function copyFileWithProgress(sourcePath: string, targetPath: string, onBytes: (bytesCopied: number) => void): Promise<void> {
  let bytesCopied = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesCopied += chunk.byteLength;
      onBytes(bytesCopied);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(createReadStream(sourcePath), meter, createWriteStream(targetPath, { flags: 'wx' }));
  } catch (error) {
    await fs.rm(targetPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function verifyTarget(targetPath: string, expectedSize: number, expectedFingerprint?: string): Promise<void> {
  const stats = await fs.lstat(targetPath, { bigint: false });
  if (stats.isSymbolicLink()) throw new Error('The destination path is a symbolic link and cannot be verified safely.');
  if (!stats.isFile() || stats.size !== expectedSize) throw new Error('The destination file failed size verification after writing.');
  if (expectedFingerprint) {
    const fingerprint = await fastFingerprint(targetPath, stats);
    if (fingerprint !== expectedFingerprint) throw new Error('The destination file failed content verification after writing.');
  }
}

function isRetryableStatus(status: JournalItemStatus): boolean {
  return status === 'pending' || status === 'cancelled' || status === 'error' || status === 'changed' || status === 'missing' || status === 'copied-not-removed';
}

function resultFromJournal(
  journal: OperationJournal,
  items: SortResult['items'],
  action: SortResult['action'],
  cancelled: boolean,
  canResumeOverride?: boolean,
): SortResult {
  const canResume = canResumeOverride ?? journal.items.some((item) => isRetryableStatus(item.status));
  return {
    action,
    operation: journal.operation,
    planId: journal.planId,
    operationId: journal.operationId,
    destination: journal.destination,
    processed: items.filter((item) => item.status === 'processed').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
    errors: items.filter((item) => item.status === 'error' || item.status === 'changed' || item.status === 'missing').length,
    canUndo: journal.items.some((item) => item.status === 'processed' || item.status === 'copied-not-removed'),
    canResume,
    cancelled,
    items,
  };
}

interface ExecuteOptions {
  signal?: AbortSignal;
  onProgress?: (progress: OperationProgress) => void;
  retryFailed: boolean;
}

function operationProgressSnapshot(
  operationId: string,
  phase: OperationProgress['phase'],
  processed: number,
  total: number,
  startedAt: number,
  bytesProcessed: number,
  bytesTotal: number,
  currentFile?: string,
): OperationProgress {
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const ratio = bytesTotal > 0 ? bytesProcessed / bytesTotal : total > 0 ? processed / total : 1;
  const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  const workDone = bytesTotal > 0 ? bytesProcessed : processed;
  const workTotal = bytesTotal > 0 ? bytesTotal : total;
  const workRate = elapsedMs > 0 ? workDone / (elapsedMs / 1000) : 0;
  const estimatedRemainingMs = workRate > 0 ? Math.round(Math.max(0, workTotal - workDone) / workRate * 1000) : undefined;
  return {
    operationId,
    phase,
    processed,
    total,
    percent,
    startedAt,
    elapsedMs,
    estimatedRemainingMs,
    bytesProcessed,
    bytesTotal,
    currentFile,
  };
}

async function executeJournal(journal: OperationJournal, context: FileOperationContext, options: ExecuteOptions): Promise<SortResult> {
  const workItems = journal.items.filter((item) => item.status === 'pending' || (options.retryFailed && isRetryableStatus(item.status)));
  const results: SortResult['items'] = [];
  let completed = 0;
  let cancelled = false;
  let bytesProcessed = 0;
  let currentBytes = 0;
  const bytesTotal = workItems.reduce((sum, item) => sum + item.sourceSize, 0);
  const startedAt = Date.now();
  let lastProgressAt = 0;

  const emitProgress = (phase: OperationProgress['phase'], currentFile?: string, force = false): void => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 120) return;
    lastProgressAt = now;
    options.onProgress?.(operationProgressSnapshot(journal.operationId, phase, completed, workItems.length, startedAt, bytesProcessed + currentBytes, bytesTotal, currentFile));
  };

  for (let index = 0; index < workItems.length; index += 1) {
    const item = workItems[index];
    if (options.signal?.aborted) {
      cancelled = true;
      for (const remaining of workItems.slice(index)) {
        results.push({ entryId: remaining.entryId, sourcePath: remaining.sourcePath, targetPath: remaining.targetPath, status: 'skipped', message: 'Not started because the operation was cancelled.' });
      }
      break;
    }

    currentBytes = 0;
    emitProgress('executing', item.sourcePath, true);
    if (options.signal?.aborted) {
      cancelled = true;
      for (const remaining of workItems.slice(index)) {
        results.push({ entryId: remaining.entryId, sourcePath: remaining.sourcePath, targetPath: remaining.targetPath, status: 'skipped', message: 'Not started because the operation was cancelled.' });
      }
      break;
    }
    try {
      if (!item.targetPath) throw new Error('The planned destination is missing. Rebuild the plan.');
      await assertSourceInsideRoot(context.root, item.sourcePath);

      const targetExists = await exists(item.targetPath);
      if (targetExists) {
        await assertTargetInsideDestination(journal.destination, item.targetPath);
        await verifyTarget(item.targetPath, item.sourceSize, item.sourceFingerprint);
        if (journal.operation === 'move') {
          const sourceState = await readFileState(item.sourcePath, item.sourceSize, item.sourceModifiedAt, item.sourceFingerprint);
          if (sourceState.kind === 'ready') await fs.unlink(item.sourcePath);
          else if (sourceState.kind === 'changed') throw new Error(sourceState.message);
        }
        item.status = 'processed';
        item.message = 'The planned destination was already present and verified; the operation resumed safely.';
        results.push({ entryId: item.entryId, sourcePath: item.sourcePath, targetPath: item.targetPath, status: 'processed', message: item.message });
      } else {
        const sourceState = await readFileState(item.sourcePath, item.sourceSize, item.sourceModifiedAt, item.sourceFingerprint);
        if (sourceState.kind !== 'ready') {
          item.status = sourceState.kind;
          item.message = sourceState.message;
          results.push({ entryId: item.entryId, sourcePath: item.sourcePath, targetPath: item.targetPath, status: sourceState.kind === 'missing' ? 'missing' : 'changed', message: sourceState.message });
          completed += 1;
          bytesProcessed += item.sourceSize;
          await appendJournalEvent(context, journal, item);
          emitProgress('executing', item.sourcePath, true);
          continue;
        }

        await fs.mkdir(path.dirname(item.targetPath), { recursive: true });
        await assertTargetInsideDestination(journal.destination, item.targetPath);
        await copyFileWithProgress(item.sourcePath, item.targetPath, (copied) => {
          currentBytes = copied;
          emitProgress('executing', item.sourcePath);
        });
        await verifyTarget(item.targetPath, sourceState.stats.size, item.sourceFingerprint ?? sourceState.fingerprint);

        if (journal.operation === 'move') {
          try {
            await fs.unlink(item.sourcePath);
          } catch (error) {
            item.status = 'copied-not-removed';
            item.message = `Destination verified, but the original could not be removed: ${errorMessage(error, 'unlink failed')}`;
            results.push({ entryId: item.entryId, sourcePath: item.sourcePath, targetPath: item.targetPath, status: 'error', message: item.message });
            completed += 1;
            bytesProcessed += item.sourceSize;
            await appendJournalEvent(context, journal, item);
            emitProgress('executing', item.sourcePath, true);
            continue;
          }
        }

        item.status = 'processed';
        item.message = journal.operation === 'copy' ? 'Copied and verified.' : 'Copied, verified, and removed the original.';
        results.push({ entryId: item.entryId, sourcePath: item.sourcePath, targetPath: item.targetPath, status: 'processed', message: item.message });
      }
    } catch (error) {
      item.status = 'error';
      item.message = errorMessage(error, 'The file could not be processed.');
      results.push({ entryId: item.entryId, sourcePath: item.sourcePath, targetPath: item.targetPath, status: 'error', message: item.message });
    }

    completed += 1;
    bytesProcessed += item.sourceSize;
    currentBytes = 0;
    await appendJournalEvent(context, journal, item);
    emitProgress('executing', item.sourcePath, true);
  }

  journal.completedAt = Date.now();
  await finalizeJournal(context, journal);
  emitProgress(cancelled ? 'cancelled' : 'complete', undefined, true);
  return resultFromJournal(journal, results, 'sort', cancelled);
}

export async function executeSortPlan(
  plan: SortPlan,
  context: FileOperationContext,
  onProgress?: (progress: OperationProgress) => void,
  signal?: AbortSignal,
): Promise<SortResult> {
  const operationId = randomUUID();
  const journal: OperationJournal = {
    action: 'sort',
    operationId,
    planId: plan.planId,
    operation: plan.operation,
    destination: plan.destination,
    createdAt: Date.now(),
    items: plan.items.map((item) => ({
      entryId: item.entryId,
      sourcePath: item.sourcePath,
      targetPath: item.targetPath,
      category: item.category,
      sourceSize: item.sourceSize,
      sourceModifiedAt: item.sourceModifiedAt,
      sourceFingerprint: item.sourceFingerprint,
      status: item.status === 'ready' || item.status === 'conflict' ? 'pending' : 'skipped',
      message: item.message,
    })),
  };
  await writeJournal(context, journal);
  return executeJournal(journal, context, { signal, onProgress, retryFailed: false });
}

export async function resumeSortOperation(
  operationId: string,
  context: FileOperationContext,
  retryFailed = false,
  onProgress?: (progress: OperationProgress) => void,
  signal?: AbortSignal,
): Promise<SortResult> {
  const journal = await readJournal(context, operationId);
  return executeJournal(journal, context, { signal, onProgress, retryFailed });
}

export async function undoSortOperation(
  operationId: string,
  context: FileOperationContext,
  onProgress?: (progress: OperationProgress) => void,
  signal?: AbortSignal,
): Promise<SortResult> {
  if (!operationId || operationId.length > 100) throw new Error('The operation ID is invalid.');
  const journal = await readJournal(context, operationId);
  const reversible = journal.items.filter((item) => item.status === 'processed' || item.status === 'copied-not-removed');
  const results: SortResult['items'] = [];
  let completed = 0;
  let cancelled = false;
  let bytesProcessed = 0;
  let currentBytes = 0;
  const bytesTotal = reversible.reduce((sum, item) => sum + item.sourceSize, 0);
  const startedAt = Date.now();
  let lastProgressAt = 0;
  const emitProgress = (phase: OperationProgress['phase'], currentFile?: string, force = false): void => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 120) return;
    lastProgressAt = now;
    onProgress?.(operationProgressSnapshot(operationId, phase, completed, reversible.length, startedAt, bytesProcessed + currentBytes, bytesTotal, currentFile));
  };

  for (const item of journal.items) {
    if (item.status !== 'processed' && item.status !== 'copied-not-removed') {
      results.push({ entryId: item.entryId, sourcePath: item.sourcePath, targetPath: item.targetPath, status: 'skipped', message: 'This item was not completed and cannot be undone.' });
      continue;
    }

    if (signal?.aborted) {
      cancelled = true;
      results.push({ entryId: item.entryId, sourcePath: item.sourcePath, targetPath: item.targetPath, status: 'skipped', message: 'Not started because the undo was cancelled.' });
      continue;
    }

    currentBytes = 0;
    emitProgress('undoing', item.sourcePath, true);
    try {
      if (!item.targetPath || !(await exists(item.targetPath))) {
        item.status = 'error';
        item.message = 'The created destination no longer exists.';
        results.push({ entryId: item.entryId, sourcePath: item.sourcePath, targetPath: item.targetPath, status: 'error', message: item.message });
        completed += 1;
        bytesProcessed += item.sourceSize;
        await appendJournalEvent(context, journal, item);
        emitProgress('undoing', item.sourcePath, true);
        continue;
      }

      await assertTargetInsideDestination(journal.destination, item.targetPath);
      await verifyTarget(item.targetPath, item.sourceSize, item.sourceFingerprint);
      if (journal.operation === 'copy') {
        await fs.unlink(item.targetPath);
      } else {
        const sourceState = await readFileState(item.sourcePath, item.sourceSize, item.sourceModifiedAt, item.sourceFingerprint);
        if (sourceState.kind === 'ready') {
          await fs.unlink(item.targetPath);
        } else if (sourceState.kind === 'missing') {
          await fs.mkdir(path.dirname(item.sourcePath), { recursive: true });
          await copyFileWithProgress(item.targetPath, item.sourcePath, (copied) => {
            currentBytes = copied;
            emitProgress('undoing', item.sourcePath);
          });
          await verifyTarget(item.sourcePath, item.sourceSize, item.sourceFingerprint);
          await fs.unlink(item.targetPath);
        } else {
          throw new Error(sourceState.message);
        }
      }

      item.status = 'undone';
      item.message = 'Undo completed safely.';
      results.push({ entryId: item.entryId, sourcePath: item.sourcePath, targetPath: item.targetPath, status: 'processed', message: item.message });
    } catch (error) {
      item.status = 'error';
      item.message = errorMessage(error, 'The item could not be undone.');
      results.push({ entryId: item.entryId, sourcePath: item.sourcePath, targetPath: item.targetPath, status: 'error', message: item.message });
    }

    completed += 1;
    bytesProcessed += item.sourceSize;
    currentBytes = 0;
    await appendJournalEvent(context, journal, item);
    emitProgress('undoing', item.sourcePath, true);
  }

  journal.completedAt = Date.now();
  await finalizeJournal(context, journal);
  emitProgress(cancelled ? 'cancelled' : 'complete', undefined, true);
  return resultFromJournal(journal, results, 'undo', cancelled, false);
}
