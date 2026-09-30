import { contextBridge, ipcRenderer } from 'electron';
import type { AliasRule, CategoryId, OperationProgress, ReviewProfile, ScanProgress, ScanResult, SortPlan, SortRequest, SortResult, WaveSortApi, WaveSortSettings } from './shared/types';

const api: WaveSortApi = {
  pickDirectory: () => ipcRenderer.invoke('dialog:pick-directory'),
  scanDirectory: (root: string): Promise<ScanResult> => ipcRenderer.invoke('scan:directory', root),
  cancelScan: (): Promise<boolean> => ipcRenderer.invoke('scan:cancel'),
  onScanProgress: (listener: (progress: ScanProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: ScanProgress) => listener(progress);
    ipcRenderer.on('scan:progress', wrapped);
    return () => ipcRenderer.removeListener('scan:progress', wrapped);
  },
  buildSortPlan: (request: SortRequest): Promise<SortPlan> => ipcRenderer.invoke('sort:plan', request),
  executeSortPlan: (planId: string): Promise<SortResult> => ipcRenderer.invoke('sort:execute', planId),
  resumeOperation: (operationId: string, retryFailed = false): Promise<SortResult> => ipcRenderer.invoke('sort:resume', operationId, retryFailed),
  cancelOperation: (): Promise<boolean> => ipcRenderer.invoke('sort:cancel'),
  saveCorrection: (entryId: string, category: CategoryId): Promise<boolean> => ipcRenderer.invoke('profile:save-correction', entryId, category),
  getReviewProfile: (): Promise<ReviewProfile> => ipcRenderer.invoke('profile:get-review'),
  saveAliasRule: (rule: AliasRule): Promise<boolean> => ipcRenderer.invoke('profile:save-alias', rule),
  deleteAliasRule: (term: string): Promise<boolean> => ipcRenderer.invoke('profile:delete-alias', term),
  saveVerifiedLabel: (entryId: string, category: CategoryId): Promise<boolean> => ipcRenderer.invoke('profile:save-label', entryId, category),
  deleteVerifiedLabel: (entryId: string): Promise<boolean> => ipcRenderer.invoke('profile:delete-label', entryId),
  getSettings: (): Promise<WaveSortSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: WaveSortSettings): Promise<boolean> => ipcRenderer.invoke('settings:save', settings),
  openReport: (operationId: string): Promise<string> => ipcRenderer.invoke('report:open', operationId),
  undoOperation: (operationId: string): Promise<SortResult> => ipcRenderer.invoke('sort:undo', operationId),
  onOperationProgress: (listener: (progress: OperationProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: OperationProgress) => listener(progress);
    ipcRenderer.on('sort:progress', wrapped);
    return () => ipcRenderer.removeListener('sort:progress', wrapped);
  },
  getAudioUrl: (absolutePath: string): Promise<string | null> => ipcRenderer.invoke('audio:url', absolutePath),
  suggestSoundName: (entryId: string, category: CategoryId) => ipcRenderer.invoke('audio:suggest-name', entryId, category),
  openSourceFolder: (): Promise<string> => ipcRenderer.invoke('shell:open-source-folder'),
};

contextBridge.exposeInMainWorld('waveSort', api);
