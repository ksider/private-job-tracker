import type { PageSnapshot, } from '@job-tracker/shared'; import type { Settings } from '../types.js';
export class BackendApiError extends Error { constructor(readonly status: number, message: string) { super(message); this.name = 'BackendApiError'; } }
export async function importSnapshot(settings: Settings, snapshot: PageSnapshot) {
  const url = new URL('/api/snapshots/import', settings.backendUrl).toString();
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiToken}` }, body: JSON.stringify(snapshot) });
  if (!response.ok) throw new BackendApiError(response.status, (await response.json().catch(() => ({ error: response.statusText }))).error ?? 'Import failed'); return response.json() as Promise<{ success: boolean; job_id: string; action: string; warnings: string[] }>;
}
