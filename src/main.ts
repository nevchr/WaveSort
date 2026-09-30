import { app, BrowserWindow, dialog, protocol, shell, ipcMain } from 'electron';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { isAudioFile } from './shared/classifier';
import { CATEGORY_BY_ID } from './shared/categories';
import { validateAliasRule } from './shared/alias-rules';
import { familyForCategory } from './shared/taxonomy';
import { buildSortPlan, executeSortPlan, resumeSortOperation, undoSortOperation } from './main/file-operations';
import { deleteAliasRule, deleteVerifiedLabel, readCorrections, readReviewProfile, readSettings, saveAliasRule, saveCorrection, saveSettings, saveVerifiedLabel } from './main/profile-store';
import { scanDirectory } from './main/scanner';
import { suggestSoundName } from './main/sound-name';
import { fastFingerprint } from './main/fingerprint';
import type { IpcMainInvokeEvent } from 'electron';
import type { AudioFileEntry, CategoryId, SortPlan, SortRequest } from './shared/types';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wavesort-audio',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

let mainWindow: BrowserWindow | null = null;
let currentRoot: string | null = null;
let currentEntries = new Map<string, AudioFileEntry>();
let currentScanComplete = false;
let activeScanAbortController: AbortController | null = null;
let activeOperationAbortController: AbortController | null = null;
const activePlans = new Map<string, SortPlan>();

function isWithin(parent: string, candidate: string): boolean {
  const normalizedParent = path.resolve(parent).toLowerCase();
  const normalizedCandidate = path.resolve(candidate).toLowerCase();
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

async function canonicalPathWithin(parent: string, candidate: string): Promise<string | null> {
  try {
    const [canonicalParent, canonicalCandidate] = await Promise.all([fs.realpath(parent), fs.realpath(candidate)]);
    return isWithin(canonicalParent, canonicalCandidate) ? canonicalCandidate : null;
  } catch {
    return null;
  }
}

function parseByteRange(value: string | null, size: number): { start: number; end: number } | null | 'invalid' {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid';
    start = Math.max(0, size - suffixLength);
    end = Math.max(0, size - 1);
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || size === 0 || start < 0 || start >= size || end < start) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

function mimeTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.wav': return 'audio/wav';
    case '.mp3': return 'audio/mpeg';
    case '.flac': return 'audio/flac';
    case '.aif':
    case '.aiff': return 'audio/aiff';
    case '.m4a': return 'audio/mp4';
    case '.ogg': return 'audio/ogg';
    case '.opus': return 'audio/opus';
    case '.aac': return 'audio/aac';
    case '.wma': return 'audio/x-ms-wma';
    default: return 'application/octet-stream';
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url ?? '';
  const trusted = process.argv.includes('--dev-server')
    ? senderUrl.startsWith('http://localhost:5173')
    : senderUrl.startsWith('file://');
  if (!trusted) throw new Error('This request did not come from the WaveSort application window.');
}

function textInput(value: unknown, label: string, maxLength = 32_768): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(`${label} is invalid.`);
  return value.trim();
}

function validateScanInput(value: unknown): string {
  return textInput(value, 'The source folder');
}

function validateSortRequest(value: unknown): SortRequest {
  if (!value || typeof value !== 'object') throw new Error('The sort request is invalid.');
  const input = value as Record<string, unknown>;
  const operation = input.operation;
  if (operation !== 'copy' && operation !== 'move') throw new Error('The sort operation is invalid.');
  if (!Array.isArray(input.entryIds) || input.entryIds.length === 0 || input.entryIds.length > 100_000 || input.entryIds.some((entryId) => typeof entryId !== 'string' || entryId.length > 512)) {
    throw new Error('The selected file list is invalid.');
  }

  const overrides: Partial<Record<string, CategoryId>> = {};
  if (input.overrides !== undefined) {
    if (!input.overrides || typeof input.overrides !== 'object' || Array.isArray(input.overrides)) throw new Error('The category overrides are invalid.');
    for (const [entryId, category] of Object.entries(input.overrides as Record<string, unknown>)) {
      if (entryId.length > 512 || typeof category !== 'string' || !Object.prototype.hasOwnProperty.call(CATEGORY_BY_ID, category)) throw new Error('The category overrides are invalid.');
      overrides[entryId] = category as CategoryId;
    }
  }

  const nameOverrides: Record<string, string> = {};
  if (input.nameOverrides !== undefined) {
    if (!input.nameOverrides || typeof input.nameOverrides !== 'object' || Array.isArray(input.nameOverrides)) throw new Error('The filename overrides are invalid.');
    const selected = new Set(input.entryIds as string[]);
    for (const [entryId, name] of Object.entries(input.nameOverrides as Record<string, unknown>)) {
      if (!selected.has(entryId) || typeof name !== 'string' || name.length > 180) throw new Error('The filename overrides are invalid.');
      nameOverrides[entryId] = name;
    }
  }

  return {
    entryIds: [...new Set(input.entryIds as string[])],
    operation,
    destination: textInput(input.destination, 'The destination folder'),
    overrides,
    nameOverrides,
  };
}

