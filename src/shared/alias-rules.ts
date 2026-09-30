import { CATEGORY_BY_ID } from './categories';
import { familyForCategory } from './taxonomy';
import type { AliasRule, CategoryId, ClassificationResult } from './types';

export function normalizeCue(value: string): string {
  return value.normalize('NFKD').toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function containsCue(text: string, term: string): boolean {
  const cue = normalizeCue(term);
  return !!cue && (` ${text} `).includes(` ${cue} `);
}

export function validateAliasRule(value: unknown): AliasRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The library rule is invalid.');
  const input = value as Record<string, unknown>;
  const term = typeof input.term === 'string' ? input.term.trim() : '';
  if (term.length < 2 || term.length > 32
    || !/^[a-z0-9][a-z0-9 _-]*$/i.test(term) || !normalizeCue(term)) {
    throw new Error('Use a 2–32 character literal alias with letters, numbers, spaces, hyphens, or underscores.');
  }
  if (typeof input.category !== 'string' || !Object.prototype.hasOwnProperty.call(CATEGORY_BY_ID, input.category)) {
    throw new Error('Choose a valid category for the library rule.');
  }
  return { term: normalizeCue(term), category: input.category as CategoryId };
}

export function matchAliasRule(fileName: string, rules: readonly AliasRule[]): AliasRule | undefined {
  const normalizedName = normalizeCue(fileName.replace(/\.[^.]+$/, ''));
  return rules.find((rule) => containsCue(normalizedName, rule.term));
}

export function applyAliasRules(base: ClassificationResult, fileName: string, rules: readonly AliasRule[]): ClassificationResult {
  const rule = matchAliasRule(fileName, rules);
  if (!rule) return base;
  return {
    ...base,
    category: rule.category,
    family: rule.category === 'oneshots' || rule.category === 'loops' ? base.family : familyForCategory(rule.category),
    form: rule.category === 'oneshots' ? 'one-shot' : rule.category === 'loops' ? 'loop' : base.form,
    confidence: 0.95,
    reason: `Library alias “${rule.term}” matched the filename.`,
    tags: [...new Set([...base.tags, 'library-rule'])],
  };
}
