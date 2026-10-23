import type { JobDatabase } from '../db/database.js';
import type { SecretStore } from '../ai/secret-store.js';

export type BackupSettingsInput = { webhook_url: string; webhook_secret?: string; automatic_enabled: boolean; interval_hours: number };

export const backupErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'Google Sheets synchronization failed.';

export class GoogleSheetsSyncService {
  private running = false;
  constructor(private readonly db: JobDatabase, private readonly secrets: SecretStore) {}
  async syncNow() {
    if (this.running) throw new Error('Google Sheets synchronization is already running.');
    const settings = this.db.backupSettings();
    if (!settings.webhook_url) throw new Error('Save the Google Apps Script webhook URL first.');
    let url: URL;
    try { url = new URL(settings.webhook_url); } catch { throw new Error('Webhook URL is invalid.'); }
    if (url.protocol !== 'https:') throw new Error('Webhook URL must use HTTPS.');
    this.running = true; this.db.updateBackupSyncStatus({ status: 'running' });
    try {
      const payload = { ...this.db.sheetSyncPayload(), webhook_secret: settings.encrypted_webhook_secret ? this.secrets.decrypt(settings.encrypted_webhook_secret) : undefined };
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000), redirect: 'follow' });
      if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}.`);
      this.db.updateBackupSyncStatus({ status: 'ok' });
      return { jobs: payload.sheets.Jobs.length, events: payload.sheets.Events.length, tags: payload.sheets.Tags.length, emails: payload.sheets.Emails.length };
    } catch (error) { this.db.updateBackupSyncStatus({ status: 'error', error: backupErrorMessage(error) }); throw error; }
    finally { this.running = false; }
  }
}

export class BackupScheduler {
  private timer: NodeJS.Timeout | undefined;
  constructor(private readonly service: GoogleSheetsSyncService, private readonly db: JobDatabase) {}
  start() { this.stop(); const settings = this.db.backupSettings(); if (!settings.automatic_enabled || !settings.webhook_url) return; const run = () => void this.service.syncNow().catch(() => undefined); run(); this.timer = setInterval(run, settings.interval_hours * 3_600_000); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