function validateId(value: unknown, label: string): string {
  return textInput(value, label, 128);
}

function operationContext() {
  if (!currentRoot || !currentScanComplete) throw new Error('Complete a scan before sorting.');
  return {
    root: currentRoot,
    entries: currentEntries,
    journalDirectory: path.join(app.getPath('userData'), 'operations'),
  };
}

function profilePath(): string {
  return path.join(app.getPath('userData'), 'profile.json');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: '#070809',
    title: 'WaveSort',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.argv.includes('--dev-server')) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173');
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  protocol.handle('wavesort-audio', async (request) => {
    const requestedPath = new URL(request.url).searchParams.get('path');
    if (!requestedPath || !currentRoot) return new Response('Not found', { status: 404 });
    const absolutePath = await canonicalPathWithin(currentRoot, path.resolve(requestedPath));
    if (!absolutePath || !isAudioFile(absolutePath)) return new Response('Forbidden', { status: 403 });
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isFile()) return new Response('Not found', { status: 404 });
      const range = parseByteRange(request.headers.get('range'), stats.size);
      const commonHeaders = {
        'Content-Type': mimeTypeFor(absolutePath),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      };
      if (range === 'invalid') {
        return new Response(null, {
          status: 416,
          headers: { ...commonHeaders, 'Content-Range': `bytes */${stats.size}` },
        });
      }
      if (range) {
        const contentLength = range.end - range.start + 1;
        return new Response(Readable.toWeb(createReadStream(absolutePath, { start: range.start, end: range.end })) as unknown as BodyInit, {
          status: 206,
          headers: {
            ...commonHeaders,
            'Content-Length': String(contentLength),
            'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`,
          },
        });
      }
      return new Response(Readable.toWeb(createReadStream(absolutePath)) as unknown as BodyInit, {
        headers: { ...commonHeaders, 'Content-Length': String(stats.size) },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  ipcMain.handle('dialog:pick-directory', async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('scan:directory', async (event, root: unknown) => {
    assertTrustedSender(event);
    if (activeOperationAbortController) throw new Error('Finish or cancel the current file operation before scanning again.');
    activeScanAbortController?.abort();
    const controller = new AbortController();
    activeScanAbortController = controller;
    currentRoot = null;
    currentEntries = new Map();
    currentScanComplete = false;
    activePlans.clear();
    const scanId = randomUUID();
    try {
      const requestedRoot = validateScanInput(root);
      const canonicalRoot = await fs.realpath(requestedRoot).catch(() => requestedRoot);
      const [corrections, reviewProfile] = await Promise.all([
        readCorrections(profilePath(), canonicalRoot),
        readReviewProfile(profilePath(), canonicalRoot),
      ]);
      const result = await scanDirectory(requestedRoot, {
        scanId,
        signal: controller.signal,
        cachePath: path.join(app.getPath('userData'), 'scan-cache.json'),
        corrections,
        aliasRules: reviewProfile.aliasRules,
        onProgress: (progress) => event.sender.send('scan:progress', progress),
      });
      currentRoot = result.root;
      currentEntries = new Map(result.entries.map((entry) => [entry.id, entry]));
      currentScanComplete = result.complete;
      return result;
    } finally {
      if (activeScanAbortController === controller) activeScanAbortController = null;
    }
  });
  ipcMain.handle('scan:cancel', (event) => {
    assertTrustedSender(event);
    if (!activeScanAbortController) return false;
    activeScanAbortController.abort();
    return true;
  });
  ipcMain.handle('sort:plan', async (event, rawRequest: unknown) => {
    assertTrustedSender(event);
    const plan = await buildSortPlan(validateSortRequest(rawRequest), operationContext());
    activePlans.set(plan.planId, plan);
    return plan;
  });
  ipcMain.handle('sort:execute', async (event, rawPlanId: unknown) => {
    assertTrustedSender(event);
    if (activeOperationAbortController) throw new Error('Another file operation is already running.');
    const planId = validateId(rawPlanId, 'The sort plan ID');
    const plan = activePlans.get(planId);
    if (!plan) throw new Error('That sort plan is no longer available. Build a new plan.');
    const controller = new AbortController();
    activeOperationAbortController = controller;
    try {
      const result = await executeSortPlan(plan, operationContext(), (progress) => event.sender.send('sort:progress', progress), controller.signal);
      if (plan.operation === 'move') {
        for (const item of result.items) {
          if (item.status === 'processed') currentEntries.delete(item.entryId);
        }
      }
      activePlans.delete(planId);
      return result;
    } finally {
      if (activeOperationAbortController === controller) activeOperationAbortController = null;
    }
  });
  ipcMain.handle('sort:resume', async (event, rawOperationId: unknown, rawRetryFailed: unknown) => {
    assertTrustedSender(event);
    if (activeOperationAbortController) throw new Error('Another file operation is already running.');
    const operationId = validateId(rawOperationId, 'The operation ID');
    if (rawRetryFailed !== undefined && typeof rawRetryFailed !== 'boolean') throw new Error('The retry option is invalid.');
    const controller = new AbortController();
    activeOperationAbortController = controller;
    try {
      const result = await resumeSortOperation(operationId, operationContext(), rawRetryFailed === true, (progress) => event.sender.send('sort:progress', progress), controller.signal);
      if (result.operation === 'move') {
        for (const item of result.items) {
          if (item.status === 'processed') currentEntries.delete(item.entryId);
        }
      }
      return result;
    } finally {
      if (activeOperationAbortController === controller) activeOperationAbortController = null;
    }
  });
  ipcMain.handle('sort:cancel', (event) => {
    assertTrustedSender(event);
    if (!activeOperationAbortController) return false;
    activeOperationAbortController.abort();
    return true;
  });
  ipcMain.handle('profile:save-correction', async (event, rawEntryId: unknown, rawCategory: unknown) => {
    assertTrustedSender(event);
    if (!currentRoot || !currentScanComplete) throw new Error('Complete a scan before saving a correction.');
    const entryId = validateId(rawEntryId, 'The file ID');
    if (typeof rawCategory !== 'string' || !Object.prototype.hasOwnProperty.call(CATEGORY_BY_ID, rawCategory)) throw new Error('The correction category is invalid.');
    const entry = currentEntries.get(entryId);
    if (!entry) throw new Error('That file is no longer part of the current scan.');
    await saveCorrection(profilePath(), currentRoot, entry.relativePath, rawCategory as CategoryId);
    return true;
  });
  ipcMain.handle('profile:get-review', async (event) => {
    assertTrustedSender(event);
    if (!currentRoot) throw new Error('Scan a source folder before opening its review profile.');
    return readReviewProfile(profilePath(), currentRoot);
  });
  ipcMain.handle('profile:save-alias', async (event, rawRule: unknown) => {
    assertTrustedSender(event);
    if (!currentRoot || !currentScanComplete || activeScanAbortController || activeOperationAbortController) throw new Error('Complete the scan before editing library rules.');
    await saveAliasRule(profilePath(), currentRoot, validateAliasRule(rawRule));
    return true;
  });
  ipcMain.handle('profile:delete-alias', async (event, rawTerm: unknown) => {
    assertTrustedSender(event);
    if (!currentRoot || !currentScanComplete || activeScanAbortController || activeOperationAbortController) throw new Error('Complete the scan before editing library rules.');
    await deleteAliasRule(profilePath(), currentRoot, textInput(rawTerm, 'The library rule', 32));
    return true;
  });
  ipcMain.handle('profile:save-label', async (event, rawEntryId: unknown, rawCategory: unknown) => {
    assertTrustedSender(event);
    if (!currentRoot || !currentScanComplete || activeScanAbortController || activeOperationAbortController) throw new Error('Complete the scan before verifying labels.');
    const entry = currentEntries.get(validateId(rawEntryId, 'The file ID'));
    if (!entry) throw new Error('That file is no longer part of the current scan.');
    if (typeof rawCategory !== 'string' || !Object.prototype.hasOwnProperty.call(CATEGORY_BY_ID, rawCategory)) throw new Error('The verified category is invalid.');
    const canonical = await canonicalPathWithin(currentRoot, entry.absolutePath);
    if (!canonical || canonical !== entry.absolutePath) throw new Error('The source path changed after scanning. Rescan before verifying its type.');
    const stats = await fs.lstat(entry.absolutePath).catch(() => null);
    if (!stats?.isFile() || stats.isSymbolicLink() || stats.size !== entry.size || Math.abs(stats.mtimeMs - entry.modifiedAt) > 1
      || !entry.fingerprint || await fastFingerprint(entry.absolutePath, stats) !== entry.fingerprint) {
      throw new Error('The source changed after scanning. Rescan before verifying its type.');
    }
    await saveVerifiedLabel(profilePath(), currentRoot, entry.relativePath, { category: rawCategory as CategoryId, fingerprint: entry.fingerprint });
    return true;
  });
  ipcMain.handle('profile:delete-label', async (event, rawEntryId: unknown) => {
    assertTrustedSender(event);
    if (!currentRoot || !currentScanComplete) throw new Error('Complete the scan before editing verified labels.');
    const entry = currentEntries.get(validateId(rawEntryId, 'The file ID'));
    if (!entry) throw new Error('That file is no longer part of the current scan.');
    await deleteVerifiedLabel(profilePath(), currentRoot, entry.relativePath);
    return true;
  });
  ipcMain.handle('settings:get', async (event) => {
    assertTrustedSender(event);
    return readSettings(profilePath());
  });
  ipcMain.handle('settings:save', async (event, rawSettings: unknown) => {
    assertTrustedSender(event);
    if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) throw new Error('The settings are invalid.');
    const accentColor = (rawSettings as Record<string, unknown>).accentColor;
    if (typeof accentColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(accentColor)) throw new Error('Choose a valid six-digit accent color.');
    await saveSettings(profilePath(), { accentColor });
    return true;
  });
  ipcMain.handle('report:open', async (event, rawOperationId: unknown) => {
    assertTrustedSender(event);
    const operationId = validateId(rawOperationId, 'The operation ID');
    const reportPath = path.join(app.getPath('userData'), 'operations', `${operationId}.json`);
    try {
      await fs.access(reportPath);
    } catch {
      throw new Error('The operation report is no longer available.');
    }
    return shell.openPath(reportPath);
  });
  ipcMain.handle('sort:undo', async (event, rawOperationId: unknown) => {
    assertTrustedSender(event);
    if (activeOperationAbortController) throw new Error('Another file operation is already running.');
    const controller = new AbortController();
    activeOperationAbortController = controller;
    try {
      return await undoSortOperation(validateId(rawOperationId, 'The operation ID'), operationContext(), (progress) => event.sender.send('sort:progress', progress), controller.signal);
    } finally {
      if (activeOperationAbortController === controller) activeOperationAbortController = null;
    }
  });
  ipcMain.handle('audio:url', (event, rawPath: unknown) => {
    assertTrustedSender(event);
    if (typeof rawPath !== 'string' || !currentRoot) return null;
    return canonicalPathWithin(currentRoot, rawPath).then((canonicalPath) => {
      if (!canonicalPath || !isAudioFile(canonicalPath)) return null;
      return `wavesort-audio://preview?path=${encodeURIComponent(canonicalPath)}`;
    });
  });
  ipcMain.handle('audio:suggest-name', async (event, rawEntryId: unknown, rawCategory: unknown) => {
    assertTrustedSender(event);
    if (!currentRoot || !currentScanComplete || activeScanAbortController || activeOperationAbortController) {
      throw new Error('Complete the scan or file operation before analyzing a sound.');
    }
    const entryId = validateId(rawEntryId, 'The file ID');
    const entry = currentEntries.get(entryId);
    if (!entry) throw new Error('That file is no longer part of the current scan.');
    if (typeof rawCategory !== 'string' || !Object.prototype.hasOwnProperty.call(CATEGORY_BY_ID, rawCategory)) throw new Error('The review category is invalid.');
    const category = rawCategory as CategoryId;
    const canonical = await canonicalPathWithin(currentRoot, entry.absolutePath);
    if (!canonical || canonical !== entry.absolutePath) return { status: 'unavailable', reason: 'The source path changed. Rescan the folder.' };
    const stats = await fs.lstat(canonical).catch(() => null);
    if (!stats?.isFile() || stats.isSymbolicLink() || stats.size !== entry.size || Math.abs(stats.mtimeMs - entry.modifiedAt) > 1) {
      return { status: 'unavailable', reason: 'The file changed after scanning. Rescan it first.' };
    }
    if (entry.fingerprint && await fastFingerprint(canonical, stats) !== entry.fingerprint) {
      return { status: 'unavailable', reason: 'The file content changed after scanning. Rescan it first.' };
    }
    return suggestSoundName({
      ...entry,
      category,
      family: category === 'oneshots' || category === 'loops' ? entry.family : familyForCategory(category),
      form: category === 'loops' ? 'loop' : category === 'oneshots' ? 'one-shot' : entry.form,
    });
  });
  ipcMain.handle('shell:open-source-folder', async (event) => {
    assertTrustedSender(event);
    if (!currentRoot) throw new Error('Scan a source folder before opening it.');
    const canonicalPath = await canonicalPathWithin(currentRoot, currentRoot);
    if (!canonicalPath) throw new Error('The scanned source folder is no longer available.');
    return shell.openPath(canonicalPath);
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
