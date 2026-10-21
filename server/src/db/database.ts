import Database from 'better-sqlite3';
import type { InterviewStage, JobEventCreate, JobEventType, JobPatch, JobStatus } from '@job-tracker/shared';
import type { MatchClassification, MatchResult, ProviderType } from '../ai/schemas.js';

export type ParsedJob = { source: string; sourceJobId?: string; sourceUrl: string; title?: string; company?: string; location?: string; workplaceType?: string; employmentType?: string; descriptionHtml?: string; descriptionText?: string; warnings: string[]; parseStatus: 'parsed' | 'partial' | 'parse_failed'; parserVersion: string };
export type JobRow = { id: string; source: string; source_job_id: string | null; source_url: string; title: string | null; company: string | null; location: string | null; workplace_type: string | null; employment_type: string | null; description_html: string | null; description_text: string | null; status: JobStatus; interview_stage: InterviewStage | null; notes: string; captured_at: string; created_at: string; updated_at: string; parse_status: string; last_event_at: string };
export type JobEventRow = { id: string; job_id: string; type: JobEventType; occurred_at: string; note: string; created_at: string };
export type AiConnectionRow = { id: string; provider_type: ProviderType; display_name: string; base_url: string | null; encrypted_api_key: string; model: string; max_output_tokens: number; timeout_ms: number; enabled: number; profile_consent_at: string | null; created_at: string; updated_at: string };
export type AiConnectionPublic = Omit<AiConnectionRow, 'encrypted_api_key' | 'enabled'> & { enabled: boolean; api_key_configured: boolean };
export type AiSettingsRow = { default_connection_id: string | null; default_model: string | null };
export type AiAnalysisRow = { id: string; job_id: string; provider_connection_id: string | null; provider_type: ProviderType; model: string; profile_hash: string; job_description_hash: string; prompt_version: string; classification: MatchClassification | null; result_json: string | null; status: 'running' | 'completed' | 'failed'; error_message: string | null; created_at: string; completed_at: string | null };

