import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_BY_ID, CATEGORY_DEFINITIONS, categoryLabel } from '../shared/categories';
import { destinationLabel, familyForCategory, familyLabel, formLabel } from '../shared/taxonomy';
import { benchmarkCandidates, benchmarkMetrics, predictedCategory, previewAliasRule, similarEntries } from '../shared/review-tools';
import { validateAliasRule } from '../shared/alias-rules';
import type { AliasRule, AudioFileEntry, CategoryId, OperationProgress, ScanProgress, ScanResult, SortOperation, SortPlan, SortResult, SoundNameSuggestion, VerifiedLabel, WaveSortSettings } from '../shared/types';
import './styles.css';

const PAGE_SIZE = 90;
type FilterId = CategoryId | 'all' | 'review';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-CA').format(value);
}

function formatDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return undefined;
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function formatTime(milliseconds: number | undefined): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return 'estimating…';
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  if (minutes < 60) return `${minutes}:${seconds}`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function shortPath(value: string, maxLength = 54): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(12, maxLength - 22))} … ${value.slice(-18)}`;
}

function confidenceLabel(value: number): string {
  if (value >= 0.78) return 'Strong cue';
  if (value >= 0.52) return 'Mixed cue';
  return 'Review';
}

function confidenceClass(value: number): string {
  if (value >= 0.78) return 'high';
  if (value >= 0.52) return 'medium';
  return 'low';
}

function taxonomyLabel(entry: Pick<AudioFileEntry, 'category' | 'family' | 'form'>): string {
  const family = entry.family === 'unknown' ? categoryLabel(entry.category) : familyLabel(entry.family);
  return entry.form === 'unknown' ? family : `${formLabel(entry.form)} · ${family}`;
}

function buildCounts(entries: AudioFileEntry[]): Record<CategoryId, number> {
  const counts = {} as Record<CategoryId, number>;
  for (const entry of entries) counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  return counts;
}

function App() {
  const [sourcePath, setSourcePath] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [overrides, setOverrides] = useState<Record<string, CategoryId>>({});
  const [aliasRules, setAliasRules] = useState<AliasRule[]>([]);
  const [verifiedLabels, setVerifiedLabels] = useState<Record<string, VerifiedLabel>>({});
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleTerm, setRuleTerm] = useState('');
  const [ruleCategory, setRuleCategory] = useState<CategoryId>('hihats');
  const [rulePreview, setRulePreview] = useState<ReturnType<typeof previewAliasRule> | null>(null);
  const [previewedRule, setPreviewedRule] = useState<AliasRule | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [nameSuggestion, setNameSuggestion] = useState<{ entryId: string; result: SoundNameSuggestion; draft: string } | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const scanGeneration = useRef(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState<CategoryId | ''>('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [isSorting, setIsSorting] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [operation, setOperation] = useState<SortOperation>('copy');
  const [sortPlan, setSortPlan] = useState<SortPlan | null>(null);
  const [operationProgress, setOperationProgress] = useState<OperationProgress | null>(null);
  const [undoOperationId, setUndoOperationId] = useState<string | null>(null);
  const [resumeOperationId, setResumeOperationId] = useState<string | null>(null);
  const [accentColor, setAccentColor] = useState('#d9ad6b');
  const [settingsDraft, setSettingsDraft] = useState<WaveSortSettings>({ accentColor: '#d9ad6b' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [lastResult, setLastResult] = useState<SortResult | null>(null);

  const effectiveEntries = useMemo(() => {
    if (!scan) return [];
    return scan.entries.map((entry) => {
      const override = overrides[entry.id];
      const family = override && override !== 'oneshots' && override !== 'loops' ? familyForCategory(override) : entry.family;
      const form = override === 'oneshots' ? 'one-shot' : override === 'loops' ? 'loop' : entry.form;
      return override
        ? { ...entry, category: override, family, form, confidence: 1, reason: `Manually assigned to ${categoryLabel(override)}.` }
        : entry;
    });
  }, [overrides, scan]);

  const counts = useMemo(() => buildCounts(effectiveEntries), [effectiveEntries]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return effectiveEntries.filter((entry) => {
      const matchesFilter = filter === 'all'
        || (filter === 'review' && (entry.category === 'other' || entry.confidence < 0.52))
        || entry.category === filter;
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      return `${entry.fileName} ${entry.relativePath} ${entry.category} ${entry.family} ${entry.form}`.toLowerCase().includes(normalizedQuery);
    });
  }, [effectiveEntries, filter, query]);

  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const visibleEntries = filteredEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const activeEntry = effectiveEntries.find((entry) => entry.id === activeId) ?? visibleEntries[0] ?? null;
  const selectedCount = selectedIds.size;
  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every((entry) => selectedIds.has(entry.id));
  const totalSize = useMemo(() => effectiveEntries.reduce((sum, entry) => sum + entry.size, 0), [effectiveEntries]);
  const matchingEntries = useMemo(() => activeEntry ? similarEntries(activeEntry, effectiveEntries) : [], [activeEntry, effectiveEntries]);
  const benchmarkQueue = useMemo(() => benchmarkOpen && scan ? benchmarkCandidates(scan.entries) : [], [benchmarkOpen, scan]);
  const metrics = useMemo(() => benchmarkOpen && scan ? benchmarkMetrics(scan.entries, verifiedLabels, aliasRules) : null, [benchmarkOpen, scan, verifiedLabels, aliasRules]);

  useEffect(() => {
    setPage(1);
  }, [filter, query]);

  useEffect(() => {
    void window.waveSort.getSettings().then((settings) => {
      setAccentColor(settings.accentColor);
      setSettingsDraft(settings);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!window.waveSort?.onScanProgress) return undefined;
    return window.waveSort.onScanProgress(setScanProgress);
  }, []);

  useEffect(() => {
    if (!window.waveSort?.onOperationProgress) return undefined;
    return window.waveSort.onOperationProgress(setOperationProgress);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!activeEntry) {
      setAudioUrl(null);
      return;
    }
    void window.waveSort.getAudioUrl(activeEntry.absolutePath).then((url) => {
      if (!cancelled) setAudioUrl(url);
    }).catch(() => {
      if (!cancelled) setAudioUrl(null);
    });
    return () => {
      cancelled = true;
    };
  }, [activeEntry]);

  function showNotice(text: string, tone: 'info' | 'success' | 'error' = 'info') {
    setNotice({ text, tone });
    window.setTimeout(() => setNotice((current) => current?.text === text ? null : current), 5200);
  }

  async function chooseSource() {
    const picked = await window.waveSort.pickDirectory();
    if (!picked) return;
    setSourcePath(picked);
    setScan(null);
    setDestinationPath('');
    setScanProgress(null);
    setLastResult(null);
    setResumeOperationId(null);
    setUndoOperationId(null);
    await runScan(picked);
  }

  function openSettings() {
    setSettingsDraft({ accentColor });
    setSettingsOpen(true);
  }

  async function saveAppearance() {
    setIsSavingSettings(true);
    try {
      await window.waveSort.saveSettings(settingsDraft);
      setAccentColor(settingsDraft.accentColor);
      setSettingsOpen(false);
      showNotice('Appearance saved for this WaveSort installation.', 'success');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The appearance setting could not be saved.', 'error');
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function chooseDestination() {
    const picked = await window.waveSort.pickDirectory();
    if (picked) setDestinationPath(picked);
  }

  async function cancelScan() {
    try {
      await window.waveSort.cancelScan();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The scan could not be cancelled.', 'error');
    }
  }

  async function runScan(root = sourcePath): Promise<boolean> {
    if (!root.trim()) {
      showNotice('Choose a source folder first.', 'error');
      return false;
    }
    setIsScanning(true);
    scanGeneration.current += 1;
    setNameOverrides({});
    setNameSuggestion(null);
    setAnalyzingId(null);
    setRulePreview(null);
    setPreviewedRule(null);
    setScanProgress(null);
    setNotice(null);
    try {
      const result = await window.waveSort.scanDirectory(root.trim());
      setScan(result);
      let reviewProfileFailed = false;
      try {
        const reviewProfile = await window.waveSort.getReviewProfile();
        setAliasRules(reviewProfile.aliasRules);
        setVerifiedLabels(reviewProfile.verifiedLabels);
      } catch {
        reviewProfileFailed = true;
        setAliasRules([]);
        setVerifiedLabels({});
        showNotice('The scan finished, but its saved review profile could not be loaded.', 'error');
      }
      setDestinationPath(result.defaultDestination);
      setOverrides({});
      setSelectedIds(new Set());
      setBulkCategory('');
      setActiveId(result.entries[0]?.id ?? null);
      setFilter('all');
      setQuery('');
      setPage(1);
      if (reviewProfileFailed) {
        // Keep the profile warning rather than replacing it with a scan notice.
      } else if (!result.complete) {
        showNotice(result.status === 'cancelled'
          ? `Scan cancelled after finding ${formatCount(result.entries.length)} audio files. Complete the scan before sorting.`
          : `Scan stopped at the safety limit after finding ${formatCount(result.entries.length)} audio files. Narrow the source before sorting.`, 'info');
      } else if (result.issues.length) {
        showNotice(`Found ${formatCount(result.entries.length)} audio files with ${formatCount(result.issues.length)} path warnings. Review the scan report before sorting.`, 'info');
      } else {
        showNotice(`Found ${formatCount(result.entries.length)} audio files. Review the results, then select what you want to sort.`, 'success');
      }
      return !reviewProfileFailed;
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The folder could not be scanned.', 'error');
      return false;
    } finally {
      setIsScanning(false);
    }
  }

  function toggleEntry(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleEntries.forEach((entry) => next.delete(entry.id));
      else visibleEntries.forEach((entry) => next.add(entry.id));
      return next;
    });
  }

  function setOverride(entryId: string, category: CategoryId) {
    setOverrides((current) => ({ ...current, [entryId]: category }));
    void window.waveSort.saveCorrection(entryId, category).catch((error) => {
      showNotice(error instanceof Error ? error.message : 'The correction could not be saved.', 'error');
    });
  }

  async function analyzeName(entry: AudioFileEntry) {
    const generation = scanGeneration.current;
    setAnalyzingId(entry.id);
    setNameSuggestion(null);
    try {
      const result = await window.waveSort.suggestSoundName(entry.id, entry.category);
      if (generation === scanGeneration.current) setNameSuggestion({ entryId: entry.id, result, draft: result.status === 'suggested' ? result.fileName : '' });
    } catch (error) {
      if (generation === scanGeneration.current) setNameSuggestion({ entryId: entry.id, result: { status: 'unavailable', reason: error instanceof Error ? error.message : 'Analysis failed.' }, draft: '' });
    } finally {
      setAnalyzingId((current) => current === entry.id ? null : current);
    }
  }

  function acceptName(entry: AudioFileEntry) {
    if (!nameSuggestion || nameSuggestion.entryId !== entry.id || nameSuggestion.result.status !== 'suggested') return;
    const proposed = nameSuggestion.draft;
    const extension = entry.extension;
    const stem = proposed.slice(0, -extension.length);
    if (!proposed.toLowerCase().endsWith(extension) || proposed.length > 180 || proposed !== proposed.trim()
      || /[<>:"/\\|?*\x00-\x1f]/.test(proposed) || /[. ]$/.test(stem)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(stem) || !stem) {
      showNotice(`Enter a Windows-safe filename ending in ${extension}.`, 'error');
      return;
    }
    setNameOverrides((current) => ({ ...current, [entry.id]: `${stem}${entry.fileName.slice(-extension.length)}` }));
    setNameSuggestion(null);
    showNotice('Filename saved for the destination copy. Review it in the sort plan.', 'success');
  }

  function applyBulkCategory() {
    if (!bulkCategory || !selectedIds.size) return;
    const ids = [...selectedIds];
    setOverrides((current) => {
      const next = { ...current };
      ids.forEach((entryId) => { next[entryId] = bulkCategory; });
      return next;
    });
    void Promise.all(ids.map((entryId) => window.waveSort.saveCorrection(entryId, bulkCategory))).then(() => {
      showNotice(`${formatCount(ids.length)} saved corrections applied.`, 'success');
    }).catch((error) => {
      showNotice(error instanceof Error ? error.message : 'Some corrections could not be saved.', 'error');
    });
    setBulkCategory('');
  }

  function selectSimilar() {
    if (matchingEntries.length < 2) return;
    setSelectedIds((current) => new Set([...current, ...matchingEntries.map((entry) => entry.id)]));
    showNotice(`${formatCount(matchingEntries.length)} similarly named files selected. Review the group, then use Change category if needed.`);
  }

  async function verifyLabel(entry: AudioFileEntry, category: CategoryId | '') {
    setSavingReview(true);
    try {
      if (category) {
        await window.waveSort.saveVerifiedLabel(entry.id, category);
        setVerifiedLabels((current) => ({ ...current, [entry.relativePath]: { category, fingerprint: entry.fingerprint ?? '' } }));
      } else {
        await window.waveSort.deleteVerifiedLabel(entry.id);
        setVerifiedLabels((current) => { const next = { ...current }; delete next[entry.relativePath]; return next; });
      }
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The verified label could not be saved.', 'error');
    } finally {
      setSavingReview(false);
    }
  }

  function previewRule() {
    if (!scan) return;
    try {
      const rule = validateAliasRule({ term: ruleTerm, category: ruleCategory });
      setPreviewedRule(rule);
      setRulePreview(previewAliasRule(effectiveEntries.map((entry) => overrides[entry.id]
        ? { ...entry, tags: [...entry.tags, 'saved-correction'] }
        : entry), rule));
    } catch (error) {
      setPreviewedRule(null);
      setRulePreview(null);
      showNotice(error instanceof Error ? error.message : 'The alias is invalid.', 'error');
    }
  }

  async function saveRule() {
    if (!previewedRule || !scan || !rulePreview) return;
    setSavingReview(true);
    try {
      await window.waveSort.saveAliasRule(previewedRule);
      setRulesOpen(false);
      setRuleTerm('');
      setRulePreview(null);
      setPreviewedRule(null);
      if (await runScan(scan.root)) showNotice('Library rule saved. The scan was refreshed with the new classification.', 'success');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The library rule could not be saved.', 'error');
    } finally {
      setSavingReview(false);
    }
  }

  async function removeRule(term: string) {
    if (!scan) return;
    setSavingReview(true);
    try {
      await window.waveSort.deleteAliasRule(term);
      if (await runScan(scan.root)) showNotice('Library rule removed and classifications refreshed.', 'success');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The library rule could not be removed.', 'error');
    } finally {
      setSavingReview(false);
    }
  }

  async function prepareSort(nextOperation: SortOperation) {
    if (!scan) return;
    if (!destinationPath.trim()) {
      showNotice('Choose a destination folder first.', 'error');
      return;
    }
    if (!selectedCount) {
      showNotice('Select at least one file to sort.', 'error');
      return;
    }
    setOperation(nextOperation);
    setIsPlanning(true);
    setNotice(null);
    try {
      const plan = await window.waveSort.buildSortPlan({
        entryIds: [...selectedIds],
        operation: nextOperation,
        destination: destinationPath.trim(),
        overrides,
        nameOverrides: Object.fromEntries(Object.entries(nameOverrides).filter(([entryId]) => selectedIds.has(entryId))),
      });
      setSortPlan(plan);
      if (plan.blockedCount) showNotice(`${formatCount(plan.blockedCount)} files are blocked and will be skipped unless you rescan or fix them.`, 'info');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The sort plan could not be built.', 'error');
    } finally {
      setIsPlanning(false);
    }
  }

  async function executePlannedSort() {
    if (!sortPlan || !sortPlan.readyCount) return;
    if (sortPlan.operation === 'move' && !window.confirm('Move the selected originals according to this reviewed plan? Originals are removed only after each destination file is verified.')) return;

    setIsSorting(true);
    setNotice(null);
    try {
      const result = await window.waveSort.executeSortPlan(sortPlan.planId);
      setLastResult(result);
      setUndoOperationId(result.canUndo ? result.operationId : null);
      setResumeOperationId(result.canResume ? result.operationId : null);
      if (sortPlan.operation === 'move' && result.processed > 0) {
        const processedIds = new Set(result.items.filter((item) => item.status === 'processed').map((item) => item.entryId));
        const remaining = effectiveEntries.filter((entry) => !processedIds.has(entry.id));
        setScan((current) => current ? { ...current, entries: remaining, counts: buildCounts(remaining) } : current);
        setSelectedIds(new Set());
        setActiveId(remaining[0]?.id ?? null);
      } else {
        setSelectedIds(new Set());
      }
      setSortPlan(null);
      const message = result.cancelled
        ? `${formatCount(result.processed)} processed before cancellation. The operation can be resumed.`
        : result.errors
        ? `${formatCount(result.processed)} processed, ${formatCount(result.errors)} need attention, ${formatCount(result.skipped)} skipped.`
        : `${formatCount(result.processed)} files ${sortPlan.operation === 'copy' ? 'copied' : 'moved'} and verified.`;
      showNotice(message, result.cancelled || result.errors ? 'info' : 'success');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The planned sort could not be completed.', 'error');
    } finally {
      setIsSorting(false);
      setOperationProgress(null);
    }
  }

  async function cancelOperation() {
    try {
      await window.waveSort.cancelOperation();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The operation could not be cancelled.', 'error');
    }
  }

  async function resumeLastOperation(retryFailed = false) {
    if (!resumeOperationId) return;
    setIsSorting(true);
    setNotice(null);
    try {
      const result = await window.waveSort.resumeOperation(resumeOperationId, retryFailed);
      setLastResult(result);
      setUndoOperationId(result.canUndo ? result.operationId : null);
      setResumeOperationId(result.canResume ? result.operationId : null);
      if (result.operation === 'move' && result.processed > 0) await runScan();
      const message = result.cancelled
        ? `${formatCount(result.processed)} processed before cancellation. The operation can be resumed.`
        : result.errors
          ? `${formatCount(result.processed)} processed, ${formatCount(result.errors)} still need attention.`
          : `${formatCount(result.processed)} remaining files processed and verified.`;
      showNotice(message, result.cancelled ? 'info' : result.errors ? 'error' : 'success');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The operation could not be resumed.', 'error');
    } finally {
      setIsSorting(false);
      setOperationProgress(null);
    }
  }

  async function undoLastOperation() {
    if (!undoOperationId) return;
    setIsSorting(true);
    setNotice(null);
    try {
       const result = await window.waveSort.undoOperation(undoOperationId);
       setLastResult(result);
       setUndoOperationId(result.canUndo ? result.operationId : null);
      setResumeOperationId(null);
      if (result.operation === 'move' && result.processed > 0) {
        await runScan();
      }
       const message = result.cancelled
         ? `${formatCount(result.processed)} items undone before cancellation. The remaining outputs were left untouched.`
         : result.errors
           ? `${formatCount(result.processed)} items undone, ${formatCount(result.errors)} need attention.`
           : `${formatCount(result.processed)} items safely undone.`;
       showNotice(message, result.cancelled ? 'info' : result.errors ? 'error' : 'success');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The operation could not be undone.', 'error');
    } finally {
      setIsSorting(false);
      setOperationProgress(null);
    }
  }

  async function openLastReport() {
    if (!lastResult) return;
    try {
      const error = await window.waveSort.openReport(lastResult.operationId);
      if (error) showNotice(error, 'error');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The operation report could not be opened.', 'error');
    }
  }

  const isEmpty = !scan;
  const themeStyle = { '--accent': accentColor } as React.CSSProperties;
  const reviewCount = (counts.other ?? 0) + effectiveEntries.filter((entry) => entry.confidence < 0.52 && entry.category !== 'other').length;

  return (
    <div className="app-shell" style={themeStyle}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">◧</span>
          <div className="brand-name">WaveSort<span className="brand-period">.</span></div>
        </div>
        <div className="topbar-note">A simple tool for sorting sample libraries</div>
        <div className="topbar-actions">
          <span className="local-label"><span className="status-dot" /> Local only</span>
          <button className="button quiet" onClick={openSettings}>Appearance</button>
        </div>
      </header>

      {notice && <div className={`notice ${notice.tone}`} role="status"><span>{notice.tone === 'error' ? '!' : notice.tone === 'success' ? '✓' : 'i'}</span>{notice.text}</div>}

      {operationProgress && isSorting && <div className="operation-progress-card" role="status" aria-live="polite">
        <div className="operation-progress-heading"><div><p className="eyebrow">{operationProgress.phase === 'undoing' ? 'UNDOING OPERATION' : 'EXECUTING FILE OPERATION'}</p><strong>{operationProgress.percent}% complete</strong></div><div className="operation-time"><span>{Math.max(0, 100 - operationProgress.percent)}% remaining</span><span>{formatTime(operationProgress.elapsedMs)} elapsed</span><span>{operationProgress.estimatedRemainingMs === undefined ? 'estimating time left' : `${formatTime(operationProgress.estimatedRemainingMs)} remaining`}</span></div></div>
        <div className="operation-progress-track"><span style={{ width: `${operationProgress.percent}%` }} /></div>
        <div className="operation-progress-footer"><span>{formatCount(operationProgress.processed)} of {formatCount(operationProgress.total)} files · {formatBytes(operationProgress.bytesProcessed)} of {formatBytes(operationProgress.bytesTotal)}</span><span title={operationProgress.currentFile}>{operationProgress.currentFile ? shortPath(operationProgress.currentFile, 72) : 'Finishing…'}</span><button className="text-button" onClick={cancelOperation} disabled={operationProgress.phase === 'complete'}>Cancel safely</button></div>
      </div>}

      {isEmpty ? (
        <main className="empty-state">
          <div className="empty-card">
            <span className="step-tag">01 / START HERE</span>
            <h1>{isScanning ? 'Reading your folder…' : 'Sort your sounds.'}</h1>
            <p>{isScanning ? `Found ${formatCount(scanProgress?.audioFound ?? 0)} audio files so far. This can take a while for large libraries.` : 'Choose a sample folder. WaveSort will group its audio files so you can review them before copying or moving anything.'}</p>
            <div className="empty-actions">
              <button className="button primary large" onClick={isScanning ? cancelScan : chooseSource}>{isScanning ? 'Cancel scan' : 'Choose a folder'} <span aria-hidden="true">→</span></button>
              {isScanning && <span className="scan-current" title={scanProgress?.currentPath}>{scanProgress?.currentPath ? shortPath(scanProgress.currentPath, 70) : 'Looking for audio files…'}</span>}
            </div>
          </div>
          <div className="empty-steps"><span><b>01</b> Choose a folder</span><span><b>02</b> Review the results</span><span><b>03</b> Copy or move</span></div>
          <p className="empty-footnote">Everything stays on your computer. Copy leaves originals in place.</p>
        </main>
      ) : (
        <div className="workspace-grid">
          <main className="main-content">
            <div className="workspace-heading"><div><span className="step-tag">02 / REVIEW</span><h1>Your sounds</h1><p>{formatCount(effectiveEntries.length)} files · {formatBytes(totalSize)}{reviewCount > 0 ? ` · ${formatCount(reviewCount)} to review` : ''}</p></div><div className="review-heading-actions"><button className="button quiet" onClick={() => setBenchmarkOpen(true)} disabled={isScanning || isSorting || !scan?.complete}>Accuracy</button><button className="button quiet" onClick={() => setRulesOpen(true)} disabled={isScanning || isSorting || !scan?.complete}>Library rules</button><button className="button secondary" onClick={chooseSource} disabled={isSorting || isPlanning}>Choose another folder</button></div></div>
            <div className="path-strip">
              <div className="path-field">
                <span className="path-label">FROM</span>
                <span className="path-value" title={sourcePath}>{shortPath(sourcePath)}</span>
                <button className="text-button" onClick={() => runScan()} disabled={isScanning || isSorting}>{isScanning ? 'Scanning…' : 'Rescan'}</button>
              </div>
              <div className="path-field destination-field">
                <span className="path-label">TO</span>
                <input className="path-input" value={destinationPath} onChange={(event) => setDestinationPath(event.target.value)} aria-label="Destination folder" placeholder="Choose an output folder" />
                <button className="text-button" onClick={chooseDestination} disabled={isSorting}>Browse</button>
              </div>
            </div>

            {scan && (scan.status !== 'complete' || scan.issues.length > 0 || scan.cacheReused > 0 || scan.addedCount > 0 || scan.changedCount > 0 || scan.removedCount > 0) && <div className={`scan-report ${scan.status !== 'complete' ? 'incomplete' : ''}`}>
              <div className="scan-report-heading"><strong>{scan.status === 'cancelled' ? 'Scan cancelled' : scan.status === 'limit' ? 'Scan limit reached' : scan.issues.length ? 'Scan completed with warnings' : 'Scan refreshed'}</strong><span>{formatCount(scan.entries.length)} audio files available · {formatCount(scan.ignoredFiles)} unsupported files skipped</span></div>
              {scan.status === 'complete' && <div className="scan-cache-note">{formatCount(scan.cacheReused)} reused · {formatCount(scan.addedCount)} added · {formatCount(scan.changedCount)} changed · {formatCount(scan.removedCount)} removed</div>}
              {scan.issues.slice(0, 3).map((issue) => <div className="scan-issue" key={`${issue.kind}:${issue.path}`}><span>!</span><div><strong>{issue.kind.replace('-', ' ')}</strong><small title={issue.path}>{shortPath(issue.path, 96)} · {issue.message}</small></div></div>)}
              {scan.issues.length > 3 && <div className="scan-report-more">+ {formatCount(scan.issues.length - 3)} more path warnings</div>}
            </div>}

            {isScanning && <div className="scan-inline" role="status"><span className="spinner" /> Scanning · {formatCount(scanProgress?.classified ?? 0)} classified <button className="text-button" onClick={cancelScan}>Cancel</button></div>}
            <div className="list-toolbar">
              <div className="search-wrap"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" aria-label="Search filenames or folders" /></div>
              <select className="toolbar-select filter-select" value={filter} onChange={(event) => setFilter(event.target.value as FilterId)} aria-label="Filter by sound type"><option value="all">All sounds ({formatCount(effectiveEntries.length)})</option><option value="review">Needs review ({formatCount(reviewCount)})</option>{CATEGORY_DEFINITIONS.map((category) => <option value={category.id} key={category.id}>{category.label} ({formatCount(counts[category.id] ?? 0)})</option>)}</select>
              <button className="toolbar-button" onClick={() => setSelectedIds(new Set(effectiveEntries.map((entry) => entry.id)))} disabled={!effectiveEntries.length || isSorting}>Select all</button>
              {selectedCount > 0 && <button className="toolbar-button subtle" onClick={() => setSelectedIds(new Set())}>Clear</button>}
            </div>
            {selectedCount > 0 && <div className="selection-tools"><span><strong>{formatCount(selectedCount)}</strong> selected</span><select className="toolbar-select" value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value as CategoryId | '')} aria-label="Assign selected category"><option value="">Change category…</option>{CATEGORY_DEFINITIONS.map((category) => <option value={category.id} key={category.id}>{category.label}</option>)}</select><button className="toolbar-button" onClick={applyBulkCategory} disabled={!bulkCategory}>Apply to selected</button></div>}

            {lastResult && <div className="result-card" role="status"><div><strong>{lastResult.action === 'undo' ? 'Undo finished' : lastResult.cancelled ? 'Sort paused' : 'Last sort'}</strong><span>{formatCount(lastResult.processed)} processed{lastResult.errors ? ` · ${formatCount(lastResult.errors)} errors` : ''}{lastResult.skipped ? ` · ${formatCount(lastResult.skipped)} skipped` : ''}</span></div><div className="result-actions"><button className="text-button" onClick={openLastReport} disabled={isSorting}>Open report</button>{resumeOperationId && lastResult.canResume && <><button className="text-button" onClick={() => resumeLastOperation(false)} disabled={isSorting}>Resume</button>{lastResult.errors > 0 && <button className="text-button" onClick={() => resumeLastOperation(true)} disabled={isSorting}>Retry failed</button>}</>}{undoOperationId && <button className="text-button" onClick={undoLastOperation} disabled={isSorting}>Undo</button>}<button className="text-button muted" onClick={() => setLastResult(null)}>Dismiss</button></div></div>}

            <div className="file-table">
              <div className="table-head"><div className="check-cell"><button className={`check-box ${allVisibleSelected ? 'checked' : ''}`} onClick={toggleVisible} aria-label="Select visible files">{allVisibleSelected ? '✓' : ''}</button></div><div>FILE</div><div>SOUND</div><div>GUESS</div><div>SIZE</div></div>
              {visibleEntries.length === 0 ? <div className="no-results"><span>⌁</span><strong>No files match this view.</strong><p>Try another category or search term.</p></div> : visibleEntries.map((entry) => (
                <div key={entry.id} className={`file-row ${selectedIds.has(entry.id) ? 'is-selected' : ''} ${activeEntry?.id === entry.id ? 'is-active' : ''}`} onClick={() => setActiveId(entry.id)}>
                  <div className="check-cell"><button className={`check-box ${selectedIds.has(entry.id) ? 'checked' : ''}`} onClick={(event) => { event.stopPropagation(); toggleEntry(entry.id); }} aria-label={`Select ${entry.fileName}`}>{selectedIds.has(entry.id) ? '✓' : ''}</button></div>
                  <div className="file-name-cell"><span className="file-type-icon">{entry.extension.replace('.', '').slice(0, 3).toUpperCase()}</span><div><strong title={entry.fileName}>{entry.fileName}</strong><small title={entry.relativePath}>{shortPath(entry.relativePath, 68)}</small></div></div>
                  <div><span className="type-pill" style={{ '--pill-color': CATEGORY_BY_ID[entry.category].color } as React.CSSProperties}>{taxonomyLabel(entry)}</span></div>
                  <div className={`confidence-label ${confidenceClass(entry.confidence)}`}>{confidenceLabel(entry.confidence)}</div>
                  <div className="size-cell">{formatBytes(entry.size)}</div>
                </div>
              ))}
              <div className="table-footer"><span>Showing {filteredEntries.length ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filteredEntries.length)}` : '0'} of {formatCount(filteredEntries.length)}</span><div className="pagination"><button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>‹</button><span>{page} / {pageCount}</span><button onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount}>›</button></div></div>
            </div>
          </main>

          <aside className="detail-panel">
            <div className="detail-header"><span>FILE DETAILS</span><span className="detail-count">{activeEntry ? activeEntry.extension.toUpperCase().replace('.', '') : '—'}</span></div>
            {activeEntry ? <>
              <div className="preview-card">
                <span className="preview-label">PREVIEW</span>
                <audio key={audioUrl ?? activeEntry.id} controls preload="none" src={audioUrl ?? undefined} />
              </div>
              <div className="detail-file"><h2 title={activeEntry.fileName}>{activeEntry.fileName}</h2><p>{formatBytes(activeEntry.size)}{activeEntry.metadata?.durationMs !== undefined ? ` · ${formatDuration(activeEntry.metadata.durationMs)}` : ''}</p></div>
              {activeEntry.metadata?.playbackSupport === 'unknown' && <p className="metadata-note">Playback support varies for this format; WaveSort will not convert the file.</p>}
              <div className="detail-section"><label htmlFor="file-category">SORT AS</label><select id="file-category" value={activeEntry.category} onChange={(event) => setOverride(activeEntry.id, event.target.value as CategoryId)}>{CATEGORY_DEFINITIONS.map((category) => <option value={category.id} key={category.id}>{category.label}</option>)}</select></div>
              {matchingEntries.length > 1 && <div className="detail-section"><label>SIMILAR NAMES</label><p className="reason-box">{formatCount(matchingEntries.length)} files in this folder share the same name pattern after take numbers and producer tags are removed.</p><button className="text-button similar-button" onClick={selectSimilar}>Select similar files</button></div>}
              <div className="detail-section"><label htmlFor="verified-label">VERIFIED TYPE · ACCURACY SET</label><select id="verified-label" value={verifiedLabels[activeEntry.relativePath]?.fingerprint === activeEntry.fingerprint ? verifiedLabels[activeEntry.relativePath].category : ''} disabled={savingReview || !scan?.complete} onChange={(event) => { void verifyLabel(activeEntry, event.target.value as CategoryId | ''); }}><option value="">Not verified</option>{CATEGORY_DEFINITIONS.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select><p className="reason-box label-note">Set this only after checking the sound. It measures sorting accuracy; it does not change the sort category.</p></div>
              <div className="detail-section sound-name-section"><label>SOUND NAME · OPTIONAL</label><p className="reason-box">Analyze this file only to suggest an output filename. This does not change its category or original file.</p>
                <button className="button secondary" onClick={() => analyzeName(activeEntry)} disabled={isScanning || isSorting || analyzingId !== null || !scan?.complete}>{analyzingId === activeEntry.id ? 'Analyzing…' : 'Suggest from sound'}</button>
                {nameOverrides[activeEntry.id] && <div className="name-accepted"><span>Output name: <strong>{nameOverrides[activeEntry.id]}</strong></span><button className="text-button" onClick={() => setNameOverrides((current) => { const next = { ...current }; delete next[activeEntry.id]; return next; })}>Remove</button></div>}
                {nameSuggestion?.entryId === activeEntry.id && (nameSuggestion.result.status === 'unavailable'
                  ? <p className="name-feedback">No reliable suggestion: {nameSuggestion.result.reason}</p>
                  : <div className="name-proposal"><p>{nameSuggestion.result.explanation}</p><input aria-label="Suggested output filename" value={nameSuggestion.draft} maxLength={180} onChange={(event) => setNameSuggestion((current) => current ? { ...current, draft: event.target.value } : current)} /><div><button className="button primary" onClick={() => acceptName(activeEntry)}>Accept name</button><button className="text-button" onClick={() => setNameSuggestion(null)}>Dismiss</button></div></div>)}
              </div>
              <div className="detail-section"><label>WHY THIS GUESS</label><p className="reason-box">{activeEntry.reason}</p></div>
              <div className="detail-section"><label>ORIGINAL LOCATION</label><p className="detail-path" title={activeEntry.relativePath}>{activeEntry.relativePath}</p></div>
              <details className="more-details"><summary>More file information</summary>{activeEntry.metadata && <div className="metadata-grid"><div><span>Codec</span><strong>{activeEntry.metadata.codec}</strong></div><div><span>Rate</span><strong>{activeEntry.metadata.sampleRate ? `${(activeEntry.metadata.sampleRate / 1000).toFixed(1)} kHz` : '—'}</strong></div><div><span>Channels</span><strong>{activeEntry.metadata.channels ?? '—'}</strong></div><div><span>Depth</span><strong>{activeEntry.metadata.bitsPerSample ? `${activeEntry.metadata.bitsPerSample} bit` : '—'}</strong></div></div>}<p>{familyLabel(activeEntry.family)} · {formLabel(activeEntry.form)}</p><button className="text-button" onClick={() => window.waveSort.openSourceFolder()}>Open source folder</button></details>
            </> : <div className="detail-empty"><p>Choose a file to preview it and check its category.</p></div>}
          </aside>
        </div>
      )}

      {!isEmpty && <footer className="action-dock"><div className="dock-context"><span className="step-tag">03 / SORT</span><strong>{formatCount(selectedCount)} selected</strong><small>{!scan?.complete ? 'Finish scanning before sorting' : 'Copy keeps your originals in place'}</small></div><div className="dock-buttons"><button className="button secondary" onClick={() => prepareSort('move')} disabled={isSorting || isPlanning || isScanning || !selectedCount || !scan?.complete}>{isPlanning && operation === 'move' ? <><span className="spinner" /> Preparing</> : 'Move files'}</button><button className="button primary" onClick={() => prepareSort('copy')} disabled={isSorting || isPlanning || isScanning || !selectedCount || !scan?.complete}>{isPlanning && operation === 'copy' ? <><span className="spinner" /> Preparing</> : 'Copy files'} <span aria-hidden="true">→</span></button></div></footer>}
      {sortPlan && <div className="modal-scrim" role="presentation"><div className="plan-modal" role="dialog" aria-modal="true" aria-labelledby="plan-title">
        <div className="plan-modal-header"><div><p className="eyebrow">REVIEW BEFORE FILESYSTEM CHANGES</p><h2 id="plan-title">{sortPlan.operation === 'copy' ? 'Copy plan' : 'Move plan'}</h2><p>{shortPath(sortPlan.destination, 72)}</p></div><button className="modal-close" onClick={() => setSortPlan(null)} disabled={isSorting}>×</button></div>
        <div className="plan-metrics"><div><strong>{formatCount(sortPlan.readyCount)}</strong><span>ready</span></div><div><strong>{formatCount(sortPlan.conflictCount)}</strong><span>renamed safely</span></div><div><strong>{formatCount(sortPlan.blockedCount)}</strong><span>blocked</span></div></div>
        {sortPlan.warnings.length > 0 && <div className="plan-warning"><span>!</span><div>{sortPlan.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div>}
        <div className="plan-list"><div className="plan-list-title"><span>DESTINATION PREVIEW</span><span>{formatCount(sortPlan.items.length)} files</span></div>{sortPlan.items.slice(0, 9).map((item) => <div className="plan-row" key={item.entryId}><span className={`plan-status ${item.status}`} /> <div><strong>{item.outputFileName && item.outputFileName !== item.fileName ? `${item.fileName} → ${item.outputFileName}` : item.fileName}</strong><small>{item.status === 'ready' || item.status === 'conflict' ? shortPath(item.targetPath ?? '', 62) : item.message}</small></div><span className="plan-category">{destinationLabel(item.category, item.family, item.form)}</span></div>)}{sortPlan.items.length > 9 && <p className="plan-more">+ {formatCount(sortPlan.items.length - 9)} more files in this plan</p>}</div>
        <div className="plan-modal-footer"><button className="button secondary" onClick={isSorting ? cancelOperation : () => setSortPlan(null)}>{isSorting ? 'Cancel operation' : 'Cancel'}</button><button className="button primary" onClick={executePlannedSort} disabled={isSorting || !sortPlan.readyCount}>{isSorting ? <><span className="spinner" /> Executing</> : sortPlan.operation === 'copy' ? 'Copy verified plan' : 'Move verified plan'} <span>→</span></button></div>
      </div></div>}
      {benchmarkOpen && scan && <div className="modal-scrim" role="presentation"><div className="plan-modal benchmark-modal" role="dialog" aria-modal="true" aria-labelledby="benchmark-title"><div className="plan-modal-header"><div><p className="eyebrow">LOCAL SORTING CHECK</p><h2 id="benchmark-title">Accuracy sample</h2><p>Verify a few sounds per predicted category. Labels stay on this computer and never change the sort destination.</p></div><button className="modal-close" onClick={() => setBenchmarkOpen(false)}>×</button></div>
        <div className="benchmark-stats"><div><strong>{metrics?.labeled ?? 0}</strong><span>verified labels</span></div><div><strong>{metrics?.autoPrecision === null ? '—' : `${Math.round((metrics?.autoPrecision ?? 0) * 100)}%`}</strong><span>correct among auto-sorted</span></div><div><strong>{metrics?.reviewRate === null ? '—' : `${Math.round((metrics?.reviewRate ?? 0) * 100)}%`}</strong><span>sent to review</span></div></div>
        <p className="benchmark-note">{(metrics?.labeled ?? 0) < 20 ? 'Fewer than 20 verified labels: these numbers are only a starting signal.' : 'These numbers describe verified files only, not the whole library.'} {metrics?.wrong ?? 0} wrong auto-sorts · {metrics?.needsReview ?? 0} review decisions. Manual corrections are excluded from predictions.</p>
        {!!metrics?.wrongExamples.length && <div className="benchmark-errors"><strong>Wrong auto-sorts to investigate</strong>{metrics.wrongExamples.map((item, index) => <p key={`${item.fileName}:${index}`}>{item.fileName}: {categoryLabel(item.predicted)} → {categoryLabel(item.verified)}</p>)}</div>}
        <div className="benchmark-list"><div className="plan-list-title"><span>STRATIFIED FILE QUEUE</span><span>{benchmarkQueue.filter((entry) => verifiedLabels[entry.relativePath]?.fingerprint === entry.fingerprint).length} / {benchmarkQueue.length} verified</span></div>{benchmarkQueue.map((entry) => <div className="benchmark-row" key={entry.id}><button className="benchmark-file" onClick={() => { setActiveId(entry.id); setBenchmarkOpen(false); }} title={entry.relativePath}>{entry.fileName}<small>Guess: {categoryLabel(predictedCategory(entry, aliasRules))} · inspect sound</small></button><select aria-label={`Verified type for ${entry.fileName}`} value={verifiedLabels[entry.relativePath]?.fingerprint === entry.fingerprint ? verifiedLabels[entry.relativePath].category : ''} disabled={savingReview} onChange={(event) => { void verifyLabel(entry, event.target.value as CategoryId | ''); }}><option value="">Not verified</option>{CATEGORY_DEFINITIONS.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></div>)}</div>
        <div className="plan-modal-footer"><button className="button secondary" onClick={() => setBenchmarkOpen(false)}>Done</button></div>
      </div></div>}
      {rulesOpen && scan && <div className="modal-scrim" role="presentation"><div className="plan-modal rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title"><div className="plan-modal-header"><div><p className="eyebrow">THIS LIBRARY ONLY</p><h2 id="rules-title">Filename rules</h2><p>Literal whole-word aliases. Preview affected files before saving; saved corrections still take priority.</p></div><button className="modal-close" onClick={() => setRulesOpen(false)} disabled={savingReview}>×</button></div>
        <div className="rule-editor"><label htmlFor="alias-term">Filename contains</label><input id="alias-term" value={ruleTerm} maxLength={32} placeholder="e.g. hhats" onChange={(event) => { setRuleTerm(event.target.value); setRulePreview(null); setPreviewedRule(null); }} /><label htmlFor="alias-category">Sort as</label><select id="alias-category" value={ruleCategory} onChange={(event) => { setRuleCategory(event.target.value as CategoryId); setRulePreview(null); setPreviewedRule(null); }}>{CATEGORY_DEFINITIONS.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select><button className="button secondary" onClick={previewRule} disabled={!ruleTerm.trim() || savingReview}>Preview rule</button></div>
        {rulePreview && <div className="rule-impact"><strong>{rulePreview.matched} matches · {rulePreview.changed} category changes</strong><p>{rulePreview.protectedCorrections} saved corrections remain untouched. The rule will apply after a refreshed scan.</p>{rulePreview.examples.map((example, index) => <div key={`${example.fileName}:${index}`}>{example.fileName} · {categoryLabel(example.before)} → {categoryLabel(example.after)}</div>)}<button className="button primary" onClick={saveRule} disabled={savingReview || !rulePreview.matched}>{savingReview ? 'Saving…' : 'Save rule and rescan'}</button></div>}
        <div className="saved-rules"><strong>Saved rules ({aliasRules.length})</strong>{aliasRules.length ? aliasRules.map((rule) => <div key={rule.term}><span>“{rule.term}” → {categoryLabel(rule.category)}</span><button className="text-button" onClick={() => removeRule(rule.term)} disabled={savingReview}>Remove</button></div>) : <p>No custom rules for this library.</p>}</div>
      </div></div>}
      {settingsOpen && <div className="settings-scrim" role="presentation"><div className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="settings-header"><div><p className="eyebrow">WAVESORT SETTINGS</p><h2 id="settings-title">Appearance</h2></div><button className="modal-close" onClick={() => setSettingsOpen(false)} disabled={isSavingSettings}>×</button></div><div className="settings-section"><label htmlFor="accent-color">ACCENT COLOR</label><div className="accent-picker"><input id="accent-color" type="color" value={settingsDraft.accentColor} onChange={(event) => setSettingsDraft({ accentColor: event.target.value })} /><div><strong>{settingsDraft.accentColor.toUpperCase()}</strong><p>Used for buttons, selection, progress, and focus states.</p></div></div></div><div className="settings-section"><label>BASE</label><p className="settings-copy">WaveSort keeps a near-black base so the accent stays readable across the library, review, and operation states. Settings remain local to this computer.</p></div><div className="settings-footer"><button className="button secondary" onClick={() => setSettingsOpen(false)} disabled={isSavingSettings}>Cancel</button><button className="button primary" onClick={saveAppearance} disabled={isSavingSettings}>{isSavingSettings ? <><span className="spinner" /> Saving</> : 'Save appearance'}</button></div></div></div>}
    </div>
  );
}

export default App;
