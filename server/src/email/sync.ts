import crypto from 'node:crypto';
import { load } from 'cheerio';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { ProviderRegistry } from '../ai/providers.js';
import type { SecretStore } from '../ai/secret-store.js';
import type { JobDatabase, ImapSettingsRow } from '../db/database.js';
import { classifyEmail } from './classification.js';
import { matchEmailToJob } from './matching.js';
import { EmailClassificationSchema, type ImapSettingsInput } from './schemas.js';

type ImapCredentials = Pick<ImapSettingsRow, 'host' | 'port' | 'tls_mode' | 'username'> & { password: string };
type SyncResult = { processed: number; rejections: number; reviewItems: number; initialImport: boolean };

export const imapErrorMessage = (error: unknown) => {
  const value = error as { message?: unknown; responseStatus?: unknown; responseText?: unknown };
  const message = typeof value?.message === 'string' ? value.message : 'IMAP command failed';
  const response = typeof value?.responseText === 'string' ? value.responseText.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
  const status = typeof value?.responseStatus === 'string' ? value.responseStatus : '';
  return response ? `${message}${status ? ` (${status})` : ''}: ${response}` : message;
};

const cleanBody = (text: string) => text.replace(/\r/g, '').replace(/^\s*(unsubscribe|manage preferences|privacy policy).*$/gim, '').replace(/^On .+wrote:\s*[\s\S]*$/im, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 100_000);
const htmlText = (html: string) => load(html).root().text().replace(/\s+/g, ' ');

