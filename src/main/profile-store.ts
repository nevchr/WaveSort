import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CATEGORY_BY_ID } from '../shared/categories';
import { normalizeCue, validateAliasRule } from '../shared/alias-rules';
import type { AliasRule, CategoryId, ReviewProfile, VerifiedLabel, WaveSortSettings } from '../shared/types';

export const DEFAULT_SETTINGS: WaveSortSettings = {
  accentColor: '#d9ad6b',
};

interface ProfileRoot {
  corrections: Record<string, CategoryId>;
  aliasRules?: AliasRule[];
  verifiedLabels?: Record<string, VerifiedLabel>;
}

interface ProfileDocument {
  version: 1;
  settings?: WaveSortSettings;
  roots: Record<string, ProfileRoot>;
}

let profileWriteQueue: Promise<void> = Promise.resolve();

function queueProfileWrite(task: () => Promise<void>): Promise<void> {
  const next = profileWriteQueue.then(task, task);
  profileWriteQueue = next.catch(() => undefined);
  return next;
}

function rootKey(root: string): string {
  return path.resolve(root).toLowerCase();
}

function validCategory(value: unknown): value is CategoryId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_BY_ID, value);
}

function relativeKey(relativePath: string): string {
  const normalized = path.normalize(relativePath);
  if (!normalized || path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error('The correction path is invalid.');
  }
  return normalized;
}

async function readDocument(profilePath: string): Promise<ProfileDocument> {
  try {
    const parsed = JSON.parse(await fs.readFile(profilePath, 'utf8')) as ProfileDocument;
    if (parsed.version === 1 && parsed.roots && typeof parsed.roots === 'object') return parsed;
  } catch {
    // A missing or corrupt local profile is treated as an empty profile.
  }
  return { version: 1, roots: {} };
}

async function writeDocument(profilePath: string, document: ProfileDocument): Promise<void> {
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  const temporaryPath = `${profilePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(document, null, 2), 'utf8');
    await fs.rename(temporaryPath, profilePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function readCorrections(profilePath: string, root: string): Promise<Record<string, CategoryId>> {
  const document = await readDocument(profilePath);
  const saved = document.roots[rootKey(root)]?.corrections;
  if (!saved || typeof saved !== 'object') return {};
  return Object.fromEntries(
    Object.entries(saved).filter(([relativePath, category]) => {
      try {
        relativeKey(relativePath);
        return validCategory(category);
      } catch {
        return false;
      }
    }),
  ) as Record<string, CategoryId>;
}

export async function saveCorrection(profilePath: string, root: string, relativePath: string, category: CategoryId): Promise<void> {
  if (!validCategory(category)) throw new Error('The correction category is invalid.');
  await queueProfileWrite(async () => {
    const document = await readDocument(profilePath);
    const key = rootKey(root);
    const rootProfile = document.roots[key] ?? { corrections: {} };
    rootProfile.corrections[relativeKey(relativePath)] = category;
    document.roots[key] = rootProfile;
    await writeDocument(profilePath, document);
  });
}

export async function readReviewProfile(profilePath: string, root: string): Promise<ReviewProfile> {
  const document = await readDocument(profilePath);
  const saved = document.roots[rootKey(root)];
  const aliasRules: AliasRule[] = [];
  for (const rawRule of Array.isArray(saved?.aliasRules) ? saved.aliasRules.slice(0, 100) : []) {
    try {
      const rule = validateAliasRule(rawRule);
      if (!aliasRules.some((existing) => existing.term === rule.term)) aliasRules.push(rule);
    } catch { /* Ignore corrupt profile entries. */ }
  }
  const verifiedLabels = Object.fromEntries(
    Object.entries(saved?.verifiedLabels ?? {}).filter(([relativePath, label]) => {
      try { relativeKey(relativePath); return validCategory(label?.category) && /^[a-f0-9]{64}$/i.test(label?.fingerprint ?? ''); } catch { return false; }
    }),
  ) as Record<string, VerifiedLabel>;
  return { aliasRules, verifiedLabels };
}

export async function saveAliasRule(profilePath: string, root: string, input: AliasRule): Promise<void> {
  const rule = validateAliasRule(input);
  await queueProfileWrite(async () => {
    const document = await readDocument(profilePath);
    const key = rootKey(root);
    const rootProfile = document.roots[key] ?? { corrections: {} };
    const prior = (Array.isArray(rootProfile.aliasRules) ? rootProfile.aliasRules : []).filter((existing) => {
      try { return validateAliasRule(existing).term !== rule.term; } catch { return false; }
    });
    if (prior.length >= 100) throw new Error('This library has reached the 100-rule limit. Remove an old rule first.');
    rootProfile.aliasRules = [rule, ...prior];
    document.roots[key] = rootProfile;
    await writeDocument(profilePath, document);
  });
}

export async function deleteAliasRule(profilePath: string, root: string, term: string): Promise<void> {
  if (typeof term !== 'string' || !term.trim() || term.length > 32) throw new Error('The library rule is invalid.');
  await queueProfileWrite(async () => {
    const document = await readDocument(profilePath);
    const key = rootKey(root);
    const rootProfile = document.roots[key];
    if (!rootProfile) return;
    rootProfile.aliasRules = (Array.isArray(rootProfile.aliasRules) ? rootProfile.aliasRules : [])
      .filter((rule) => { try { return validateAliasRule(rule).term !== normalizeCue(term); } catch { return false; } });
    await writeDocument(profilePath, document);
  });
}

export async function saveVerifiedLabel(profilePath: string, root: string, relativePath: string, label: VerifiedLabel): Promise<void> {
  if (!validCategory(label.category) || !/^[a-f0-9]{64}$/i.test(label.fingerprint)) throw new Error('The verified label is invalid.');
  await queueProfileWrite(async () => {
    const document = await readDocument(profilePath);
    const key = rootKey(root);
    const rootProfile = document.roots[key] ?? { corrections: {} };
    rootProfile.verifiedLabels ??= {};
    rootProfile.verifiedLabels[relativeKey(relativePath)] = label;
    document.roots[key] = rootProfile;
    await writeDocument(profilePath, document);
  });
}

export async function deleteVerifiedLabel(profilePath: string, root: string, relativePath: string): Promise<void> {
  await queueProfileWrite(async () => {
    const document = await readDocument(profilePath);
    const saved = document.roots[rootKey(root)]?.verifiedLabels;
    if (!saved) return;
    delete saved[relativeKey(relativePath)];
    await writeDocument(profilePath, document);
  });
}

function validAccentColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export async function readSettings(profilePath: string): Promise<WaveSortSettings> {
  const document = await readDocument(profilePath);
  return validAccentColor(document.settings?.accentColor)
    ? { accentColor: document.settings.accentColor.toLowerCase() }
    : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(profilePath: string, settings: WaveSortSettings): Promise<void> {
  if (!validAccentColor(settings.accentColor)) throw new Error('The accent color is invalid.');
  await queueProfileWrite(async () => {
    const document = await readDocument(profilePath);
    document.settings = { accentColor: settings.accentColor.toLowerCase() };
    await writeDocument(profilePath, document);
  });
}
