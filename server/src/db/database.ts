import Database from 'better-sqlite3';
import type { InterviewStage, JobEventCreate, JobEventType, JobPatch, JobStatus, TagCreate, TagPatch } from '@job-tracker/shared';
import type { MatchClassification, MatchResult, ProviderType } from '../ai/schemas.js';

export type ParsedJob = { source: string; sourceJobId?: string; sourceUrl: string; title?: string; company?: string; location?: string; workplaceType?: string; employmentType?: string; descriptionHtml?: string; descriptionText?: string; easyApply?: boolean; warnings: string[]; parseStatus: 'parsed' | 'partial' | 'parse_failed'; parserVersion: string };
export type JobRow = { id: string; source: string; source_job_id: string | null; source_url: string; title: string | null; company: string | null; location: string | null; geo_country_code: string | null; geo_country: string | null; geo_region: string | null; geo_city: string | null; geo_source: 'ai' | 'manual' | null; workplace_type: string | null; employment_type: string | null; application_id: string | null; result_outcome: 'rejected' | 'offer' | 'withdrawn' | 'other' | null; archive_reason: 'email_exact' | 'email_review' | 'manual' | null; archive_seen_at: string | null; description_html: string | null; description_text: string | null; status: JobStatus; interview_stage: InterviewStage | null; notes: string; captured_at: string; created_at: string; updated_at: string; parse_status: string; last_event_at: string; stage_started_at: string };
export type ApplicationEffectivenessRow = { id: string; source: string; geo_country_code: string | null; geo_country: string | null; result_outcome: JobRow['result_outcome']; applied_at: string; response_at: string | null; ai_classification: MatchClassification | null; tags: string[] };
export type ApplicationSankeyRow = { id: string; source: string; geo_country_code: string | null; geo_country: string | null; result_outcome: JobRow['result_outcome']; applied_at: string; reached_hr: number; reached_technical: number; reached_final: number; reached_follow_up: number; tags: Array<{ id: string; name: string; color: string }> };
export type CohortApplicationRow = { id: string; applied_at: string; application_date_source: 'applied_event' | 'created_at'; first_response_event_at: string | null; first_response_email_at: string | null; first_hr_event_at: string | null; first_hr_email_at: string | null; has_undated_hr_progression: number };
export type JobEventRow = { id: string; job_id: string; type: JobEventType; occurred_at: string; note: string; created_at: string };
export type InterviewAppointmentStatus = 'proposed' | 'confirmed' | 'cancelled';
export type InterviewAppointmentRow = { id: string; job_id: string; stage: InterviewStage; starts_at: string; time_zone: string | null; format: 'video' | 'phone' | 'in_person' | 'other'; meeting_url: string | null; note: string; source_email_id: string | null; status: InterviewAppointmentStatus; created_at: string; updated_at: string };
export type TagRow = { id: string; name: string; color: string; created_at: string; updated_at: string };
export type AiConnectionRow = { id: string; provider_type: ProviderType; display_name: string; base_url: string | null; encrypted_api_key: string; model: string; temperature: number; max_output_tokens: number; timeout_ms: number; requests_per_minute: number; tokens_per_minute: number; email_requests_per_minute: number; enabled: number; profile_consent_at: string | null; created_at: string; updated_at: string };
export type AiConnectionPublic = Omit<AiConnectionRow, 'encrypted_api_key' | 'email_requests_per_minute' | 'enabled'> & { enabled: boolean; api_key_configured: boolean };
export type AiSettingsRow = { default_connection_id: string | null; default_model: string | null; tag_connection_id: string | null; email_connection_id: string | null; generic_parse_connection_id: string | null; auto_match_on_import: number; auto_tags_on_import: number; auto_generic_parse_on_import: number; auto_location_on_import: number; auto_email_classification: number };
export type AiAnalysisRow = { id: string; job_id: string; provider_connection_id: string | null; provider_type: ProviderType; model: string; profile_hash: string; job_description_hash: string; prompt_version: string; classification: MatchClassification | null; result_json: string | null; status: 'running' | 'completed' | 'failed'; error_message: string | null; created_at: string; completed_at: string | null };
export type ImapSettingsRow = { host: string; port: number; tls_mode: 'tls' | 'starttls'; username: string; encrypted_password: string; mailbox: string; interview_mailbox: string; rejection_mailbox: string; enabled: number; sync_interval_minutes: number; initial_sync_days: number; rejection_handling: 'manual_review' | 'auto_exact' | 'notifications_only'; ai_consent_at: string | null; last_sync_at: string | null; last_sync_status: string | null; last_error: string | null; processed_count: number; rejection_count: number; review_count: number; updated_at: string };
export type EmailRecordRow = { id: string; uid_validity: string; imap_uid: number; received_at: string; body_text: string; body_hash: string; category: string | null; classification_json: string | null; proposed_job_id: string | null; match_status: 'exact' | 'probable' | 'no_match' | null; review_status: 'pending_review' | 'applied' | 'ignored' | 'reverted'; unresolved_reason: string | null; initial_import: number; created_at: string; updated_at: string; job_title?: string | null; job_company?: string | null };
export type EmailLogRow = Omit<EmailRecordRow, 'body_text' | 'body_hash' | 'classification_json'>;
export type BackupSettingsRow = { webhook_url: string; encrypted_webhook_secret: string; automatic_enabled: number; interval_hours: number; last_sync_at: string | null; last_sync_status: string | null; last_error: string | null; updated_at: string };

