import crypto from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { SecretStore } from '../ai/secret-store.js';
import type { AiRouter } from '../ai/router.js';
import type { JobDatabase, ImapSettingsRow } from '../db/database.js';
import { classifyEmail } from './classification.js';
import { matchEmailToJob } from './matching.js';
import { EmailClassificationSchema, type ImapSettingsInput } from './schemas.js';
import { extractEmailText, type EmailTextSource } from './body.js';
import { analyzeOutreachEmail, outreachEmailAnalysisView } from '../ai/outreach-email.js';

type ImapCredentials = Pick<ImapSettingsRow, 'host' | 'port' | 'tls_mode' | 'username'> & { password: string };
type SyncResult = { processed: number; rejections: number; reviewItems: number; initialImport: boolean };
type MailAddress = { address?: string; name?: string; group?: MailAddress[] };
type MailAddressList = { value: MailAddress[] };
const flattenAddresses = (value: MailAddressList | MailAddressList[] | undefined) => (Array.isArray(value) ? value : value ? [value] : []).flatMap(list => list.value).flatMap(item => item.group?.length ? item.group : [item]).flatMap(item => item.address?.trim() ? [{ address: item.address.trim().toLowerCase(), name: item.name?.trim() || null }] : []);

export const imapErrorMessage = (error: unknown) => {
  const value = error as { message?: unknown; responseStatus?: unknown; responseText?: unknown };
  const message = typeof value?.message === 'string' ? value.message : 'IMAP command failed';
  const response = typeof value?.responseText === 'string' ? value.responseText.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
  const status = typeof value?.responseStatus === 'string' ? value.responseStatus : '';
  return response ? `${message}${status ? ` (${status})` : ''}: ${response}` : message;
};

