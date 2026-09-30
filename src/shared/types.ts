export const AUDIO_EXTENSIONS = [
  '.wav',
  '.mp3',
  '.flac',
  '.aif',
  '.aiff',
  '.m4a',
  '.ogg',
  '.opus',
  '.aac',
  '.wma',
] as const;

export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];

export type CategoryId =
  | '808s'
  | 'bass'
  | 'kicks'
  | 'snares'
  | 'claps'
  | 'hihats'
  | 'open-hats'
  | 'percs'
  | 'toms'
  | 'cymbals'
  | 'vox'
  | 'oneshots'
  | 'loops'
  | 'melodies'
  | 'fx'
  | 'risers'
  | 'instruments'
  | 'drums'
  | 'other';

export type SoundFamily =
  | '808'
  | 'bass'
  | 'kick'
  | 'snare'
  | 'clap'
  | 'closed-hat'
  | 'open-hat'
  | 'perc'
  | 'rim'
  | 'tom'
  | 'cymbal'
  | 'vox'
  | 'chant'
  | 'fx'
  | 'riser'
  | 'melody'
  | 'instrument'
  | 'drum-kit'
  | 'unknown';

export type SoundForm = 'one-shot' | 'loop' | 'stem' | 'texture' | 'unknown';

export type PlaybackSupport = 'supported' | 'unknown';

export interface AudioMetadata {
  fileSize: number;
  codec: string;
  durationMs?: number;
  channels?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  bitrateKbps?: number;
  playbackSupport: PlaybackSupport;
}

export interface WaveSortSettings {
  accentColor: string;
}

export interface AliasRule {
  term: string;
  category: CategoryId;
}

export interface ReviewProfile {
  aliasRules: AliasRule[];
  verifiedLabels: Record<string, VerifiedLabel>;
}

export interface VerifiedLabel {
  category: CategoryId;
  fingerprint: string;
}

export type SortOperation = 'copy' | 'move';
export type OperationAction = 'sort' | 'undo';

export interface CategoryDefinition {
  id: CategoryId;
  family: SoundFamily;
  label: string;
  aliases: string[];
  color: string;
  priority: number;
}

export interface ClassificationResult {
  category: CategoryId;
  family: SoundFamily;
  form: SoundForm;
  confidence: number;
  reason: string;
  tags: string[];
}

export interface AudioFileEntry extends ClassificationResult {
  id: string;
  absolutePath: string;
  relativePath: string;
  fileName: string;
  extension: AudioExtension;
  size: number;
  modifiedAt: number;
  fingerprint?: string;
  metadata?: AudioMetadata;
}

export interface ScanResult {
  root: string;
  defaultDestination: string;
  entries: AudioFileEntry[];
  counts: Record<CategoryId, number>;
  ignoredFiles: number;
  complete: boolean;
  status: 'complete' | 'cancelled' | 'limit';
  issues: ScanIssue[];
  cacheReused: number;
  addedCount: number;
  changedCount: number;
  removedCount: number;
  scanDurationMs: number;
}

export interface ScanIssue {
  kind: 'inaccessible-directory' | 'inaccessible-file' | 'symlink-skipped' | 'scan-limit';
  path: string;
  message: string;
}

export interface ScanProgress {
  scanId: string;
  phase: 'scanning' | 'complete' | 'cancelled' | 'limit';
  directoriesVisited: number;
  filesVisited: number;
  audioFound: number;
  classified: number;
  ignoredFiles: number;
  issueCount: number;
  cacheReused: number;
  changedCount: number;
  currentPath?: string;
}

export interface SortRequest {
  entryIds: string[];
  operation: SortOperation;
  destination: string;
  overrides?: Partial<Record<string, CategoryId>>;
  nameOverrides?: Record<string, string>;
}

export type SoundNameSuggestion =
  | { status: 'suggested'; fileName: string; explanation: string }
  | { status: 'unavailable'; reason: string };

export type SortPlanItemStatus = 'ready' | 'conflict' | 'missing' | 'changed' | 'invalid';

export interface SortPlanItem {
  entryId: string;
  sourcePath: string;
  relativePath: string;
  fileName: string;
  outputFileName?: string;
  category: CategoryId;
  family: SoundFamily;
  form: SoundForm;
  operation: SortOperation;
  targetPath?: string;
  status: SortPlanItemStatus;
  message: string;
  sourceSize: number;
  sourceModifiedAt: number;
  sourceFingerprint: string;
}

export interface SortPlan {
  planId: string;
  createdAt: number;
  root: string;
  destination: string;
  operation: SortOperation;
  items: SortPlanItem[];
  readyCount: number;
  conflictCount: number;
  blockedCount: number;
  warnings: string[];
}

export interface SortItemResult {
  entryId: string;
  sourcePath: string;
  targetPath?: string;
  status: 'processed' | 'skipped' | 'error' | 'changed' | 'missing';
  message: string;
}

export interface SortResult {
  action: OperationAction;
  operation: SortOperation;
  planId?: string;
  operationId: string;
  destination: string;
  processed: number;
  skipped: number;
  errors: number;
  canUndo: boolean;
  canResume: boolean;
  cancelled: boolean;
  items: SortItemResult[];
}

export interface OperationProgress {
  operationId: string;
  phase: 'executing' | 'complete' | 'cancelled' | 'undoing';
  processed: number;
  total: number;
  percent: number;
  startedAt: number;
  elapsedMs: number;
  estimatedRemainingMs?: number;
  bytesProcessed: number;
  bytesTotal: number;
  currentFile?: string;
}

export interface WaveSortApi {
  pickDirectory: () => Promise<string | null>;
  scanDirectory: (root: string) => Promise<ScanResult>;
  cancelScan: () => Promise<boolean>;
  onScanProgress: (listener: (progress: ScanProgress) => void) => () => void;
  buildSortPlan: (request: SortRequest) => Promise<SortPlan>;
  executeSortPlan: (planId: string) => Promise<SortResult>;
  resumeOperation: (operationId: string, retryFailed?: boolean) => Promise<SortResult>;
  cancelOperation: () => Promise<boolean>;
  saveCorrection: (entryId: string, category: CategoryId) => Promise<boolean>;
  getReviewProfile: () => Promise<ReviewProfile>;
  saveAliasRule: (rule: AliasRule) => Promise<boolean>;
  deleteAliasRule: (term: string) => Promise<boolean>;
  saveVerifiedLabel: (entryId: string, category: CategoryId) => Promise<boolean>;
  deleteVerifiedLabel: (entryId: string) => Promise<boolean>;
  getSettings: () => Promise<WaveSortSettings>;
  saveSettings: (settings: WaveSortSettings) => Promise<boolean>;
  openReport: (operationId: string) => Promise<string>;
  undoOperation: (operationId: string) => Promise<SortResult>;
  onOperationProgress: (listener: (progress: OperationProgress) => void) => () => void;
  getAudioUrl: (absolutePath: string) => Promise<string | null>;
  suggestSoundName: (entryId: string, category: CategoryId) => Promise<SoundNameSuggestion>;
  openSourceFolder: () => Promise<string>;
}
