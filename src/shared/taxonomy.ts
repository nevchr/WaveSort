import { CATEGORY_BY_ID, categoryLabel } from './categories';
import type { CategoryId, SoundFamily, SoundForm } from './types';

const FAMILY_LABELS: Record<SoundFamily, string> = {
  '808': '808s',
  bass: 'Bass',
  kick: 'Kicks',
  snare: 'Snares',
  clap: 'Claps',
  'closed-hat': 'Hi-hats',
  'open-hat': 'Open Hats',
  perc: 'Percs',
  rim: 'Rims',
  tom: 'Toms',
  cymbal: 'Cymbals',
  vox: 'Vox',
  chant: 'Chants',
  fx: 'FX',
  riser: 'Risers',
  melody: 'Melodies',
  instrument: 'Instruments',
  'drum-kit': 'Drum Kits',
  unknown: 'Review',
};

const FORM_LABELS: Record<SoundForm, string> = {
  'one-shot': 'One-shot',
  loop: 'Loop',
  stem: 'Stem',
  texture: 'Texture',
  unknown: 'Unspecified',
};

export function familyForCategory(category: CategoryId): SoundFamily {
  return CATEGORY_BY_ID[category]?.family ?? 'unknown';
}

export function familyLabel(family: SoundFamily): string {
  return FAMILY_LABELS[family];
}

export function formLabel(form: SoundForm): string {
  return FORM_LABELS[form];
}

export function destinationSegments(category: CategoryId, family: SoundFamily, form: SoundForm): string[] {
  const familyFolder = family === 'unknown' ? categoryLabel(category) : familyLabel(family);
  if (form === 'one-shot') return ['One-Shots', familyFolder];
  if (form === 'loop') return ['Loops', familyFolder];
  if (form === 'stem') return ['Stems', familyFolder];
  if (form === 'texture') return ['Textures', familyFolder];
  return [categoryLabel(category)];
}

export function destinationLabel(category: CategoryId, family: SoundFamily, form: SoundForm): string {
  return destinationSegments(category, family, form).join(' / ');
}
