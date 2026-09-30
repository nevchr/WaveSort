import type { WaveSortApi } from '../shared/types';

declare global {
  interface Window {
    waveSort: WaveSortApi;
  }
}

export {};
