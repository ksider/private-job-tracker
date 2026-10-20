import type { PageSnapshot } from '@job-tracker/shared';
import type { ParsedJob } from '../db/database.js';
export interface SourceParser { readonly source: string; readonly version: string; canParse(snapshot: PageSnapshot): boolean; parse(snapshot: PageSnapshot): ParsedJob; }