export class EmailSyncService {
  private running = false;
  constructor(private readonly db: JobDatabase, private readonly providers: ProviderRegistry, private readonly secrets: SecretStore) {}
  private aiConnection(connection: NonNullable<ReturnType<JobDatabase['getConnection']>>) { return { provider_type: connection.provider_type, base_url: connection.base_url, api_key: connection.encrypted_api_key ? this.secrets.decrypt(connection.encrypted_api_key) : '', model: connection.model, temperature: connection.temperature, max_output_tokens: connection.max_output_tokens, timeout_ms: connection.timeout_ms, rate_limit_key: connection.id, requests_per_minute: connection.requests_per_minute, tokens_per_minute: connection.tokens_per_minute }; }
  private connection(credentials: ImapCredentials) {
    return new ImapFlow({ host: credentials.host, port: credentials.port, secure: credentials.tls_mode === 'tls', doSTARTTLS: credentials.tls_mode === 'starttls', auth: { user: credentials.username, pass: credentials.password }, tls: { rejectUnauthorized: true }, logger: false, emitLogs: false, disableCompression: true, socketTimeout: 60_000, greetingTimeout: 30_000 });
  }
  private configured(input: ImapSettingsInput, saved?: ImapSettingsRow): ImapCredentials {
    const password = input.password || (saved?.encrypted_password ? this.secrets.decrypt(saved.encrypted_password) : '');
    if (!input.host || !input.username || !password) throw new Error('Provide IMAP host, username, and password.');
    return { host: input.host, port: input.port, tls_mode: input.tls_mode, username: input.username, password };
  }
  private selectedMailboxes(input: Pick<ImapSettingsInput, 'interview_mailbox' | 'rejection_mailbox'>) { return [...new Set([input.interview_mailbox, input.rejection_mailbox].map(mailbox => mailbox.trim()).filter(Boolean))]; }
  async test(input: ImapSettingsInput) {
    const client = this.connection(this.configured(input, this.db.imapSettings()));
    const mailboxes = this.selectedMailboxes(input); if (!mailboxes.length) throw new Error('Select at least one IMAP folder.');
    try { await client.connect(); for (const mailbox of mailboxes) await client.getMailboxLock(mailbox, { readOnly: true }).then(lock => lock.release()); return { ok: true }; }
    finally { await client.logout().catch(() => undefined); }
  }
  async mailboxes(input: ImapSettingsInput) {
    const client = this.connection(this.configured(input, this.db.imapSettings()));
    try { await client.connect(); return { mailboxes: (await client.list()).filter(box => !box.flags.has('\\Noselect')).map(box => box.path) }; }
    finally { await client.logout().catch(() => undefined); }
  }
  async syncNow() {
    if (this.running) throw new Error('Email synchronization is already running.');
    if (!this.db.acquireImapSyncLease()) throw new Error('Email synchronization is already running.');
    this.running = true; this.db.markImapSyncRunning();
    try { return await this.sync(); }
    catch (error) { this.db.updateImapSyncStatus({ status: 'error', error: error instanceof Error ? error.message : 'IMAP synchronization failed' }); throw error; }
    finally { this.running = false; this.db.releaseImapSyncLease(); }
  }
  async classifyExisting(id: string) {
    const email = this.db.email(id); if (!email) throw new Error('Email review item not found.');
    let classification;
    if (email.classification_json) {
      try { classification = EmailClassificationSchema.safeParse(JSON.parse(email.classification_json)).data; }
      catch { classification = undefined; }
    }
    if (!classification) {
      const settings = this.db.imapSettings();
      if (!settings.ai_consent_at) throw new Error('Save consent to send email text to AI first.');
      const ai = this.db.settings(); const connection = this.db.getConnection(ai.email_connection_id ?? ai.default_connection_id ?? '');
      if (!connection?.enabled) throw new Error('Configure and select an enabled email AI provider first.');
      const aiConnection = this.aiConnection(connection);
      classification = await classifyEmail(this.providers.limited(aiConnection), aiConnection, email.body_text);
    }
    const match = matchEmailToJob(this.db.list({ archive: 'all' }), classification, email.body_text);
    return this.db.classifyEmail(id, { category: classification.category, classification_json: JSON.stringify(classification), proposed_job_id: match.jobId, match_status: match.status, unresolved_reason: match.unresolvedReason, review_status: classification.category === 'other' ? 'ignored' : 'pending_review' });
  }
  private async sync(): Promise<SyncResult> {
    const settings = this.db.imapSettings();
    const credentials = this.configured({ ...settings, enabled: Boolean(settings.enabled), password: '' , allow_ai_email_text: Boolean(settings.ai_consent_at) }, settings);
    const client = this.connection(credentials);
    let processed = 0; let rejections = 0; let reviewItems = 0;
    try {
      const mailboxes = this.selectedMailboxes(settings); if (!mailboxes.length) throw new Error('Select at least one IMAP folder.');
      await client.connect(); let initialImport = false;
      for (const mailboxPath of mailboxes) {
        const result = await this.syncMailbox(client, mailboxPath, settings); processed += result.processed; rejections += result.rejections; reviewItems += result.reviewItems; initialImport ||= result.initialImport;
      }
      this.db.updateImapSyncStatus({ status: 'ok', processed, rejections, reviews: reviewItems });
      return { processed, rejections, reviewItems, initialImport };
    } finally { await client.logout().catch(() => undefined); }
  }
  private async syncMailbox(client: ImapFlow, mailboxPath: string, settings: ImapSettingsRow): Promise<SyncResult> {
    const lock = await client.getMailboxLock(mailboxPath, { readOnly: true });
    let processed = 0; let rejections = 0; let reviewItems = 0;
    try {
      const rawUidValidity = String(client.mailbox && client.mailbox.uidValidity || ''); if (!rawUidValidity) throw new Error(`IMAP folder “${mailboxPath}” did not return UIDVALIDITY.`);
      const previous = this.db.syncState(mailboxPath); const initialImport = !previous?.uid_validity || previous.uid_validity !== rawUidValidity;
      const startDate = new Date(); startDate.setUTCDate(startDate.getUTCDate() - settings.initial_sync_days);
      const ids = initialImport ? await client.search({ since: startDate }, { uid: true }) : await client.search({ uid: `${previous.last_processed_uid + 1}:*` }, { uid: true });
      const uids = Array.isArray(ids) ? ids : []; let maxUid = initialImport ? 0 : previous.last_processed_uid;
      // UIDVALIDITY belongs to a mailbox, not to the whole IMAP account.
      const uidValidity = `${mailboxPath}\u001f${rawUidValidity}`;
      for await (const message of client.fetch(uids, { uid: true, source: true, internalDate: true }, { uid: true })) {
        maxUid = Math.max(maxUid, message.uid); if (this.db.hasEmail(uidValidity, message.uid) || !message.source) continue;
        const parsed = await simpleParser(message.source as Buffer);
        if (parsed.from?.value.some(sender => sender.address?.trim().toLowerCase() === settings.username.trim().toLowerCase())) continue;
        const body = cleanBody(parsed.text || (typeof parsed.html === 'string' ? htmlText(parsed.html) : '')); if (!body) continue;
        const email = await this.processEmail({ uidValidity, uid: message.uid, receivedAt: new Date(message.internalDate ?? Date.now()).toISOString(), body, initialImport, settings });
        processed++; if (email.category === 'rejection') rejections++; if (email.review_status === 'pending_review') reviewItems++;
      }
      this.db.saveSyncState(mailboxPath, rawUidValidity, maxUid); return { processed, rejections, reviewItems, initialImport };
    } finally { lock.release(); }
  }
  private async processEmail(input: { uidValidity: string; uid: number; receivedAt: string; body: string; initialImport: boolean; settings: ImapSettingsRow }) {
    const { settings } = input; let category: string | null = null; let classificationJson: string | null = null; let proposedJobId: string | null = null; let matchStatus: 'exact' | 'probable' | 'no_match' | null = null; let unresolvedReason: string | null = settings.ai_consent_at ? 'ai_not_configured' : 'ai_consent_required';
    const ai = this.db.settings(); const connection = this.db.getConnection(ai.email_connection_id ?? ai.default_connection_id ?? '');
    if (settings.ai_consent_at && ai.auto_email_classification && connection?.enabled) {
      try {
        const aiConnection = this.aiConnection(connection);
        const classification = await classifyEmail(this.providers.limited(aiConnection), aiConnection, input.body);
        category = classification.category; classificationJson = JSON.stringify(classification);
        const match = matchEmailToJob(this.db.list({ archive: 'all' }), classification, input.body); proposedJobId = match.jobId; matchStatus = match.status; unresolvedReason = match.unresolvedReason;
      } catch (error) {
        // A shared provider quota may already be exhausted even when this
        // tracker obeys its own configured spacing. Keep the email for review
        // instead of failing the entire mailbox synchronization.
        if (!(error instanceof Error) || !error.message.includes('(429)')) throw error;
        unresolvedReason = 'ai_rate_limited';
      }
    }
    const reviewStatus = category === 'other' ? 'ignored' : 'pending_review';
    const saved = this.db.saveEmail({ uid_validity: input.uidValidity, imap_uid: input.uid, received_at: input.receivedAt, body_text: input.body, body_hash: crypto.createHash('sha256').update(input.body).digest('hex'), category, classification_json: classificationJson, proposed_job_id: proposedJobId, match_status: matchStatus, review_status: reviewStatus, unresolved_reason: unresolvedReason, initial_import: input.initialImport ? 1 : 0 });
    const shouldArchive = saved.match_status === 'exact' || (settings.rejection_handling === 'manual_review' && saved.match_status === 'probable');
    if (!input.initialImport && settings.rejection_handling !== 'notifications_only' && saved.category === 'rejection' && shouldArchive) return this.db.autoApplyRejection(saved.id) ?? saved;
    return saved;
  }
}

export class EmailSyncScheduler {
  private timer: NodeJS.Timeout | undefined;
  constructor(private readonly service: EmailSyncService, private readonly db: JobDatabase) {}
  // Email sync is deliberately manual. The setting enables the connection; it
  // must not start polling the mailbox just because a form field was saved.
  start() { this.stop(); this.db.clearStaleImapSyncStatus(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