export class EmailSyncService {
  private running = false;
  private automaticAiUnavailable = false;
  constructor(private readonly db: JobDatabase, private readonly secrets: SecretStore, private readonly aiRouter: AiRouter) {}
  private connection(credentials: ImapCredentials) {
    return new ImapFlow({ host: credentials.host, port: credentials.port, secure: credentials.tls_mode === 'tls', doSTARTTLS: credentials.tls_mode === 'starttls', auth: { user: credentials.username, pass: credentials.password }, tls: { rejectUnauthorized: true }, logger: false, emitLogs: false, disableCompression: true, socketTimeout: 60_000, greetingTimeout: 30_000 });
  }
  private configured(input: ImapSettingsInput, saved?: ImapSettingsRow): ImapCredentials {
    const password = input.password || (saved?.encrypted_password ? this.secrets.decrypt(saved.encrypted_password) : '');
    if (!input.host || !input.username || !password) throw new Error('Provide IMAP host, username, and password.');
    return { host: input.host, port: input.port, tls_mode: input.tls_mode, username: input.username, password };
  }
  private selectedMailboxes(input: Pick<ImapSettingsInput, 'interview_mailbox' | 'rejection_mailbox' | 'outreach_mailbox' | 'inbox_mailbox' | 'sent_mailbox'>) { return [...new Set([input.interview_mailbox, input.rejection_mailbox, input.outreach_mailbox, input.inbox_mailbox, input.sent_mailbox].map(mailbox => mailbox.trim()).filter(Boolean))]; }
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
    if (email.body_source === 'missing') throw new Error('This email has no usable text to classify.');
    let classification;
    if (email.classification_json) {
      try { classification = EmailClassificationSchema.safeParse(JSON.parse(email.classification_json)).data; }
      catch { classification = undefined; }
    }
    if (!classification) {
      const settings = this.db.imapSettings();
      if (!settings.ai_consent_at) throw new Error('Save consent to send email text to AI first.');
      classification = (await this.aiRouter.run('email', 'email', ({ provider, connection }) => classifyEmail(provider, connection, email.body_text))).value;
    }
    const match = matchEmailToJob(this.db.list({ archive: 'all' }).filter(job => job.record_type === 'application'), classification, email.body_text);
    return this.db.classifyEmail(id, { category: classification.category, classification_json: JSON.stringify(classification), proposed_job_id: match.jobId, match_status: match.status, unresolved_reason: match.unresolvedReason, review_status: classification.category === 'other' ? 'ignored' : 'pending_review' });
  }
  private async sync(): Promise<SyncResult> {
    const settings = this.db.imapSettings();
    this.automaticAiUnavailable = false;
    const credentials = this.configured({ ...settings, enabled: Boolean(settings.enabled), password: '' , allow_ai_email_text: Boolean(settings.ai_consent_at) }, settings);
    const client = this.connection(credentials);
    let processed = 0; let rejections = 0; let reviewItems = 0;
    try {
      const mailboxes = this.selectedMailboxes(settings); if (!mailboxes.length) throw new Error('Select at least one IMAP folder.');
      await client.connect(); let initialImport = false;
      for (const mailboxPath of mailboxes) {
        const result = await this.syncMailbox(client, mailboxPath, settings); processed += result.processed; rejections += result.rejections; reviewItems += result.reviewItems; initialImport ||= result.initialImport;
      }
      if (settings.outreach_mailbox.trim()) {
        const created = this.db.createOutreachRecordsFromMailbox(settings.outreach_mailbox.trim(), settings.username);
        if (settings.ai_consent_at && this.db.functionRoute('outreach_email')?.automatic_enabled) for (const item of created) void analyzeOutreachEmail({ db: this.db, aiRouter: this.aiRouter, emailId: item.emailId }).then(result => this.db.applyOutreachAiDetails(item.record.id, item.emailId, outreachEmailAnalysisView(result.analysis))).catch(error => console.warn('[Email sync] outreach card analysis failed after persistence', error));
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
      // UIDVALIDITY belongs to a mailbox, not to the whole IMAP account.
      const uidValidity = `${mailboxPath}\u001f${rawUidValidity}`;
      let previous = this.db.syncState(mailboxPath);
      if (!previous) {
        const importedLastUid = this.db.latestKnownEmailUid(uidValidity);
        if (importedLastUid) { this.db.saveSyncState(mailboxPath, rawUidValidity, importedLastUid); previous = this.db.syncState(mailboxPath); }
      }
      const initialImport = !previous?.uid_validity || previous.uid_validity !== rawUidValidity;
      const lastProcessedUid = previous?.last_processed_uid ?? 0;
      const startDate = new Date(); startDate.setUTCDate(startDate.getUTCDate() - settings.initial_sync_days);
      const ids = initialImport ? await client.search({ since: startDate }, { uid: true }) : await client.search({ uid: `${lastProcessedUid + 1}:*` }, { uid: true });
      const uids = Array.isArray(ids) ? ids : []; let maxUid = initialImport ? 0 : lastProcessedUid;
      for await (const message of client.fetch(uids, { uid: true, source: true, internalDate: true }, { uid: true })) {
        maxUid = Math.max(maxUid, message.uid); if (this.db.hasEmail(uidValidity, message.uid) || !message.source) continue;
        const parsed = await simpleParser(message.source as Buffer);
        const extracted = extractEmailText(parsed.text, typeof parsed.html === 'string' ? parsed.html : null);
        const sender = flattenAddresses(parsed.from)[0]; const recipients = [...flattenAddresses(parsed.to), ...flattenAddresses(parsed.cc), ...flattenAddresses(parsed.bcc)];
        const email = await this.processEmail({ uidValidity, uid: message.uid, receivedAt: new Date(message.internalDate ?? Date.now()).toISOString(), body: extracted.text, bodySource: extracted.source, initialImport, settings,
          rfcMessageId: parsed.messageId ?? null, inReplyTo: parsed.inReplyTo ?? null, references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [], subject: parsed.subject ?? null, senderName: sender?.name ?? null, senderEmail: sender?.address ?? null, recipients,
          direction: sender?.address === settings.username.trim().toLowerCase() ? 'outgoing' : sender?.address ? 'incoming' : 'unknown' });
        processed++; if (email.category === 'rejection') rejections++; if (email.review_status === 'pending_review') reviewItems++;
      }
      this.db.saveSyncState(mailboxPath, rawUidValidity, maxUid); return { processed, rejections, reviewItems, initialImport };
    } finally { lock.release(); }
  }
  private async processEmail(input: { uidValidity: string; uid: number; receivedAt: string; body: string; bodySource: EmailTextSource; initialImport: boolean; settings: ImapSettingsRow; rfcMessageId: string | null; inReplyTo: string | null; references: string[]; subject: string | null; senderName: string | null; senderEmail: string | null; recipients: Array<{ address: string; name: string | null }>; direction: 'incoming' | 'outgoing' | 'unknown' }) {
    const { settings } = input; let category: string | null = null; let classificationJson: string | null = null; let proposedJobId: string | null = null; let matchStatus: 'exact' | 'probable' | 'no_match' | null = null; let unresolvedReason: string | null = input.bodySource === 'missing' ? 'missing_text' : settings.ai_consent_at ? 'ai_not_configured' : 'ai_consent_required';
    if (input.direction !== 'outgoing' && input.bodySource !== 'missing' && !this.automaticAiUnavailable && settings.ai_consent_at && this.db.functionRoute('email')?.automatic_enabled) {
      try {
        const classification = (await this.aiRouter.run('email', 'email', ({ provider, connection }) => classifyEmail(provider, connection, input.body))).value;
        category = classification.category; classificationJson = JSON.stringify(classification);
        const match = matchEmailToJob(this.db.list({ archive: 'all' }).filter(job => job.record_type === 'application'), classification, input.body); proposedJobId = match.jobId; matchStatus = match.status; unresolvedReason = match.unresolvedReason;
      } catch (error) {
        // Automatic classification must never make mailbox persistence fail.
        // Stop retrying the provider during this run after its first failure.
        this.automaticAiUnavailable = true;
        unresolvedReason = error instanceof Error && error.message.includes('(429)') ? 'ai_rate_limited' : 'ai_unavailable';
      }
    }
    const reviewStatus = input.direction === 'outgoing' || category === 'other' ? 'ignored' : 'pending_review';
    let saved = this.db.saveEmail({ uid_validity: input.uidValidity, imap_uid: input.uid, received_at: input.receivedAt, body_text: input.body, body_source: input.bodySource, body_hash: crypto.createHash('sha256').update(input.body).digest('hex'), rfc_message_id: input.rfcMessageId, in_reply_to: input.inReplyTo, references_json: JSON.stringify(input.references), subject: input.subject, sender_name: input.senderName, sender_email: input.senderEmail, recipients_json: JSON.stringify(input.recipients), direction: input.direction, category, classification_json: classificationJson, proposed_job_id: proposedJobId, match_status: matchStatus, review_status: reviewStatus, unresolved_reason: unresolvedReason, initial_import: input.initialImport ? 1 : 0 });
    if (saved.review_status !== 'applied' && this.db.outreachCandidatesForEmail(saved.id).some(candidate => candidate.match_status === 'probable')) {
      saved = this.db.classifyEmail(saved.id, { category: saved.category, classification_json: saved.classification_json, proposed_job_id: saved.proposed_job_id, match_status: saved.match_status, unresolved_reason: 'outreach_candidate', review_status: 'pending_review' })!;
    }
    if (saved.body_source !== 'missing' && settings.ai_consent_at && this.db.functionRoute('outreach_email')?.automatic_enabled && this.db.outreachRecordIdsForEmail(saved.id).length) {
      const recordIds = this.db.outreachRecordIdsForEmail(saved.id);
      void analyzeOutreachEmail({ db: this.db, aiRouter: this.aiRouter, emailId: saved.id }).then(result => { const details = outreachEmailAnalysisView(result.analysis); for (const recordId of recordIds) this.db.applyOutreachAiDetails(recordId.record_id, saved.id, details); }).catch(error => console.warn('[Email sync] outreach email analysis failed after persistence', error));
    }
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
