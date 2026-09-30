import type { CategoryDefinition, CategoryId } from './types';

export const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  { id: '808s', family: '808', label: '808s', aliases: ['808', '808s', '808 bass'], color: '#f2a65a', priority: 96 },
  { id: 'bass', family: 'bass', label: 'Bass', aliases: ['bass', 'sub', 'sub bass', 'subbass'], color: '#e58c7b', priority: 88 },
  { id: 'kicks', family: 'kick', label: 'Kicks', aliases: ['kick', 'kicks'], color: '#db6b77', priority: 96 },
  { id: 'snares', family: 'snare', label: 'Snares', aliases: ['snare', 'snares', 'a snare', 'a snares'], color: '#d982b5', priority: 96 },
  { id: 'claps', family: 'clap', label: 'Claps', aliases: ['clap', 'claps', 'klap'], color: '#b78ad8', priority: 94 },
  { id: 'hihats', family: 'closed-hat', label: 'Hi-hats', aliases: ['hihat', 'hi hat', 'hihats', 'hi hats', 'hhat', 'hhats', 'closed hat', 'closed hats', 'closedhat', 'closedhats', 'c hat', 'hh', 'hat', 'hats'], color: '#62b9c7', priority: 90 },
  { id: 'open-hats', family: 'open-hat', label: 'Open Hats', aliases: ['open hat', 'open hats', 'openhat', 'openhats', 'openhh', 'open hh', 'o hat', 'o hats', 'ohat', 'ohats', 'oh'], color: '#43a8b9', priority: 98 },
  { id: 'percs', family: 'perc', label: 'Percs', aliases: ['perc', 'percs', 'percussion', 'percussions', 'shaker', 'shakers', 'rim', 'rims', 'rim shot', 'rimshots', 'rim shots', 'triangle'], color: '#68b883', priority: 90 },
  { id: 'toms', family: 'tom', label: 'Toms', aliases: ['tom', 'toms'], color: '#78aa70', priority: 92 },
  { id: 'cymbals', family: 'cymbal', label: 'Cymbals', aliases: ['cymbal', 'cymbals', 'crash', 'crashes', 'ride'], color: '#a8b55f', priority: 90 },
  { id: 'vox', family: 'vox', label: 'Vox', aliases: ['vox', 'vocal', 'vocals', 'voice', 'voices', 'adlib', 'adlibs', 'chant', 'chants', 'choir', 'spoken'], color: '#e2c56c', priority: 95 },
  { id: 'oneshots', family: 'unknown', label: 'One-shots', aliases: ['oneshot', 'oneshots', 'one shot', 'one shots', 'one-shot', 'one-shots'], color: '#e79a5f', priority: 99 },
  { id: 'loops', family: 'unknown', label: 'Loops', aliases: ['loop', 'loops', 'drum loop', 'melody loop'], color: '#8ea5d6', priority: 93 },
  { id: 'melodies', family: 'melody', label: 'Melodies', aliases: ['melody', 'melodies', 'melo', 'mel', 'chord', 'chords', 'mels'], color: '#8497cf', priority: 88 },
  { id: 'fx', family: 'fx', label: 'FX', aliases: ['fx', 'fxs', 'sfx', 's f x', 'sound effect', 'sound effects', 'impact', 'impacts', 'texture', 'textures', 'downlifter', 'downlifters'], color: '#6d88b8', priority: 92 },
  { id: 'risers', family: 'riser', label: 'Risers', aliases: ['riser', 'risers', 'uplifter', 'uplifters', 'build', 'builds'], color: '#7a75ba', priority: 93 },
  { id: 'instruments', family: 'instrument', label: 'Instruments', aliases: ['instrument', 'instruments', 'piano', 'pianos', 'guitar', 'guitars', 'organ', 'organs', 'brass', 'strings', 'string', 'synth', 'synths', 'lead', 'leads', 'pad', 'pads', 'pluck', 'plucks'], color: '#aa83b5', priority: 80 },
  { id: 'drums', family: 'drum-kit', label: 'Drums', aliases: ['drum', 'drums', 'drum kit', 'drumkit'], color: '#77828d', priority: 64 },
  { id: 'other', family: 'unknown', label: 'Review', aliases: [], color: '#6d7783', priority: 1 },
];

export const CATEGORY_BY_ID = Object.fromEntries(
  CATEGORY_DEFINITIONS.map((category) => [category.id, category]),
) as Record<CategoryId, CategoryDefinition>;

export function categoryLabel(category: CategoryId): string {
  return CATEGORY_BY_ID[category]?.label ?? category;
}