export class JobDatabase {
  readonly db: Database.Database;
  constructor(path: string) { this.db = new Database(path); this.db.pragma('journal_mode = WAL'); this.db.pragma('foreign_keys = ON'); this.migrate(); }
  private migrate() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, source_job_id TEXT, source_url TEXT NOT NULL,
      title TEXT, company TEXT, location TEXT, workplace_type TEXT, employment_type TEXT,
      description_html TEXT, description_text TEXT, status TEXT NOT NULL DEFAULT 'saved', interview_stage TEXT, notes TEXT NOT NULL DEFAULT '',
      captured_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, parse_status TEXT NOT NULL DEFAULT 'partial');
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_linkedin_source_id ON jobs(source, source_job_id) WHERE source_job_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_other_url ON jobs(source, source_url) WHERE source_job_id IS NULL;
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY, job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL, source TEXT NOT NULL, source_url TEXT NOT NULL,
        content_type TEXT NOT NULL, raw_html TEXT NOT NULL, raw_text TEXT, collector_version TEXT NOT NULL,
        parser_version TEXT NOT NULL, parse_status TEXT NOT NULL, captured_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS snapshots_job_id ON snapshots(job_id);
      CREATE TABLE IF NOT EXISTS job_events (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        type TEXT NOT NULL, occurred_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS job_events_job_date ON job_events(job_id, occurred_at DESC);
      INSERT INTO job_events (id, job_id, type, occurred_at, note, created_at)
        SELECT lower(hex(randomblob(16))), id, 'saved', created_at, '', created_at FROM jobs
        WHERE NOT EXISTS (SELECT 1 FROM job_events WHERE job_events.job_id = jobs.id);
      UPDATE jobs SET status = 'sent' WHERE status IN ('applied', 'screening');
      UPDATE jobs SET status = 'result' WHERE status IN ('offer', 'rejected', 'withdrawn');
      CREATE TABLE IF NOT EXISTS ai_provider_connections (
        id TEXT PRIMARY KEY, provider_type TEXT NOT NULL, display_name TEXT NOT NULL, base_url TEXT,
        encrypted_api_key TEXT NOT NULL DEFAULT '', model TEXT NOT NULL, max_output_tokens INTEGER NOT NULL DEFAULT 1200, timeout_ms INTEGER NOT NULL DEFAULT 60000, enabled INTEGER NOT NULL DEFAULT 1,
        profile_consent_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_settings (id INTEGER PRIMARY KEY CHECK (id = 1), default_connection_id TEXT REFERENCES ai_provider_connections(id) ON DELETE SET NULL, default_model TEXT);
      INSERT OR IGNORE INTO ai_settings (id, default_connection_id, default_model) VALUES (1, NULL, NULL);
      CREATE TABLE IF NOT EXISTS job_match_analyses (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        provider_connection_id TEXT REFERENCES ai_provider_connections(id) ON DELETE SET NULL, provider_type TEXT NOT NULL, model TEXT NOT NULL,
        profile_hash TEXT NOT NULL, job_description_hash TEXT NOT NULL, prompt_version TEXT NOT NULL,
        classification TEXT, result_json TEXT, status TEXT NOT NULL, error_message TEXT,
        created_at TEXT NOT NULL, completed_at TEXT);
      CREATE INDEX IF NOT EXISTS job_match_analyses_job_date ON job_match_analyses(job_id, created_at DESC);`);
    const jobColumns = this.db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>;
    if (!jobColumns.some(column => column.name === 'interview_stage')) this.db.exec('ALTER TABLE jobs ADD COLUMN interview_stage TEXT');
    this.db.exec("UPDATE jobs SET interview_stage='interview' WHERE status='interview' AND interview_stage IS NULL");
    const connectionColumns = this.db.prepare('PRAGMA table_info(ai_provider_connections)').all() as Array<{ name: string }>;
    if (!connectionColumns.some(column => column.name === 'max_output_tokens')) this.db.exec('ALTER TABLE ai_provider_connections ADD COLUMN max_output_tokens INTEGER NOT NULL DEFAULT 1200');
    if (!connectionColumns.some(column => column.name === 'timeout_ms')) this.db.exec('ALTER TABLE ai_provider_connections ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 60000');
  }
  import(parsed: ParsedJob, raw: { html: string; text: string | null; collectorVersion: string; capturedAt: string }) {
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
    this.db.prepare('INSERT INTO snapshots (id,job_id,source,source_url,content_type,raw_html,raw_text,collector_version,parser_version,parse_status,captured_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), jobId, parsed.source, parsed.sourceUrl, 'job', raw.html, raw.text, raw.collectorVersion, parsed.parserVersion, parsed.parseStatus, raw.capturedAt, now);
    return { jobId, action };
  }
  list(filters: { search?: string; status?: string; source?: string; order?: string; archive?: string }) {
    const where: string[] = []; const values: unknown[] = [];
    if (filters.search) { where.push('(title LIKE ? OR company LIKE ?)'); values.push(`%${filters.search}%`, `%${filters.search}%`); }
    if (filters.status) { where.push('status = ?'); values.push(filters.status); }
    if (filters.source) { where.push('source = ?'); values.push(filters.source); }
    if (filters.archive === 'only') where.push("status = 'archived'");
    else where.push("status != 'archived'");
    return this.db.prepare(`SELECT jobs.*, COALESCE((SELECT MAX(occurred_at) FROM job_events WHERE job_id = jobs.id), jobs.created_at) AS last_event_at,
      (SELECT classification FROM job_match_analyses WHERE job_id = jobs.id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1) AS ai_classification,
      (SELECT result_json FROM job_match_analyses WHERE job_id = jobs.id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1) AS ai_result_json,
      (SELECT model FROM job_match_analyses WHERE job_id = jobs.id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1) AS ai_model,
      (SELECT completed_at FROM job_match_analyses WHERE job_id = jobs.id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1) AS ai_completed_at,
      (SELECT profile_hash FROM job_match_analyses WHERE job_id = jobs.id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1) AS ai_profile_hash,
      (SELECT job_description_hash FROM job_match_analyses WHERE job_id = jobs.id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1) AS ai_job_hash
      FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY captured_at ${filters.order === 'asc' ? 'ASC' : 'DESC'}`).all(...values) as JobRow[];
  }
  get(id: string) { return this.db.prepare('SELECT jobs.*, COALESCE((SELECT MAX(occurred_at) FROM job_events WHERE job_id = jobs.id), jobs.created_at) AS last_event_at FROM jobs WHERE id=?').get(id) as JobRow | undefined; }
  events(id: string) { return this.db.prepare('SELECT * FROM job_events WHERE job_id=? ORDER BY occurred_at DESC, created_at DESC').all(id) as JobEventRow[]; }
  private insertEvent(jobId: string, type: JobEventType, occurredAt: string, note = '') { this.db.prepare('INSERT INTO job_events (id,job_id,type,occurred_at,note,created_at) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(), jobId, type, occurredAt, note, new Date().toISOString()); }
  addEvent(id: string, event: JobEventCreate) { const old = this.get(id); if (!old) return undefined; this.insertEvent(id, event.type, event.occurred_at, event.note); const interviewStage = ['hr_screening', 'interview', 'final_interview', 'follow_up'].includes(event.type) ? event.type as InterviewStage : null; this.db.prepare('UPDATE jobs SET status=?, interview_stage=?, updated_at=? WHERE id=?').run(interviewStage ? 'interview' : old.status, interviewStage ?? old.interview_stage, new Date().toISOString(), id); return this.get(id); }
  update(id: string, patch: JobPatch) {
    const old = this.get(id); if (!old) return undefined;
    const status = patch.interview_stage ? 'interview' : patch.status ?? old.status;
    const interviewStage = status === 'interview' ? patch.interview_stage ?? (old.status === 'interview' ? old.interview_stage ?? 'hr_screening' : 'hr_screening') : null;
    const now = new Date().toISOString();
    this.db.prepare('UPDATE jobs SET source_url=?, title=?, company=?, location=?, employment_type=?, workplace_type=?, status=?, interview_stage=?, notes=?, updated_at=? WHERE id=?').run(patch.source_url ?? old.source_url, patch.title ?? old.title, patch.company === undefined ? old.company : patch.company, patch.location === undefined ? old.location : patch.location, patch.employment_type === undefined ? old.employment_type : patch.employment_type, patch.workplace_type === undefined ? old.workplace_type : patch.workplace_type, status, interviewStage, patch.notes ?? old.notes, now, id);
    if (status === 'interview' && interviewStage && interviewStage !== old.interview_stage) this.insertEvent(id, interviewStage, now);
    else if (patch.status && patch.status !== old.status) { const eventType: Partial<Record<JobStatus, JobEventType>> = { sent: 'applied', result: 'result' }; const event = eventType[status]; if (event) this.insertEvent(id, event, now); }
    return this.get(id);
  }
  delete(id: string) { return this.db.prepare('DELETE FROM jobs WHERE id=?').run(id).changes > 0; }
  latestSnapshot(id: string) { return this.db.prepare('SELECT * FROM snapshots WHERE job_id=? ORDER BY created_at DESC LIMIT 1').get(id) as { raw_html: string; raw_text: string | null; captured_at: string } | undefined; }
  listConnections() { return (this.db.prepare('SELECT * FROM ai_provider_connections ORDER BY created_at DESC').all() as AiConnectionRow[]).map(this.publicConnection); }
  private publicConnection = ({ encrypted_api_key, enabled, ...row }: AiConnectionRow): AiConnectionPublic => ({ ...row, enabled: Boolean(enabled), api_key_configured: Boolean(encrypted_api_key) });
  getConnection(id: string) { return this.db.prepare('SELECT * FROM ai_provider_connections WHERE id=?').get(id) as AiConnectionRow | undefined; }
  createConnection(input: { provider_type: ProviderType; display_name: string; base_url?: string; encrypted_api_key: string; model: string; max_output_tokens: number; timeout_ms: number; enabled: boolean }) { const now = new Date().toISOString(); const id = crypto.randomUUID(); this.db.prepare('INSERT INTO ai_provider_connections (id,provider_type,display_name,base_url,encrypted_api_key,model,max_output_tokens,timeout_ms,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, input.provider_type, input.display_name, input.base_url || null, input.encrypted_api_key, input.model, input.max_output_tokens, input.timeout_ms, input.enabled ? 1 : 0, now, now); return this.publicConnection(this.getConnection(id)!); }
  updateConnection(id: string, input: Partial<{ provider_type: ProviderType; display_name: string; base_url: string; encrypted_api_key: string; model: string; max_output_tokens: number; timeout_ms: number; enabled: boolean }>) { const old = this.getConnection(id); if (!old) return undefined; const now = new Date().toISOString(); this.db.prepare('UPDATE ai_provider_connections SET provider_type=?, display_name=?, base_url=?, encrypted_api_key=?, model=?, max_output_tokens=?, timeout_ms=?, enabled=?, updated_at=? WHERE id=?').run(input.provider_type ?? old.provider_type, input.display_name ?? old.display_name, input.base_url === undefined ? old.base_url : input.base_url || null, input.encrypted_api_key ?? old.encrypted_api_key, input.model ?? old.model, input.max_output_tokens ?? old.max_output_tokens, input.timeout_ms ?? old.timeout_ms, input.enabled === undefined ? old.enabled : input.enabled ? 1 : 0, now, id); return this.publicConnection(this.getConnection(id)!); }
  deleteConnection(id: string) { return this.db.prepare('DELETE FROM ai_provider_connections WHERE id=?').run(id).changes > 0; }
  settings() { return this.db.prepare('SELECT default_connection_id, default_model FROM ai_settings WHERE id=1').get() as AiSettingsRow; }
  updateSettings(patch: Partial<AiSettingsRow>) { const old = this.settings(); this.db.prepare('UPDATE ai_settings SET default_connection_id=?, default_model=? WHERE id=1').run(patch.default_connection_id === undefined ? old.default_connection_id : patch.default_connection_id, patch.default_model === undefined ? old.default_model : patch.default_model); return this.settings(); }
  giveProfileConsent(id: string) { this.db.prepare('UPDATE ai_provider_connections SET profile_consent_at=?, updated_at=? WHERE id=?').run(new Date().toISOString(), new Date().toISOString(), id); return this.getConnection(id); }
  startAnalysis(input: { job_id: string; provider_connection_id: string; provider_type: ProviderType; model: string; profile_hash: string; job_description_hash: string; prompt_version: string }) { const running = this.db.prepare("SELECT id FROM job_match_analyses WHERE job_id=? AND status='running'").get(input.job_id); if (running) throw new Error('Analysis is already running for this vacancy.'); const id = crypto.randomUUID(); const now = new Date().toISOString(); this.db.prepare('INSERT INTO job_match_analyses (id,job_id,provider_connection_id,provider_type,model,profile_hash,job_description_hash,prompt_version,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, input.job_id, input.provider_connection_id, input.provider_type, input.model, input.profile_hash, input.job_description_hash, input.prompt_version, 'running', now); return id; }
  completeAnalysis(id: string, result: MatchResult) { const now = new Date().toISOString(); this.db.prepare("UPDATE job_match_analyses SET status='completed', classification=?, result_json=?, error_message=NULL, completed_at=? WHERE id=?").run(result.classification, JSON.stringify(result), now, id); return this.getAnalysis(id); }
  failAnalysis(id: string, message: string) { this.db.prepare("UPDATE job_match_analyses SET status='failed', error_message=?, completed_at=? WHERE id=?").run(message.slice(0, 500), new Date().toISOString(), id); }
  getAnalysis(id: string) { return this.db.prepare('SELECT * FROM job_match_analyses WHERE id=?').get(id) as AiAnalysisRow | undefined; }
  latestAnalysis(jobId: string) { return this.db.prepare("SELECT * FROM job_match_analyses WHERE job_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 1").get(jobId) as AiAnalysisRow | undefined; }
  analysisHistory(jobId: string) { return this.db.prepare('SELECT * FROM job_match_analyses WHERE job_id=? ORDER BY created_at DESC').all(jobId) as AiAnalysisRow[]; }
}