export class JobDatabase {
  readonly db: Database.Database;
  constructor(path: string) { this.db = new Database(path); this.db.pragma('journal_mode = WAL'); this.db.pragma('foreign_keys = ON'); this.migrate(); }
  private migrate() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, source_job_id TEXT, source_url TEXT NOT NULL,
      title TEXT, company TEXT, location TEXT, geo_country_code TEXT, geo_country TEXT, geo_region TEXT, geo_city TEXT, geo_source TEXT, workplace_type TEXT, employment_type TEXT, application_id TEXT, result_outcome TEXT,
      description_html TEXT, description_text TEXT, status TEXT NOT NULL DEFAULT 'saved', interview_stage TEXT, notes TEXT NOT NULL DEFAULT '',
      captured_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, parse_status TEXT NOT NULL DEFAULT 'partial');
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_linkedin_source_id ON jobs(source, source_job_id) WHERE source_job_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_other_url ON jobs(source, source_url) WHERE source_job_id IS NULL;
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY, job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL, source TEXT NOT NULL, source_url TEXT NOT NULL,
        content_type TEXT NOT NULL, page_title TEXT, raw_html TEXT NOT NULL, raw_text TEXT, collector_version TEXT NOT NULL,
        parser_version TEXT NOT NULL, parse_status TEXT NOT NULL, captured_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS snapshots_job_id ON snapshots(job_id);
      CREATE TABLE IF NOT EXISTS job_events (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        type TEXT NOT NULL, occurred_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS job_events_job_date ON job_events(job_id, occurred_at DESC);
      CREATE TABLE IF NOT EXISTS interview_appointments (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        stage TEXT NOT NULL, starts_at TEXT NOT NULL, time_zone TEXT, format TEXT NOT NULL DEFAULT 'video', meeting_url TEXT, note TEXT NOT NULL DEFAULT '',
        source_email_id TEXT UNIQUE REFERENCES email_records(id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'confirmed', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS interview_appointments_job_start ON interview_appointments(job_id, starts_at);
      INSERT INTO job_events (id, job_id, type, occurred_at, note, created_at)
        SELECT lower(hex(randomblob(16))), id, 'saved', created_at, '', created_at FROM jobs
        WHERE NOT EXISTS (SELECT 1 FROM job_events WHERE job_events.job_id = jobs.id);
      UPDATE jobs SET status = 'sent' WHERE status IN ('applied', 'screening');
      UPDATE jobs SET status = 'result' WHERE status IN ('offer', 'rejected', 'withdrawn');
      CREATE TABLE IF NOT EXISTS ai_provider_connections (
        id TEXT PRIMARY KEY, provider_type TEXT NOT NULL, display_name TEXT NOT NULL, base_url TEXT,
        encrypted_api_key TEXT NOT NULL DEFAULT '', model TEXT NOT NULL, temperature REAL NOT NULL DEFAULT 0.1, max_output_tokens INTEGER NOT NULL DEFAULT 1200, timeout_ms INTEGER NOT NULL DEFAULT 60000, requests_per_minute INTEGER NOT NULL DEFAULT 10, tokens_per_minute INTEGER NOT NULL DEFAULT 60000, email_requests_per_minute INTEGER NOT NULL DEFAULT 10, enabled INTEGER NOT NULL DEFAULT 1,
        profile_consent_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_settings (id INTEGER PRIMARY KEY CHECK (id = 1), default_connection_id TEXT REFERENCES ai_provider_connections(id) ON DELETE SET NULL, default_model TEXT, tag_connection_id TEXT REFERENCES ai_provider_connections(id) ON DELETE SET NULL, email_connection_id TEXT REFERENCES ai_provider_connections(id) ON DELETE SET NULL, generic_parse_connection_id TEXT REFERENCES ai_provider_connections(id) ON DELETE SET NULL, auto_match_on_import INTEGER NOT NULL DEFAULT 0, auto_tags_on_import INTEGER NOT NULL DEFAULT 0, auto_generic_parse_on_import INTEGER NOT NULL DEFAULT 0, auto_location_on_import INTEGER NOT NULL DEFAULT 0, auto_email_classification INTEGER NOT NULL DEFAULT 1, auto_email_classification_initialized INTEGER NOT NULL DEFAULT 1);
      INSERT OR IGNORE INTO ai_settings (id, default_connection_id, default_model) VALUES (1, NULL, NULL);
      CREATE TABLE IF NOT EXISTS job_match_analyses (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        provider_connection_id TEXT REFERENCES ai_provider_connections(id) ON DELETE SET NULL, provider_type TEXT NOT NULL, model TEXT NOT NULL,
        profile_hash TEXT NOT NULL, job_description_hash TEXT NOT NULL, prompt_version TEXT NOT NULL,
        classification TEXT, result_json TEXT, status TEXT NOT NULL, error_message TEXT,
        created_at TEXT NOT NULL, completed_at TEXT);
      CREATE INDEX IF NOT EXISTS job_match_analyses_job_date ON job_match_analyses(job_id, created_at DESC);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, color TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS job_tags (job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(job_id, tag_id));
      CREATE INDEX IF NOT EXISTS job_tags_tag_id ON job_tags(tag_id);`);
    const jobColumns = this.db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>;
    if (!jobColumns.some(column => column.name === 'interview_stage')) this.db.exec('ALTER TABLE jobs ADD COLUMN interview_stage TEXT');
    if (!jobColumns.some(column => column.name === 'application_id')) this.db.exec('ALTER TABLE jobs ADD COLUMN application_id TEXT');
    if (!jobColumns.some(column => column.name === 'result_outcome')) this.db.exec('ALTER TABLE jobs ADD COLUMN result_outcome TEXT');
    if (!jobColumns.some(column => column.name === 'archive_reason')) this.db.exec('ALTER TABLE jobs ADD COLUMN archive_reason TEXT');
    if (!jobColumns.some(column => column.name === 'archive_seen_at')) this.db.exec('ALTER TABLE jobs ADD COLUMN archive_seen_at TEXT');
    if (!jobColumns.some(column => column.name === 'geo_country_code')) this.db.exec('ALTER TABLE jobs ADD COLUMN geo_country_code TEXT');
    if (!jobColumns.some(column => column.name === 'geo_country')) this.db.exec('ALTER TABLE jobs ADD COLUMN geo_country TEXT');
    if (!jobColumns.some(column => column.name === 'geo_region')) this.db.exec('ALTER TABLE jobs ADD COLUMN geo_region TEXT');
    if (!jobColumns.some(column => column.name === 'geo_city')) this.db.exec('ALTER TABLE jobs ADD COLUMN geo_city TEXT');
    if (!jobColumns.some(column => column.name === 'geo_source')) this.db.exec('ALTER TABLE jobs ADD COLUMN geo_source TEXT');
    const snapshotColumns = this.db.prepare('PRAGMA table_info(snapshots)').all() as Array<{ name: string }>;
    if (!snapshotColumns.some(column => column.name === 'page_title')) this.db.exec('ALTER TABLE snapshots ADD COLUMN page_title TEXT');
    this.db.exec("UPDATE jobs SET archive_reason='manual', archive_seen_at=COALESCE(archive_seen_at, updated_at) WHERE status='archived' AND archive_reason IS NULL");
    this.db.exec("UPDATE jobs SET interview_stage='interview' WHERE status='interview' AND interview_stage IS NULL");
    const connectionColumns = this.db.prepare('PRAGMA table_info(ai_provider_connections)').all() as Array<{ name: string }>;
    if (!connectionColumns.some(column => column.name === 'max_output_tokens')) this.db.exec('ALTER TABLE ai_provider_connections ADD COLUMN max_output_tokens INTEGER NOT NULL DEFAULT 1200');
    if (!connectionColumns.some(column => column.name === 'timeout_ms')) this.db.exec('ALTER TABLE ai_provider_connections ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 60000');
    if (!connectionColumns.some(column => column.name === 'email_requests_per_minute')) this.db.exec('ALTER TABLE ai_provider_connections ADD COLUMN email_requests_per_minute INTEGER NOT NULL DEFAULT 10');
    if (!connectionColumns.some(column => column.name === 'temperature')) this.db.exec('ALTER TABLE ai_provider_connections ADD COLUMN temperature REAL NOT NULL DEFAULT 0.1');
    if (!connectionColumns.some(column => column.name === 'requests_per_minute')) { this.db.exec('ALTER TABLE ai_provider_connections ADD COLUMN requests_per_minute INTEGER NOT NULL DEFAULT 10'); this.db.exec('UPDATE ai_provider_connections SET requests_per_minute=email_requests_per_minute'); }
    if (!connectionColumns.some(column => column.name === 'tokens_per_minute')) this.db.exec('ALTER TABLE ai_provider_connections ADD COLUMN tokens_per_minute INTEGER NOT NULL DEFAULT 60000');
    const settingsColumns = this.db.prepare('PRAGMA table_info(ai_settings)').all() as Array<{ name: string }>;
    if (!settingsColumns.some(column => column.name === 'tag_connection_id')) this.db.exec('ALTER TABLE ai_settings ADD COLUMN tag_connection_id TEXT REFERENCES ai_provider_connections(id) ON DELETE SET NULL');
    if (!settingsColumns.some(column => column.name === 'email_connection_id')) this.db.exec('ALTER TABLE ai_settings ADD COLUMN email_connection_id TEXT REFERENCES ai_provider_connections(id) ON DELETE SET NULL');
    if (!settingsColumns.some(column => column.name === 'generic_parse_connection_id')) this.db.exec('ALTER TABLE ai_settings ADD COLUMN generic_parse_connection_id TEXT REFERENCES ai_provider_connections(id) ON DELETE SET NULL');
    if (!settingsColumns.some(column => column.name === 'auto_match_on_import')) this.db.exec('ALTER TABLE ai_settings ADD COLUMN auto_match_on_import INTEGER NOT NULL DEFAULT 0');
    if (!settingsColumns.some(column => column.name === 'auto_tags_on_import')) this.db.exec('ALTER TABLE ai_settings ADD COLUMN auto_tags_on_import INTEGER NOT NULL DEFAULT 0');
    if (!settingsColumns.some(column => column.name === 'auto_generic_parse_on_import')) this.db.exec('ALTER TABLE ai_settings ADD COLUMN auto_generic_parse_on_import INTEGER NOT NULL DEFAULT 0');
    if (!settingsColumns.some(column => column.name === 'auto_location_on_import')) this.db.exec('ALTER TABLE ai_settings ADD COLUMN auto_location_on_import INTEGER NOT NULL DEFAULT 0');
    if (!settingsColumns.some(column => column.name === 'auto_email_classification')) this.db.exec('ALTER TABLE ai_settings ADD COLUMN auto_email_classification INTEGER NOT NULL DEFAULT 1');
    if (!settingsColumns.some(column => column.name === 'auto_email_classification_initialized')) this.db.exec('ALTER TABLE ai_settings ADD COLUMN auto_email_classification_initialized INTEGER NOT NULL DEFAULT 0');
    this.db.exec('UPDATE ai_settings SET auto_email_classification=1, auto_email_classification_initialized=1 WHERE auto_email_classification_initialized=0');
    this.db.exec(`CREATE TABLE IF NOT EXISTS imap_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1), host TEXT NOT NULL DEFAULT '', port INTEGER NOT NULL DEFAULT 993, tls_mode TEXT NOT NULL DEFAULT 'tls', username TEXT NOT NULL DEFAULT '', encrypted_password TEXT NOT NULL DEFAULT '', mailbox TEXT NOT NULL DEFAULT 'INBOX', interview_mailbox TEXT NOT NULL DEFAULT '', rejection_mailbox TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0,
      sync_interval_minutes INTEGER NOT NULL DEFAULT 15, initial_sync_days INTEGER NOT NULL DEFAULT 30, rejection_handling TEXT NOT NULL DEFAULT 'manual_review', ai_consent_at TEXT,
      last_sync_at TEXT, last_sync_status TEXT, last_error TEXT, processed_count INTEGER NOT NULL DEFAULT 0, rejection_count INTEGER NOT NULL DEFAULT 0, review_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT '');
      INSERT OR IGNORE INTO imap_settings (id, updated_at) VALUES (1, '');
      CREATE TABLE IF NOT EXISTS imap_sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), uid_validity TEXT, last_processed_uid INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT '');
      INSERT OR IGNORE INTO imap_sync_state (id, updated_at) VALUES (1, '');
      CREATE TABLE IF NOT EXISTS imap_sync_lock (id INTEGER PRIMARY KEY CHECK (id = 1), locked_until TEXT);
      INSERT OR IGNORE INTO imap_sync_lock (id, locked_until) VALUES (1, NULL);
      CREATE TABLE IF NOT EXISTS imap_mailbox_sync_state (
        mailbox TEXT PRIMARY KEY, uid_validity TEXT, last_processed_uid INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS email_records (
        id TEXT PRIMARY KEY, uid_validity TEXT NOT NULL, imap_uid INTEGER NOT NULL, received_at TEXT NOT NULL, body_text TEXT NOT NULL, body_hash TEXT NOT NULL,
        category TEXT, classification_json TEXT, proposed_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL, match_status TEXT, review_status TEXT NOT NULL DEFAULT 'pending_review', unresolved_reason TEXT, initial_import INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(uid_validity, imap_uid));
      CREATE INDEX IF NOT EXISTS email_records_review ON email_records(review_status, received_at DESC);
      CREATE TABLE IF NOT EXISTS email_effects (
        id TEXT PRIMARY KEY, email_id TEXT NOT NULL REFERENCES email_records(id) ON DELETE CASCADE, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        previous_status TEXT NOT NULL, previous_result_outcome TEXT, next_status TEXT NOT NULL, next_result_outcome TEXT, automatic INTEGER NOT NULL, applied_at TEXT NOT NULL, reverted_at TEXT,
        UNIQUE(email_id, job_id));
      CREATE TABLE IF NOT EXISTS backup_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1), webhook_url TEXT NOT NULL DEFAULT '', encrypted_webhook_secret TEXT NOT NULL DEFAULT '', automatic_enabled INTEGER NOT NULL DEFAULT 0,
        interval_hours INTEGER NOT NULL DEFAULT 24, last_sync_at TEXT, last_sync_status TEXT, last_error TEXT, updated_at TEXT NOT NULL DEFAULT '');
      INSERT OR IGNORE INTO backup_settings (id, updated_at) VALUES (1, '');`);
    const imapColumns = this.db.prepare('PRAGMA table_info(imap_settings)').all() as Array<{ name: string }>;
    const needsMailboxUpgrade = !imapColumns.some(column => column.name === 'interview_mailbox');
    if (needsMailboxUpgrade) this.db.exec("ALTER TABLE imap_settings ADD COLUMN interview_mailbox TEXT NOT NULL DEFAULT ''");
    if (!imapColumns.some(column => column.name === 'rejection_mailbox')) this.db.exec("ALTER TABLE imap_settings ADD COLUMN rejection_mailbox TEXT NOT NULL DEFAULT ''");
    if (needsMailboxUpgrade) {
      this.db.exec("UPDATE imap_settings SET interview_mailbox=mailbox WHERE interview_mailbox='' AND mailbox<>''");
      this.db.exec(`INSERT OR IGNORE INTO imap_mailbox_sync_state (mailbox, uid_validity, last_processed_uid, updated_at)
        SELECT interview_mailbox, uid_validity, last_processed_uid, imap_sync_state.updated_at
        FROM imap_settings CROSS JOIN imap_sync_state WHERE interview_mailbox<>''`);
    }
    this.db.exec("UPDATE jobs SET status='archived', archive_reason=CASE WHEN EXISTS (SELECT 1 FROM email_effects WHERE email_effects.job_id=jobs.id AND email_effects.automatic=1) THEN 'email_exact' ELSE 'email_review' END, archive_seen_at=updated_at WHERE status='result' AND result_outcome='rejected' AND EXISTS (SELECT 1 FROM email_effects WHERE email_effects.job_id=jobs.id)");
  }
  import(parsed: ParsedJob, raw: { html: string; text: string | null; collectorVersion: string; capturedAt: string; pageTitle?: string }) {
    const now = new Date().toISOString();
    const existing = parsed.sourceJobId
      ? this.db.prepare('SELECT * FROM jobs WHERE source = ? AND source_job_id = ?').get(parsed.source, parsed.sourceJobId) as JobRow | undefined
      : this.db.prepare('SELECT * FROM jobs WHERE source_url = ? AND source_job_id IS NULL').get(parsed.sourceUrl) as JobRow | undefined;
    let jobId: string; let action: 'created' | 'updated' | 'unchanged';
    const comparable = JSON.stringify([parsed.title ?? null, parsed.company ?? null, parsed.location ?? null, parsed.workplaceType ?? null, parsed.employmentType ?? null, parsed.descriptionHtml ?? null, parsed.descriptionText ?? null, parsed.parseStatus]);
    if (existing) {
      jobId = existing.id;
      const prior = JSON.stringify([existing.title, existing.company, existing.location, existing.workplace_type, existing.employment_type, existing.description_html, existing.description_text, existing.parse_status]);
      action = prior === comparable ? 'unchanged' : 'updated';
      if (action === 'updated') this.db.prepare(`UPDATE jobs SET source=?, source_url=?, title=?, company=?, location=?, workplace_type=?, employment_type=?, description_html=?, description_text=?, captured_at=?, updated_at=?, parse_status=? WHERE id=?`).run(parsed.source, parsed.sourceUrl, parsed.title ?? null, parsed.company ?? null, parsed.location ?? null, parsed.workplaceType ?? null, parsed.employmentType ?? null, parsed.descriptionHtml ?? null, parsed.descriptionText ?? null, raw.capturedAt, now, parsed.parseStatus, jobId);
    } else {
      jobId = crypto.randomUUID(); action = 'created';
      this.db.prepare(`INSERT INTO jobs (id,source,source_job_id,source_url,title,company,location,workplace_type,employment_type,description_html,description_text,status,notes,captured_at,created_at,updated_at,parse_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(jobId, parsed.source, parsed.sourceJobId ?? null, parsed.sourceUrl, parsed.title ?? null, parsed.company ?? null, parsed.location ?? null, parsed.workplaceType ?? null, parsed.employmentType ?? null, parsed.descriptionHtml ?? null, parsed.descriptionText ?? null, 'saved', '', raw.capturedAt, now, now, parsed.parseStatus);
      this.insertEvent(jobId, 'saved', now);
    }
    this.db.prepare('INSERT INTO snapshots (id,job_id,source,source_url,content_type,page_title,raw_html,raw_text,collector_version,parser_version,parse_status,captured_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), jobId, parsed.source, parsed.sourceUrl, 'job', raw.pageTitle ?? null, raw.html, raw.text, raw.collectorVersion, parsed.parserVersion, parsed.parseStatus, raw.capturedAt, now);
    return { jobId, action };
  }
  list(filters: { search?: string; status?: string; source?: string; tag?: string; country?: string; order?: string; archive?: string }) {
    const where: string[] = []; const values: unknown[] = [];
    if (filters.search) { where.push('(title LIKE ? OR company LIKE ?)'); values.push(`%${filters.search}%`, `%${filters.search}%`); }
    if (filters.status) { where.push('status = ?'); values.push(filters.status); }
    if (filters.source) { where.push('source = ?'); values.push(filters.source); }
    if (filters.tag) { where.push('EXISTS (SELECT 1 FROM job_tags WHERE job_tags.job_id=jobs.id AND job_tags.tag_id=?)'); values.push(filters.tag); }
    if (filters.country) { where.push('geo_country_code = ?'); values.push(filters.country.toUpperCase()); }
    if (filters.archive === 'only') where.push("status = 'archived'");
    else where.push("status != 'archived'");
    const order = { newest: 'jobs.captured_at DESC', oldest: 'jobs.captured_at ASC', updated: 'jobs.updated_at DESC', company: 'jobs.company COLLATE NOCASE ASC', location: 'jobs.location COLLATE NOCASE ASC', title: 'jobs.title COLLATE NOCASE ASC', waiting: 'last_event_at ASC' }[filters.order ?? 'newest'] ?? 'jobs.captured_at DESC';
    return this.db.prepare(`SELECT jobs.*, COALESCE((SELECT MAX(occurred_at) FROM job_events WHERE job_id = jobs.id), jobs.created_at) AS last_event_at,
      CASE jobs.status
        WHEN 'saved' THEN jobs.created_at
        WHEN 'sent' THEN COALESCE((SELECT MAX(occurred_at) FROM job_events WHERE job_id = jobs.id AND type = 'applied'), jobs.updated_at, jobs.created_at)
        WHEN 'interview' THEN COALESCE((SELECT MAX(occurred_at) FROM job_events WHERE job_id = jobs.id AND type IN ('hr_screening', 'interview', 'final_interview', 'follow_up')), jobs.updated_at, jobs.created_at)
        WHEN 'result' THEN COALESCE((SELECT MAX(occurred_at) FROM job_events WHERE job_id = jobs.id AND type = 'result'), jobs.updated_at, jobs.created_at)
        ELSE COALESCE(jobs.updated_at, jobs.created_at)
      END AS stage_started_at,
      (SELECT classification FROM job_match_analyses WHERE job_id = jobs.id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1) AS ai_classification,
      (SELECT result_json FROM job_match_analyses WHERE job_id = jobs.id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1) AS ai_result_json,
      (SELECT model FROM job_match_analyses WHERE job_id = jobs.id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1) AS ai_model,
      (SELECT completed_at FROM job_match_analyses WHERE job_id = jobs.id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1) AS ai_completed_at,
      (SELECT profile_hash FROM job_match_analyses WHERE job_id = jobs.id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1) AS ai_profile_hash,
      (SELECT job_description_hash FROM job_match_analyses WHERE job_id = jobs.id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1) AS ai_job_hash
      FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order}`).all(...values) as JobRow[];
  }
  geographyBackfillCandidates(options: { includeArchived?: boolean; limit?: number } = {}) {
    const archiveClause = options.includeArchived ? '' : "AND status != 'archived'";
    const limit = Math.max(1, Math.min(options.limit ?? 10_000, 100_000));
    return this.db.prepare(`SELECT jobs.*, COALESCE((SELECT MAX(occurred_at) FROM job_events WHERE job_id = jobs.id), jobs.created_at) AS last_event_at,
      CASE jobs.status WHEN 'saved' THEN jobs.created_at ELSE COALESCE(jobs.updated_at, jobs.created_at) END AS stage_started_at
      FROM jobs WHERE geo_source IS NULL AND geo_country_code IS NULL AND geo_country IS NULL AND geo_region IS NULL AND geo_city IS NULL
      AND (COALESCE(location, '') <> '' OR COALESCE(description_text, '') <> '') ${archiveClause}
      ORDER BY created_at ASC LIMIT ?`).all(limit) as JobRow[];
  }
  get(id: string) { return this.db.prepare(`SELECT jobs.*, COALESCE((SELECT MAX(occurred_at) FROM job_events WHERE job_id = jobs.id), jobs.created_at) AS last_event_at,
    CASE jobs.status
      WHEN 'saved' THEN jobs.created_at
      WHEN 'sent' THEN COALESCE((SELECT MAX(occurred_at) FROM job_events WHERE job_id = jobs.id AND type = 'applied'), jobs.updated_at, jobs.created_at)
      WHEN 'interview' THEN COALESCE((SELECT MAX(occurred_at) FROM job_events WHERE job_id = jobs.id AND type IN ('hr_screening', 'interview', 'final_interview', 'follow_up')), jobs.updated_at, jobs.created_at)
      WHEN 'result' THEN COALESCE((SELECT MAX(occurred_at) FROM job_events WHERE job_id = jobs.id AND type = 'result'), jobs.updated_at, jobs.created_at)
      ELSE COALESCE(jobs.updated_at, jobs.created_at)
    END AS stage_started_at
    FROM jobs WHERE id=?`).get(id) as JobRow | undefined; }
  events(id: string) { return this.db.prepare('SELECT * FROM job_events WHERE job_id=? ORDER BY occurred_at DESC, created_at DESC').all(id) as JobEventRow[]; }
  firstApplicationDay() { return (this.db.prepare(`WITH applications AS (
    SELECT job_id, MIN(occurred_at) AS applied_at FROM job_events WHERE type='applied' GROUP BY job_id
    UNION ALL
    SELECT jobs.id, jobs.created_at FROM jobs
    WHERE NOT EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type='applied')
      AND (jobs.status IN ('sent','interview','result') OR jobs.result_outcome IS NOT NULL
        OR EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type IN ('hr_screening','interview','final_interview','follow_up','rejection_received')))
  ) SELECT substr(MIN(applied_at), 1, 10) AS day FROM applications`).get() as { day: string | null }).day; }
  applicationStats(from?: string, to?: string) {
    const applications = `WITH applications AS (
      SELECT job_id, MIN(occurred_at) AS applied_at FROM job_events WHERE type='applied' GROUP BY job_id
      UNION ALL
      SELECT jobs.id, jobs.created_at FROM jobs
      WHERE NOT EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type='applied')
        AND (jobs.status IN ('sent','interview','result') OR jobs.result_outcome IS NOT NULL
          OR EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type IN ('hr_screening','interview','final_interview','follow_up','rejection_received')))
    ) SELECT substr(applied_at, 1, 10) AS day, COUNT(*) AS count FROM applications`;
    if (!from || !to) return this.db.prepare(`${applications} GROUP BY substr(applied_at, 1, 10) ORDER BY day`).all() as Array<{ day: string; count: number }>;
    const end = new Date(`${to}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1);
    return this.db.prepare(`${applications} WHERE applied_at >= ? AND applied_at < ? GROUP BY substr(applied_at, 1, 10) ORDER BY day`).all(`${from}T00:00:00.000Z`, end.toISOString()) as Array<{ day: string; count: number }>;
  }
  applicationEffectiveness(from?: string, to?: string) {
    const values: string[] = []; const where: string[] = [];
    if (from && to) { const end = new Date(`${to}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1); where.push('applications.applied_at >= ?', 'applications.applied_at < ?'); values.push(`${from}T00:00:00.000Z`, end.toISOString()); }
    const rows = this.db.prepare(`WITH applications AS (
      SELECT job_id, MIN(occurred_at) AS applied_at FROM job_events WHERE type='applied' GROUP BY job_id
      UNION ALL
      SELECT jobs.id, COALESCE((SELECT MIN(occurred_at) FROM job_events WHERE job_id=jobs.id AND type IN ('hr_screening', 'interview', 'final_interview', 'follow_up')), jobs.created_at)
      FROM jobs
      WHERE (jobs.status IN ('sent', 'interview', 'result') OR jobs.result_outcome IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type='applied')
    )
      SELECT jobs.id, jobs.source, jobs.geo_country_code, jobs.geo_country, jobs.result_outcome, applications.applied_at,
        (SELECT MIN(occurred_at) FROM job_events WHERE job_id=jobs.id AND type IN ('hr_screening', 'interview', 'final_interview', 'follow_up') AND occurred_at >= applications.applied_at) AS response_at,
        (SELECT classification FROM job_match_analyses WHERE job_id=jobs.id AND status='completed' ORDER BY completed_at DESC LIMIT 1) AS ai_classification
      FROM jobs JOIN applications ON applications.job_id=jobs.id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`).all(...values) as Array<Omit<ApplicationEffectivenessRow, 'tags'>>;
    const tagsByJob = new Map<string, string[]>();
    if (rows.length) { const tagRows = this.db.prepare(`SELECT job_tags.job_id, tags.name FROM job_tags JOIN tags ON tags.id=job_tags.tag_id WHERE job_tags.job_id IN (${rows.map(() => '?').join(',')})`).all(...rows.map(row => row.id)) as Array<{ job_id: string; name: string }>; for (const tag of tagRows) tagsByJob.set(tag.job_id, [...(tagsByJob.get(tag.job_id) ?? []), tag.name]); }
    return rows.map(row => ({ ...row, tags: tagsByJob.get(row.id) ?? [] }));
  }
  applicationSankey(from?: string, to?: string) {
    const values: string[] = []; const where: string[] = [];
    if (from && to) { const end = new Date(`${to}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1); where.push('applications.applied_at >= ?', 'applications.applied_at < ?'); values.push(`${from}T00:00:00.000Z`, end.toISOString()); }
    const rows = this.db.prepare(`WITH applications AS (
      SELECT job_id, MIN(occurred_at) AS applied_at FROM job_events WHERE type='applied' GROUP BY job_id
      UNION ALL
      SELECT jobs.id, COALESCE((SELECT MIN(occurred_at) FROM job_events WHERE job_id=jobs.id AND type IN ('hr_screening', 'interview', 'final_interview', 'follow_up')), jobs.created_at)
      FROM jobs
      WHERE (jobs.status IN ('sent', 'interview', 'result') OR jobs.result_outcome IS NOT NULL
        OR (jobs.status='archived' AND EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type IN ('hr_screening', 'interview', 'final_interview', 'follow_up'))))
        AND NOT EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type='applied')
    ) SELECT jobs.id, jobs.source, jobs.geo_country_code, jobs.geo_country, CASE WHEN jobs.result_outcome IS NOT NULL THEN jobs.result_outcome WHEN jobs.status='archived' THEN 'rejected' ELSE NULL END AS result_outcome, applications.applied_at,
      CASE WHEN EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type='hr_screening' AND occurred_at >= applications.applied_at) THEN 1 ELSE 0 END AS reached_hr,
      CASE WHEN EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type='interview' AND occurred_at >= applications.applied_at) THEN 1 ELSE 0 END AS reached_technical,
      CASE WHEN EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type='final_interview' AND occurred_at >= applications.applied_at) THEN 1 ELSE 0 END AS reached_final,
      CASE WHEN EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type='follow_up' AND occurred_at >= applications.applied_at) THEN 1 ELSE 0 END AS reached_follow_up
      FROM jobs JOIN applications ON applications.job_id=jobs.id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`).all(...values) as Array<Omit<ApplicationSankeyRow, 'tags'>>;
    const tagsByJob = new Map<string, Array<{ id: string; name: string; color: string }>>();
    if (rows.length) {
      const tagRows = this.db.prepare(`SELECT job_tags.job_id, tags.id, tags.name, tags.color FROM job_tags JOIN tags ON tags.id=job_tags.tag_id WHERE job_tags.job_id IN (${rows.map(() => '?').join(',')})`).all(...rows.map(row => row.id)) as Array<{ job_id: string; id: string; name: string; color: string }>;
      for (const tag of tagRows) tagsByJob.set(tag.job_id, [...(tagsByJob.get(tag.job_id) ?? []), { id: tag.id, name: tag.name, color: tag.color }]);
    }
    return rows.map(row => ({ ...row, tags: tagsByJob.get(row.id) ?? [] }));
  }
  cohortApplications(from?: string, to?: string) {
    const values: string[] = []; const where: string[] = [];
    if (from && to) { const end = new Date(`${to}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1); where.push('applications.applied_at >= ?', 'applications.applied_at < ?'); values.push(`${from}T00:00:00.000Z`, end.toISOString()); }
    return this.db.prepare(`WITH applications AS (
      SELECT job_id, MIN(occurred_at) AS applied_at, 'applied_event' AS application_date_source FROM job_events WHERE type='applied' GROUP BY job_id
      UNION ALL
      SELECT jobs.id, jobs.created_at AS applied_at, 'created_at' AS application_date_source
      FROM jobs
      WHERE NOT EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type='applied')
        AND (jobs.status IN ('sent','interview','result') OR jobs.result_outcome IS NOT NULL
          OR EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type IN ('hr_screening','interview','final_interview','follow_up','rejection_received')))
    ) SELECT jobs.id, applications.applied_at, applications.application_date_source,
      (SELECT MIN(occurred_at) FROM job_events WHERE job_id=jobs.id AND type IN ('rejection_received','hr_screening','interview','final_interview','follow_up') AND occurred_at >= applications.applied_at) AS first_response_event_at,
      (SELECT MIN(received_at) FROM email_records WHERE proposed_job_id=jobs.id AND review_status='applied' AND category IN ('rejection','interview_invitation','assessment','decision_delayed','offer') AND received_at >= applications.applied_at) AS first_response_email_at,
      (SELECT MIN(occurred_at) FROM job_events WHERE job_id=jobs.id AND type IN ('hr_screening','interview','final_interview','follow_up') AND occurred_at >= applications.applied_at) AS first_hr_event_at,
      (SELECT MIN(received_at) FROM email_records WHERE proposed_job_id=jobs.id AND review_status='applied' AND category IN ('interview_invitation','offer') AND received_at >= applications.applied_at) AS first_hr_email_at,
      CASE WHEN (jobs.status='interview' OR jobs.result_outcome='offer')
        AND NOT EXISTS (SELECT 1 FROM job_events WHERE job_id=jobs.id AND type IN ('hr_screening','interview','final_interview','follow_up') AND occurred_at >= applications.applied_at)
        AND NOT EXISTS (SELECT 1 FROM email_records WHERE proposed_job_id=jobs.id AND review_status='applied' AND category IN ('interview_invitation','offer') AND received_at >= applications.applied_at)
      THEN 1 ELSE 0 END AS has_undated_hr_progression
      FROM applications JOIN jobs ON jobs.id=applications.job_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`).all(...values) as CohortApplicationRow[];
  }
  cohortMissingApplicationDate() { return 0; }
  jobCounts() { return this.db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='archived' THEN 1 ELSE 0 END) AS archived FROM jobs").get() as { total: number; archived: number | null }; }
  private insertEvent(jobId: string, type: JobEventType, occurredAt: string, note = '') { this.db.prepare('INSERT INTO job_events (id,job_id,type,occurred_at,note,created_at) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(), jobId, type, occurredAt, note, new Date().toISOString()); }
  appointments(jobId: string) { return this.db.prepare("SELECT * FROM interview_appointments WHERE job_id=? ORDER BY CASE status WHEN 'cancelled' THEN 1 ELSE 0 END, starts_at ASC").all(jobId) as InterviewAppointmentRow[]; }
  nextAppointment(jobId: string) { const now = new Date().toISOString(); return this.db.prepare("SELECT * FROM interview_appointments WHERE job_id=? AND status IN ('proposed', 'confirmed') ORDER BY CASE WHEN starts_at >= ? THEN 0 ELSE 1 END, CASE WHEN starts_at >= ? THEN starts_at END ASC, CASE WHEN starts_at < ? THEN starts_at END DESC LIMIT 1").get(jobId, now, now, now) as InterviewAppointmentRow | undefined; }
  createAppointment(jobId: string, input: Pick<InterviewAppointmentRow, 'stage' | 'starts_at' | 'time_zone' | 'format' | 'meeting_url' | 'note'> & { status?: InterviewAppointmentStatus; source_email_id?: string | null }) {
    if (!this.get(jobId)) return undefined;
    const now = new Date().toISOString(); const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO interview_appointments (id,job_id,stage,starts_at,time_zone,format,meeting_url,note,source_email_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, jobId, input.stage, input.starts_at, input.time_zone ?? null, input.format, input.meeting_url ?? null, input.note, input.source_email_id ?? null, input.status ?? 'confirmed', now, now);
    return this.db.prepare('SELECT * FROM interview_appointments WHERE id=?').get(id) as InterviewAppointmentRow;
  }
  updateAppointment(jobId: string, appointmentId: string, input: Partial<Pick<InterviewAppointmentRow, 'stage' | 'starts_at' | 'time_zone' | 'format' | 'meeting_url' | 'note' | 'status'>>) {
    const old = this.db.prepare('SELECT * FROM interview_appointments WHERE id=? AND job_id=?').get(appointmentId, jobId) as InterviewAppointmentRow | undefined; if (!old) return undefined;
    this.db.prepare('UPDATE interview_appointments SET stage=?, starts_at=?, time_zone=?, format=?, meeting_url=?, note=?, status=?, updated_at=? WHERE id=?').run(input.stage ?? old.stage, input.starts_at ?? old.starts_at, input.time_zone === undefined ? old.time_zone : input.time_zone, input.format ?? old.format, input.meeting_url === undefined ? old.meeting_url : input.meeting_url, input.note ?? old.note, input.status ?? old.status, new Date().toISOString(), appointmentId);
    return this.db.prepare('SELECT * FROM interview_appointments WHERE id=?').get(appointmentId) as InterviewAppointmentRow;
  }
  addEvent(id: string, event: JobEventCreate) { const old = this.get(id); if (!old) return undefined; this.insertEvent(id, event.type, event.occurred_at, event.note); const interviewStage = ['hr_screening', 'interview', 'final_interview', 'follow_up'].includes(event.type) ? event.type as InterviewStage : null; this.db.prepare('UPDATE jobs SET status=?, interview_stage=?, updated_at=? WHERE id=?').run(interviewStage ? 'interview' : old.status, interviewStage ?? old.interview_stage, new Date().toISOString(), id); return this.get(id); }
  update(id: string, patch: JobPatch) {
    const old = this.get(id); if (!old) return undefined;
    const status = patch.interview_stage ? 'interview' : patch.status ?? old.status;
    const interviewStage = status === 'interview' ? patch.interview_stage ?? (old.status === 'interview' ? old.interview_stage ?? 'hr_screening' : 'hr_screening') : null;
    const now = new Date().toISOString();
    const archiveReason = status === 'archived' ? (patch.status === 'archived' ? 'manual' : old.archive_reason) : null; const archiveSeenAt = status === 'archived' ? (patch.status === 'archived' ? now : old.archive_seen_at) : null;
    const geoTouched = patch.geo_country_code !== undefined || patch.geo_country !== undefined || patch.geo_region !== undefined || patch.geo_city !== undefined;
    const geoChanged = geoTouched && (patch.geo_country_code !== undefined && patch.geo_country_code !== old.geo_country_code || patch.geo_country !== undefined && patch.geo_country !== old.geo_country || patch.geo_region !== undefined && patch.geo_region !== old.geo_region || patch.geo_city !== undefined && patch.geo_city !== old.geo_city);
    const geoSource = patch.geo_source === undefined ? (geoChanged ? 'manual' : old.geo_source) : patch.geo_source;
    this.db.prepare('UPDATE jobs SET source_url=?, title=?, company=?, location=?, geo_country_code=?, geo_country=?, geo_region=?, geo_city=?, geo_source=?, employment_type=?, workplace_type=?, application_id=?, result_outcome=?, status=?, interview_stage=?, archive_reason=?, archive_seen_at=?, notes=?, created_at=?, updated_at=? WHERE id=?').run(patch.source_url ?? old.source_url, patch.title ?? old.title, patch.company === undefined ? old.company : patch.company, patch.location === undefined ? old.location : patch.location, patch.geo_country_code === undefined ? old.geo_country_code : patch.geo_country_code, patch.geo_country === undefined ? old.geo_country : patch.geo_country, patch.geo_region === undefined ? old.geo_region : patch.geo_region, patch.geo_city === undefined ? old.geo_city : patch.geo_city, geoSource, patch.employment_type === undefined ? old.employment_type : patch.employment_type, patch.workplace_type === undefined ? old.workplace_type : patch.workplace_type, patch.application_id === undefined ? old.application_id : patch.application_id, patch.result_outcome === undefined ? old.result_outcome : patch.result_outcome, status, interviewStage, archiveReason, archiveSeenAt, patch.notes ?? old.notes, patch.created_at ?? old.created_at, now, id);
    if (status === 'interview' && interviewStage && interviewStage !== old.interview_stage) this.insertEvent(id, interviewStage, now);
    else if (patch.status && patch.status !== old.status) { const eventType: Partial<Record<JobStatus, JobEventType>> = { sent: 'applied', result: 'result' }; const event = eventType[status]; if (event) this.insertEvent(id, event, now); }
    return this.get(id);
  }
  delete(id: string) { return this.db.prepare('DELETE FROM jobs WHERE id=?').run(id).changes > 0; }
  listTags() { return this.db.prepare('SELECT * FROM tags ORDER BY name COLLATE NOCASE').all() as TagRow[]; }
  listTagsWithUsage() { return this.db.prepare('SELECT tags.*, COUNT(job_tags.job_id) AS job_count FROM tags LEFT JOIN job_tags ON job_tags.tag_id=tags.id GROUP BY tags.id ORDER BY job_count DESC, tags.name COLLATE NOCASE').all() as Array<TagRow & { job_count: number }>; }
  createTag(input: TagCreate) { const now = new Date().toISOString(); const tag = { id: crypto.randomUUID(), ...input, created_at: now, updated_at: now }; this.db.prepare('INSERT INTO tags (id,name,color,created_at,updated_at) VALUES (?,?,?,?,?)').run(tag.id, tag.name, tag.color, now, now); return tag; }
  updateTag(id: string, input: TagPatch) { const old = this.db.prepare('SELECT * FROM tags WHERE id=?').get(id) as TagRow | undefined; if (!old) return undefined; const now = new Date().toISOString(); this.db.prepare('UPDATE tags SET name=?, color=?, updated_at=? WHERE id=?').run(input.name ?? old.name, input.color ?? old.color, now, id); return this.db.prepare('SELECT * FROM tags WHERE id=?').get(id) as TagRow; }
  deleteTag(id: string) { return this.db.prepare('DELETE FROM tags WHERE id=?').run(id).changes > 0; }
  tagsForJob(id: string) { return this.db.prepare('SELECT tags.* FROM tags JOIN job_tags ON job_tags.tag_id=tags.id WHERE job_tags.job_id=? ORDER BY tags.name COLLATE NOCASE').all(id) as TagRow[]; }
  setTags(id: string, tagIds: string[]) { if (!this.get(id)) return undefined; const uniqueTagIds = [...new Set(tagIds)]; const existing = this.db.prepare(`SELECT id FROM tags WHERE id IN (${uniqueTagIds.map(() => '?').join(',') || "''"})`).all(...uniqueTagIds) as Array<{ id: string }>; if (existing.length !== uniqueTagIds.length) throw new Error('Unknown tag'); const transaction = this.db.transaction(() => { this.db.prepare('DELETE FROM job_tags WHERE job_id=?').run(id); const insert = this.db.prepare('INSERT INTO job_tags (job_id,tag_id) VALUES (?,?)'); uniqueTagIds.forEach(tagId => insert.run(id, tagId)); }); transaction(); return this.tagsForJob(id); }
  latestSnapshot(id: string) { return this.db.prepare('SELECT * FROM snapshots WHERE job_id=? ORDER BY created_at DESC LIMIT 1').get(id) as { source: string; source_url: string; page_title: string | null; raw_html: string; raw_text: string | null; captured_at: string } | undefined; }
  listConnections() { return (this.db.prepare('SELECT * FROM ai_provider_connections ORDER BY created_at DESC').all() as AiConnectionRow[]).map(this.publicConnection); }
  private publicConnection = ({ encrypted_api_key, email_requests_per_minute: _legacyEmailRequestsPerMinute, enabled, ...row }: AiConnectionRow): AiConnectionPublic => ({ ...row, enabled: Boolean(enabled), api_key_configured: Boolean(encrypted_api_key) });
  getConnection(id: string) { return this.db.prepare('SELECT * FROM ai_provider_connections WHERE id=?').get(id) as AiConnectionRow | undefined; }
  createConnection(input: { provider_type: ProviderType; display_name: string; base_url?: string; encrypted_api_key: string; model: string; temperature: number; max_output_tokens: number; timeout_ms: number; requests_per_minute: number; tokens_per_minute: number; enabled: boolean }) { const now = new Date().toISOString(); const id = crypto.randomUUID(); this.db.prepare('INSERT INTO ai_provider_connections (id,provider_type,display_name,base_url,encrypted_api_key,model,temperature,max_output_tokens,timeout_ms,requests_per_minute,tokens_per_minute,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, input.provider_type, input.display_name, input.base_url || null, input.encrypted_api_key, input.model, input.temperature, input.max_output_tokens, input.timeout_ms, input.requests_per_minute, input.tokens_per_minute, input.enabled ? 1 : 0, now, now); return this.publicConnection(this.getConnection(id)!); }
  updateConnection(id: string, input: Partial<{ provider_type: ProviderType; display_name: string; base_url: string; encrypted_api_key: string; model: string; temperature: number; max_output_tokens: number; timeout_ms: number; requests_per_minute: number; tokens_per_minute: number; enabled: boolean }>) { const old = this.getConnection(id); if (!old) return undefined; const now = new Date().toISOString(); this.db.prepare('UPDATE ai_provider_connections SET provider_type=?, display_name=?, base_url=?, encrypted_api_key=?, model=?, temperature=?, max_output_tokens=?, timeout_ms=?, requests_per_minute=?, tokens_per_minute=?, enabled=?, updated_at=? WHERE id=?').run(input.provider_type ?? old.provider_type, input.display_name ?? old.display_name, input.base_url === undefined ? old.base_url : input.base_url || null, input.encrypted_api_key ?? old.encrypted_api_key, input.model ?? old.model, input.temperature ?? old.temperature, input.max_output_tokens ?? old.max_output_tokens, input.timeout_ms ?? old.timeout_ms, input.requests_per_minute ?? old.requests_per_minute, input.tokens_per_minute ?? old.tokens_per_minute, input.enabled === undefined ? old.enabled : input.enabled ? 1 : 0, now, id); return this.publicConnection(this.getConnection(id)!); }
  deleteConnection(id: string) { const remove = this.db.transaction((connectionId: string) => { this.db.prepare('UPDATE ai_settings SET default_connection_id=CASE WHEN default_connection_id=? THEN NULL ELSE default_connection_id END, tag_connection_id=CASE WHEN tag_connection_id=? THEN NULL ELSE tag_connection_id END, email_connection_id=CASE WHEN email_connection_id=? THEN NULL ELSE email_connection_id END, generic_parse_connection_id=CASE WHEN generic_parse_connection_id=? THEN NULL ELSE generic_parse_connection_id END WHERE id=1').run(connectionId, connectionId, connectionId, connectionId); return this.db.prepare('DELETE FROM ai_provider_connections WHERE id=?').run(connectionId).changes > 0; }); return remove(id); }
  settings() { return this.db.prepare('SELECT default_connection_id, default_model, tag_connection_id, email_connection_id, generic_parse_connection_id, auto_match_on_import, auto_tags_on_import, auto_generic_parse_on_import, auto_location_on_import, auto_email_classification FROM ai_settings WHERE id=1').get() as AiSettingsRow; }
  updateSettings(patch: Partial<AiSettingsRow>) { const old = this.settings(); this.db.prepare('UPDATE ai_settings SET default_connection_id=?, default_model=?, tag_connection_id=?, email_connection_id=?, generic_parse_connection_id=?, auto_match_on_import=?, auto_tags_on_import=?, auto_generic_parse_on_import=?, auto_location_on_import=?, auto_email_classification=? WHERE id=1').run(patch.default_connection_id === undefined ? old.default_connection_id : patch.default_connection_id, patch.default_model === undefined ? old.default_model : patch.default_model, patch.tag_connection_id === undefined ? old.tag_connection_id : patch.tag_connection_id, patch.email_connection_id === undefined ? old.email_connection_id : patch.email_connection_id, patch.generic_parse_connection_id === undefined ? old.generic_parse_connection_id : patch.generic_parse_connection_id, patch.auto_match_on_import === undefined ? old.auto_match_on_import : patch.auto_match_on_import ? 1 : 0, patch.auto_tags_on_import === undefined ? old.auto_tags_on_import : patch.auto_tags_on_import ? 1 : 0, patch.auto_generic_parse_on_import === undefined ? old.auto_generic_parse_on_import : patch.auto_generic_parse_on_import ? 1 : 0, patch.auto_location_on_import === undefined ? old.auto_location_on_import : patch.auto_location_on_import ? 1 : 0, patch.auto_email_classification === undefined ? old.auto_email_classification : patch.auto_email_classification ? 1 : 0); return this.settings(); }
  giveProfileConsent(id: string) { this.db.prepare('UPDATE ai_provider_connections SET profile_consent_at=?, updated_at=? WHERE id=?').run(new Date().toISOString(), new Date().toISOString(), id); return this.getConnection(id); }
  startAnalysis(input: { job_id: string; provider_connection_id: string; provider_type: ProviderType; model: string; profile_hash: string; job_description_hash: string; prompt_version: string }) { const running = this.db.prepare("SELECT id FROM job_match_analyses WHERE job_id=? AND status='running'").get(input.job_id); if (running) throw new Error('Analysis is already running for this vacancy.'); const id = crypto.randomUUID(); const now = new Date().toISOString(); this.db.prepare('INSERT INTO job_match_analyses (id,job_id,provider_connection_id,provider_type,model,profile_hash,job_description_hash,prompt_version,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, input.job_id, input.provider_connection_id, input.provider_type, input.model, input.profile_hash, input.job_description_hash, input.prompt_version, 'running', now); return id; }
  completeAnalysis(id: string, result: MatchResult) { const now = new Date().toISOString(); this.db.prepare("UPDATE job_match_analyses SET status='completed', classification=?, result_json=?, error_message=NULL, completed_at=? WHERE id=?").run(result.classification, JSON.stringify(result), now, id); return this.getAnalysis(id); }
  failAnalysis(id: string, message: string) { this.db.prepare("UPDATE job_match_analyses SET status='failed', error_message=?, completed_at=? WHERE id=?").run(message.slice(0, 500), new Date().toISOString(), id); }
  getAnalysis(id: string) { return this.db.prepare('SELECT * FROM job_match_analyses WHERE id=?').get(id) as AiAnalysisRow | undefined; }
  latestAnalysis(jobId: string) { return this.db.prepare("SELECT * FROM job_match_analyses WHERE job_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 1").get(jobId) as AiAnalysisRow | undefined; }
  analysisHistory(jobId: string) { return this.db.prepare('SELECT * FROM job_match_analyses WHERE job_id=? ORDER BY created_at DESC').all(jobId) as AiAnalysisRow[]; }
  imapSettings() { return this.db.prepare('SELECT * FROM imap_settings WHERE id=1').get() as ImapSettingsRow; }
  saveImapSettings(input: Partial<Pick<ImapSettingsRow, 'host' | 'port' | 'tls_mode' | 'username' | 'encrypted_password' | 'mailbox' | 'interview_mailbox' | 'rejection_mailbox' | 'enabled' | 'sync_interval_minutes' | 'initial_sync_days' | 'rejection_handling' | 'ai_consent_at'>>) {
    const old = this.imapSettings(); const now = new Date().toISOString();
    this.db.prepare('UPDATE imap_settings SET host=?, port=?, tls_mode=?, username=?, encrypted_password=?, mailbox=?, interview_mailbox=?, rejection_mailbox=?, enabled=?, sync_interval_minutes=?, initial_sync_days=?, rejection_handling=?, ai_consent_at=?, updated_at=? WHERE id=1').run(
      input.host ?? old.host, input.port ?? old.port, input.tls_mode ?? old.tls_mode, input.username ?? old.username, input.encrypted_password ?? old.encrypted_password,
      input.mailbox ?? old.mailbox, input.interview_mailbox ?? old.interview_mailbox, input.rejection_mailbox ?? old.rejection_mailbox, input.enabled ?? old.enabled, input.sync_interval_minutes ?? old.sync_interval_minutes, input.initial_sync_days ?? old.initial_sync_days,
      input.rejection_handling ?? old.rejection_handling, input.ai_consent_at ?? old.ai_consent_at, now);
    return this.imapSettings();
  }
  updateImapSyncStatus(input: { status: string; error?: string | null; processed?: number; rejections?: number; reviews?: number }) {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE imap_settings SET last_sync_at=?, last_sync_status=?, last_error=?, processed_count=processed_count+?, rejection_count=rejection_count+?, review_count=review_count+? WHERE id=1').run(now, input.status, input.error?.slice(0, 500) ?? null, input.processed ?? 0, input.rejections ?? 0, input.reviews ?? 0);
    return this.imapSettings();
  }
  markImapSyncRunning() { this.db.prepare("UPDATE imap_settings SET last_sync_status='running', last_error=NULL WHERE id=1").run(); return this.imapSettings(); }
  clearStaleImapSyncStatus() { this.db.prepare("UPDATE imap_settings SET last_sync_status='idle', last_error='Предыдущая синхронизация была остановлена. Запустите её вручную.' WHERE id=1 AND last_sync_status='running'").run(); return this.imapSettings(); }
  syncState(mailbox: string) { return this.db.prepare('SELECT * FROM imap_mailbox_sync_state WHERE mailbox=?').get(mailbox) as { uid_validity: string | null; last_processed_uid: number; updated_at: string } | undefined; }
  saveSyncState(mailbox: string, uidValidity: string, lastUid: number) { this.db.prepare(`INSERT INTO imap_mailbox_sync_state (mailbox, uid_validity, last_processed_uid, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(mailbox) DO UPDATE SET uid_validity=excluded.uid_validity, last_processed_uid=excluded.last_processed_uid, updated_at=excluded.updated_at`).run(mailbox, uidValidity, lastUid, new Date().toISOString()); }
  resetSyncState(mailbox: string, uidValidity: string) { this.saveSyncState(mailbox, uidValidity, 0); }
  acquireImapSyncLease(milliseconds = 10 * 60_000) { const now = new Date(); const until = new Date(now.getTime() + milliseconds).toISOString(); return this.db.prepare("UPDATE imap_sync_lock SET locked_until=? WHERE id=1 AND (locked_until IS NULL OR locked_until < ?)").run(until, now.toISOString()).changes > 0; }
  releaseImapSyncLease() { this.db.prepare('UPDATE imap_sync_lock SET locked_until=NULL WHERE id=1').run(); }
  hasEmail(uidValidity: string, uid: number) { return Boolean(this.db.prepare('SELECT 1 FROM email_records WHERE uid_validity=? AND imap_uid=?').get(uidValidity, uid)); }
  saveEmail(input: Omit<EmailRecordRow, 'id' | 'created_at' | 'updated_at' | 'job_title' | 'job_company'>) {
    const now = new Date().toISOString(); const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO email_records (id,uid_validity,imap_uid,received_at,body_text,body_hash,category,classification_json,proposed_job_id,match_status,review_status,unresolved_reason,initial_import,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, input.uid_validity, input.imap_uid, input.received_at, input.body_text, input.body_hash, input.category, input.classification_json, input.proposed_job_id, input.match_status, input.review_status, input.unresolved_reason, input.initial_import, now, now);
    return this.email(id)!;
  }
  email(id: string) { return this.db.prepare('SELECT email_records.*, jobs.title AS job_title, jobs.company AS job_company FROM email_records LEFT JOIN jobs ON jobs.id=email_records.proposed_job_id WHERE email_records.id=?').get(id) as EmailRecordRow | undefined; }
  classifyEmail(id: string, input: Pick<EmailRecordRow, 'category' | 'classification_json' | 'proposed_job_id' | 'match_status' | 'unresolved_reason' | 'review_status'>) {
    this.db.prepare('UPDATE email_records SET category=?, classification_json=?, proposed_job_id=?, match_status=?, unresolved_reason=?, review_status=?, updated_at=? WHERE id=?').run(input.category, input.classification_json, input.proposed_job_id, input.match_status, input.unresolved_reason, input.review_status, new Date().toISOString(), id);
    return this.email(id);
  }
  reviewEmails() { return this.db.prepare("SELECT email_records.*, jobs.title AS job_title, jobs.company AS job_company FROM email_records LEFT JOIN jobs ON jobs.id=email_records.proposed_job_id WHERE email_records.review_status IN ('pending_review', 'applied') ORDER BY CASE email_records.review_status WHEN 'pending_review' THEN 0 ELSE 1 END, email_records.received_at DESC").all() as EmailRecordRow[]; }
  emailLog(limit = 50, offset = 0) {
    const safeLimit = Math.max(1, Math.min(Math.floor(limit) || 50, 100)); const safeOffset = Math.max(0, Math.floor(offset) || 0);
    const items = this.db.prepare('SELECT email_records.id, email_records.uid_validity, email_records.imap_uid, email_records.received_at, email_records.category, email_records.proposed_job_id, email_records.match_status, email_records.review_status, email_records.unresolved_reason, email_records.initial_import, email_records.created_at, email_records.updated_at, jobs.title AS job_title, jobs.company AS job_company FROM email_records LEFT JOIN jobs ON jobs.id=email_records.proposed_job_id ORDER BY email_records.received_at DESC LIMIT ? OFFSET ?').all(safeLimit, safeOffset) as EmailLogRow[];
    const total = (this.db.prepare('SELECT COUNT(*) AS count FROM email_records').get() as { count: number }).count;
    const counts = this.db.prepare("SELECT SUM(CASE WHEN proposed_job_id IS NULL OR match_status IS NULL OR match_status='no_match' THEN 1 ELSE 0 END) AS unlinked, SUM(CASE WHEN proposed_job_id IS NOT NULL AND match_status='probable' THEN 1 ELSE 0 END) AS uncertain, SUM(CASE WHEN proposed_job_id IS NOT NULL AND match_status='exact' THEN 1 ELSE 0 END) AS exact FROM email_records").get() as { unlinked: number | null; uncertain: number | null; exact: number | null };
    return { items, total, counts: { unlinked: counts.unlinked ?? 0, uncertain: counts.uncertain ?? 0, exact: counts.exact ?? 0 }, limit: safeLimit, offset: safeOffset };
  }
  exactEmailDuplicates() {
    const rows = this.db.prepare("SELECT email_records.id, email_records.uid_validity, email_records.imap_uid, email_records.received_at, email_records.category, email_records.proposed_job_id, email_records.match_status, email_records.review_status, email_records.unresolved_reason, email_records.initial_import, email_records.created_at, email_records.updated_at, email_records.body_hash, jobs.title AS job_title, jobs.company AS job_company FROM email_records LEFT JOIN jobs ON jobs.id=email_records.proposed_job_id WHERE email_records.body_hash IN (SELECT body_hash FROM email_records GROUP BY body_hash HAVING COUNT(*) > 1) ORDER BY email_records.body_hash, email_records.received_at ASC").all() as Array<EmailLogRow & { body_hash: string }>;
    const groups = new Map<string, EmailLogRow[]>();
    rows.forEach(({ body_hash, ...email }) => groups.set(body_hash, [...(groups.get(body_hash) ?? []), email]));
    return { groups: [...groups.values()], copies: rows.length, groupsCount: groups.size };
  }
  emailLogForJob(jobId: string) {
    return this.db.prepare("SELECT email_records.id, email_records.uid_validity, email_records.imap_uid, email_records.received_at, email_records.category, email_records.proposed_job_id, email_records.match_status, email_records.review_status, email_records.unresolved_reason, email_records.initial_import, email_records.created_at, email_records.updated_at, jobs.title AS job_title, jobs.company AS job_company FROM email_records LEFT JOIN jobs ON jobs.id=email_records.proposed_job_id WHERE email_records.proposed_job_id=? AND email_records.match_status IN ('exact', 'probable') ORDER BY CASE email_records.match_status WHEN 'exact' THEN 0 ELSE 1 END, email_records.received_at DESC LIMIT 1").get(jobId) as EmailLogRow | undefined;
  }
  pendingEmailReviewCount() { return (this.db.prepare("SELECT COUNT(*) AS count FROM email_records WHERE review_status='pending_review'").get() as { count: number }).count; }
  archiveNotificationCount() { return (this.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status='archived' AND archive_reason IN ('email_exact','email_review') AND archive_seen_at IS NULL").get() as { count: number }).count; }
  markArchiveNotificationsSeen() { this.db.prepare("UPDATE jobs SET archive_seen_at=? WHERE status='archived' AND archive_reason IN ('email_exact','email_review') AND archive_seen_at IS NULL").run(new Date().toISOString()); }
  moveArchiveEmailReview(jobId: string, archiveReason: 'email_exact' | 'email_review') {
    const job = this.get(jobId);
    if (!job || job.status !== 'archived' || !['email_exact', 'email_review'].includes(job.archive_reason ?? '')) return undefined;
    const email = this.db.prepare("SELECT email_records.* FROM email_records JOIN email_effects ON email_effects.email_id=email_records.id WHERE email_effects.job_id=? AND email_effects.reverted_at IS NULL AND email_records.category='rejection' ORDER BY email_effects.applied_at DESC LIMIT 1").get(jobId) as EmailRecordRow | undefined;
    if (!email) throw new Error('No rejection email is linked to this archived vacancy.');
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE jobs SET archive_reason=?, archive_seen_at=?, updated_at=? WHERE id=?').run(archiveReason, now, now, jobId);
      if (archiveReason === 'email_exact') {
        this.db.prepare("UPDATE email_records SET review_status='applied', unresolved_reason=NULL, updated_at=? WHERE id=?").run(now, email.id);
        this.insertEvent(jobId, 'email_status_changed', now, 'Email rejection confirmed from archive');
      } else {
        this.db.prepare("UPDATE email_records SET review_status='pending_review', unresolved_reason='manual_review', updated_at=? WHERE id=?").run(now, email.id);
        this.insertEvent(jobId, 'email_status_changed', now, 'Email rejection returned to review from archive');
      }
    });
    transaction(); return this.get(jobId);
  }
  private applyEmailEffect(email: EmailRecordRow, jobId: string, automatic: boolean) {
    const job = this.get(jobId); if (!job) return undefined;
    const now = new Date().toISOString(); const rejection = email.category === 'rejection';
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE email_records SET proposed_job_id=?, review_status=?, unresolved_reason=NULL, updated_at=? WHERE id=?').run(jobId, 'applied', now, email.id);
      this.insertEvent(jobId, rejection ? 'rejection_received' : 'email_detected', email.received_at, rejection ? 'Email classification: rejection' : `Email classification: ${email.category ?? 'other'}`);
      if (rejection && !(job.status === 'result' && job.result_outcome === 'offer')) {
        const archiveReason = automatic && email.match_status === 'exact' ? 'email_exact' : 'email_review';
        this.db.prepare('UPDATE jobs SET status=?, result_outcome=?, interview_stage=NULL, archive_reason=?, archive_seen_at=?, updated_at=? WHERE id=?').run('archived', 'rejected', archiveReason, automatic ? null : now, now, jobId);
        this.insertEvent(jobId, 'email_status_changed', now, `${automatic ? 'Automatic' : 'Confirmed'} email update: ${job.status} → archive (rejected)`);
        this.db.prepare('INSERT OR IGNORE INTO email_effects (id,email_id,job_id,previous_status,previous_result_outcome,next_status,next_result_outcome,automatic,applied_at) VALUES (?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), email.id, jobId, job.status, job.result_outcome, 'archived', 'rejected', automatic ? 1 : 0, now);
      }
    }); transaction(); return this.email(email.id);
  }
  confirmEmail(id: string, jobId?: string) { const email = this.email(id); if (!email) return undefined; return this.applyEmailEffect(email, jobId ?? email.proposed_job_id ?? '', false); }
  confirmInterviewInvitation(id: string, jobId: string, appointment: Pick<InterviewAppointmentRow, 'stage' | 'starts_at' | 'time_zone' | 'format' | 'meeting_url' | 'note'>) {
    const email = this.email(id); const job = this.get(jobId); if (!email || !job) return undefined;
    const now = new Date().toISOString(); const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE email_records SET proposed_job_id=?, review_status=?, unresolved_reason=NULL, updated_at=? WHERE id=?').run(jobId, 'applied', now, id);
      this.insertEvent(jobId, 'email_detected', email.received_at, 'Email classification: interview invitation');
      if (job.status !== 'interview') {
        this.db.prepare('UPDATE jobs SET status=?, interview_stage=?, result_outcome=NULL, archive_reason=NULL, archive_seen_at=NULL, updated_at=? WHERE id=?').run('interview', appointment.stage, now, jobId);
        this.insertEvent(jobId, appointment.stage, now, 'Interview invitation confirmed from email');
      }
      const existing = this.db.prepare('SELECT id FROM interview_appointments WHERE source_email_id=?').get(id) as { id: string } | undefined;
      if (!existing) this.createAppointment(jobId, { ...appointment, source_email_id: id, status: 'proposed' });
    }); transaction(); return this.email(id);
  }
  autoApplyRejection(id: string) { const email = this.email(id); if (!email || email.initial_import || !['exact', 'probable'].includes(email.match_status ?? '') || email.category !== 'rejection' || !email.proposed_job_id) return undefined; return this.applyEmailEffect(email, email.proposed_job_id, true); }
  ignoreEmail(id: string) { const email = this.email(id); if (!email) return undefined; this.db.prepare("UPDATE email_records SET review_status='ignored', updated_at=? WHERE id=?").run(new Date().toISOString(), id); return this.email(id); }
  revertEmailEffect(id: string) {
    const effect = this.db.prepare('SELECT * FROM email_effects WHERE email_id=? AND reverted_at IS NULL ORDER BY applied_at DESC LIMIT 1').get(id) as { email_id: string; job_id: string; previous_status: JobStatus; previous_result_outcome: JobRow['result_outcome']; next_status: JobStatus; next_result_outcome: JobRow['result_outcome'] } | undefined;
    if (!effect) return undefined; const job = this.get(effect.job_id); if (!job || job.status !== effect.next_status || job.result_outcome !== effect.next_result_outcome) throw new Error('The vacancy changed after this email action and cannot be reverted automatically.');
    const now = new Date().toISOString(); const transaction = this.db.transaction(() => { this.db.prepare('UPDATE jobs SET status=?, result_outcome=?, archive_reason=NULL, archive_seen_at=NULL, updated_at=? WHERE id=?').run(effect.previous_status, effect.previous_result_outcome, now, job.id); this.db.prepare('UPDATE email_effects SET reverted_at=? WHERE email_id=? AND reverted_at IS NULL').run(now, id); this.db.prepare("UPDATE email_records SET review_status='reverted', updated_at=? WHERE id=?").run(now, id); this.insertEvent(job.id, 'email_status_changed', now, 'Email update reverted'); }); transaction(); return this.email(id);
  }
  backupSettings() { return this.db.prepare('SELECT * FROM backup_settings WHERE id=1').get() as BackupSettingsRow; }
  saveBackupSettings(input: Partial<Pick<BackupSettingsRow, 'webhook_url' | 'encrypted_webhook_secret' | 'automatic_enabled' | 'interval_hours'>>) { const old = this.backupSettings(); const now = new Date().toISOString(); this.db.prepare('UPDATE backup_settings SET webhook_url=?, encrypted_webhook_secret=?, automatic_enabled=?, interval_hours=?, updated_at=? WHERE id=1').run(input.webhook_url ?? old.webhook_url, input.encrypted_webhook_secret ?? old.encrypted_webhook_secret, input.automatic_enabled ?? old.automatic_enabled, input.interval_hours ?? old.interval_hours, now); return this.backupSettings(); }
  updateBackupSyncStatus(input: { status: string; error?: string | null }) { const now = new Date().toISOString(); this.db.prepare('UPDATE backup_settings SET last_sync_at=?, last_sync_status=?, last_error=? WHERE id=1').run(now, input.status, input.error?.slice(0, 500) ?? null); return this.backupSettings(); }
  portableBackup() {
    const select = (table: string) => this.db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
    return { schema_version: 1, exported_at: new Date().toISOString(), data: { jobs: select('jobs'), snapshots: select('snapshots'), job_events: select('job_events'), interview_appointments: select('interview_appointments'), tags: select('tags'), job_tags: select('job_tags'), job_match_analyses: select('job_match_analyses'), email_records: select('email_records'), email_effects: select('email_effects'), ai_provider_connections: this.db.prepare('SELECT id, provider_type, display_name, base_url, model, temperature, max_output_tokens, timeout_ms, requests_per_minute, tokens_per_minute, enabled, profile_consent_at, created_at, updated_at FROM ai_provider_connections').all(), ai_settings: select('ai_settings'), imap_settings: this.db.prepare('SELECT id, host, port, tls_mode, username, mailbox, enabled, sync_interval_minutes, initial_sync_days, rejection_handling, ai_consent_at, last_sync_at, last_sync_status, last_error, processed_count, rejection_count, review_count, updated_at FROM imap_settings').all() } };
  }
  sheetSyncPayload() {
    const jobs = this.db.prepare("SELECT jobs.id, jobs.title, jobs.company, jobs.location, jobs.source, jobs.source_url, jobs.status, jobs.interview_stage, jobs.application_id, jobs.result_outcome, jobs.archive_reason, jobs.captured_at, jobs.created_at, jobs.updated_at, (SELECT MAX(occurred_at) FROM job_events WHERE job_id=jobs.id) AS last_event_at, GROUP_CONCAT(tags.name, ', ') AS tags FROM jobs LEFT JOIN job_tags ON job_tags.job_id=jobs.id LEFT JOIN tags ON tags.id=job_tags.tag_id GROUP BY jobs.id ORDER BY jobs.created_at DESC").all();
    const events = this.db.prepare('SELECT id, job_id, type, occurred_at, note, created_at FROM job_events ORDER BY occurred_at DESC').all();
    const tags = this.db.prepare('SELECT id, name, color, created_at, updated_at FROM tags ORDER BY name COLLATE NOCASE').all();
    const emails = this.db.prepare('SELECT id, received_at, category, proposed_job_id, match_status, review_status, unresolved_reason, initial_import, created_at, updated_at FROM email_records ORDER BY received_at DESC').all();
    return { schema_version: 1, exported_at: new Date().toISOString(), sheets: { Jobs: jobs, Events: events, Tags: tags, Emails: emails } };
  }
  csvJobs() { return this.db.prepare("SELECT jobs.id, jobs.title, jobs.company, jobs.location, jobs.source, jobs.source_url, jobs.status, jobs.interview_stage, jobs.result_outcome, jobs.archive_reason, jobs.created_at, jobs.updated_at, GROUP_CONCAT(tags.name, ', ') AS tags FROM jobs LEFT JOIN job_tags ON job_tags.job_id=jobs.id LEFT JOIN tags ON tags.id=job_tags.tag_id GROUP BY jobs.id ORDER BY jobs.created_at DESC").all() as Array<Record<string, string | null>>; }
  restorePortableBackup(data: { jobs: Record<string, unknown>[]; snapshots: Record<string, unknown>[]; job_events: Record<string, unknown>[]; interview_appointments?: Record<string, unknown>[]; tags: Record<string, unknown>[]; job_tags: Record<string, unknown>[]; job_match_analyses: Record<string, unknown>[]; email_records: Record<string, unknown>[]; email_effects: Record<string, unknown>[]; ai_provider_connections?: Record<string, unknown>[] }) {
    const tableColumns = (table: string) => new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name));
    const insertRows = (table: string, rows: Record<string, unknown>[], ignore = false) => { const allowed = tableColumns(table); for (const row of rows) { const columns = Object.keys(row).filter(column => allowed.has(column)); if (!columns.length) continue; const values = columns.map(column => row[column]); this.db.prepare(`INSERT ${ignore ? 'OR IGNORE ' : ''}INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...values); } };
    const transaction = this.db.transaction(() => {
      this.db.exec('DELETE FROM email_effects; DELETE FROM email_records; DELETE FROM interview_appointments; DELETE FROM job_match_analyses; DELETE FROM snapshots; DELETE FROM job_events; DELETE FROM job_tags; DELETE FROM jobs; DELETE FROM tags;');
      const providers = (data.ai_provider_connections ?? []).map(row => ({ ...row, encrypted_api_key: '', enabled: 0 }));
      insertRows('ai_provider_connections', providers, true);
      insertRows('tags', data.tags); insertRows('jobs', data.jobs); insertRows('job_tags', data.job_tags); insertRows('snapshots', data.snapshots); insertRows('job_events', data.job_events); insertRows('job_match_analyses', data.job_match_analyses); insertRows('email_records', data.email_records); insertRows('interview_appointments', data.interview_appointments ?? []); insertRows('email_effects', data.email_effects);
    });
    transaction(); return { jobs: data.jobs.length, snapshots: data.snapshots.length, events: data.job_events.length, interviews: data.interview_appointments?.length ?? 0, tags: data.tags.length, emails: data.email_records.length };
  }
}
