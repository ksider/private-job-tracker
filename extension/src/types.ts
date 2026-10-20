import type { PageSnapshot } from '@job-tracker/shared';
export type CollectorResult = { snapshot: PageSnapshot; warnings: string[]; preview: string };
export type Settings = { backendUrl: string; apiToken: string };
export type QueuedSnapshot = { id: string; dedupeKey: string; snapshot: PageSnapshot; createdAt: string };
