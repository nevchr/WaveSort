import { CATEGORY_DEFINITIONS } from './categories';
import { containsCue, normalizeCue } from './alias-rules';
import { familyLabel, formLabel } from './taxonomy';
import type { CategoryDefinition, CategoryId, ClassificationResult, SoundFamily, SoundForm } from './types';

interface CueScore {
  score: number;
  matched: string[];
  location: string[];
}

interface FormDefinition {
  form: SoundForm;
  aliases: string[];
  priority: number;
}

const FORM_DEFINITIONS: FormDefinition[] = [
  { form: 'one-shot', aliases: ['oneshot', 'oneshots', 'one shot', 'one shots', 'one-shot', 'one-shots'], priority: 100 },
  { form: 'loop', aliases: ['loop', 'loops', 'drum loop', 'melody loop'], priority: 92 },
  { form: 'stem', aliases: ['stem', 'stems', 'dry stem', 'wet stem'], priority: 82 },
  { form: 'texture', aliases: ['texture', 'textures', 'ambience', 'ambience bed', 'atmosphere', 'atmos'], priority: 72 },
];

const normalize = normalizeCue;
const containsTerm = containsCue;

function pathSegments(relativePath: string): string[] {
  return relativePath
    .split(/[\\/]/g)
    .map(normalize)
    .filter(Boolean);
}

function scoreAliases(aliases: string[], normalizedPath: string, normalizedName: string, segments: string[]): CueScore {
  let score = 0;
  const matched: string[] = [];
  const location: string[] = [];

  for (const alias of aliases) {
    const normalizedAlias = normalize(alias);
    if (!normalizedAlias) continue;
    const nameMatch = containsTerm(normalizedName, normalizedAlias);
    const pathMatch = containsTerm(normalizedPath, normalizedAlias);
    const segmentMatch = segments.some((segment) => segment === normalizedAlias);

    if (nameMatch) {
      score += 17 + Math.min(normalizedAlias.length, 10);
      matched.push(alias);
      location.push('filename');
    } else if (pathMatch) {
      score += 9 + Math.min(normalizedAlias.length, 8);
      matched.push(alias);
      location.push('folder or path');
    }

    if (segmentMatch) {
      score += 22 + Math.min(normalizedAlias.length, 10);
      if (!matched.includes(alias)) matched.push(alias);
      if (!location.includes('folder')) location.push('folder');
    }
  }

  return { score, matched, location };
}

function refineFamily(category: CategoryDefinition, matches: string[]): SoundFamily {
  if (category.id === 'vox' && matches.some((match) => ['chant', 'chants', 'choir'].includes(normalize(match)))) return 'chant';
  if (category.id === 'percs' && matches.some((match) => normalize(match).startsWith('rim'))) return 'rim';
  return category.family;
}

function scoreForm(normalizedPath: string, normalizedName: string, segments: string[]): Array<FormDefinition & CueScore> {
  return FORM_DEFINITIONS
    .map((definition) => ({ ...definition, ...scoreAliases(definition.aliases, normalizedPath, normalizedName, segments) }))
    .sort((a, b) => (b.score - a.score) || (b.priority - a.priority));
}

export function classifyAudioFile(relativePath: string, fileName = relativePath.split(/[\\/]/g).pop() ?? relativePath): ClassificationResult {
  const normalizedPath = normalize(relativePath.replace(/[\\/]/g, ' '));
  const normalizedName = normalize(fileName);
  const segments = pathSegments(relativePath);

  const scored = CATEGORY_DEFINITIONS
    .filter((category) => category.id !== 'other')
    .map((category) => ({ category, ...scoreAliases(category.aliases, normalizedPath, normalizedName, segments) }))
    .sort((a, b) => (b.score - a.score) || (b.category.priority - a.category.priority));

  const familyScored = scored.filter((candidate) => candidate.category.id !== 'oneshots' && candidate.category.id !== 'loops');
  const winner = scored[0];
  const familyWinner = familyScored[0];
  const forms = scoreForm(normalizedPath, normalizedName, segments);
  const formWinner = forms[0];

  if (!winner || winner.score === 0) {
    const inferredForm = formWinner?.score ? formWinner.form : 'unknown';
    return {
      category: inferredForm === 'one-shot' ? 'oneshots' : inferredForm === 'loop' ? 'loops' : 'other',
      family: 'unknown',
      form: inferredForm,
      confidence: inferredForm === 'unknown' ? 0.14 : 0.45,
      reason: inferredForm === 'unknown'
        ? 'No clear category cue found; review this file before sorting.'
        : `Detected a ${formLabel(inferredForm).toLowerCase()} form, but no clear sound family; review this file before sorting.`,
      tags: inferredForm === 'unknown' ? [] : [`form:${inferredForm}`],
    };
  }

  const uniqueMatches = [...new Set(winner.matched)].slice(0, 2);
  const family = familyWinner && familyWinner.score > 0 ? refineFamily(familyWinner.category, familyWinner.matched) : 'unknown';
  const form = formWinner && formWinner.score > 0 ? formWinner.form : winner.category.id === 'oneshots' ? 'one-shot' : winner.category.id === 'loops' ? 'loop' : 'unknown';
  const confidence = Math.max(0.42, Math.min(0.99, 0.38 + winner.score / 105));
  const cue = uniqueMatches.length ? uniqueMatches.map((match) => `“${match}”`).join(', ') : 'a matching folder';
  const where = winner.location.includes('filename') ? 'the filename' : winner.location.includes('folder') ? 'the folder name' : 'the path';
  const familyCue = familyWinner && familyWinner.score > 0 && familyWinner.category.id !== winner.category.id
    ? ` Sound family: ${familyLabel(family)} from ${familyWinner.matched.slice(0, 2).map((match) => `“${match}”`).join(', ')}.`
    : '';
  const formCue = form !== 'unknown' ? ` Form: ${formLabel(form)}.` : '';
  const tags = [
    ...scored
      .filter((candidate) => candidate.score > 0 && candidate.category.id !== winner.category.id)
      .slice(0, 2)
      .map((candidate) => candidate.category.id),
    ...(form !== 'unknown' ? [`form:${form}`] : []),
    ...(family !== 'unknown' ? [`family:${family}`] : []),
  ];

  return {
    category: winner.category.id as CategoryId,
    family,
    form,
    confidence,
    reason: `Matched ${cue} in ${where}.${familyCue}${formCue}`,
    tags,
  };
}

export function isAudioFile(fileName: string): boolean {
  return /\.(wav|mp3|flac|aif|aiff|m4a|ogg|opus|aac|wma)$/i.test(fileName);
}
