import type { CollectorResult } from '../types.js';
export interface Collector { readonly source: string; matches(url: string): boolean; collect(): CollectorResult; }
