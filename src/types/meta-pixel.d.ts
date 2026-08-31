interface FbqTrackParams {
  value?: number;
  currency?: string;
  content_name?: string;
  content_category?: string;
  content_ids?: string[];
  [key: string]: unknown;
}

type FbqCommand = 'init' | 'track' | 'trackCustom' | 'trackSingle' | 'trackSingleCustom';

interface Fbq {
  (command: 'init', pixelId: string): void;
  (command: 'track', event: string, params?: FbqTrackParams): void;
  (command: 'trackCustom', event: string, params?: FbqTrackParams): void;
  (command: 'trackSingle', pixelId: string, event: string, params?: FbqTrackParams): void;
  (command: 'trackSingleCustom', pixelId: string, event: string, params?: FbqTrackParams): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  loaded: boolean;
  version: string;
  push: (...args: unknown[]) => void;
}

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export {};
