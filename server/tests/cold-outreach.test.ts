import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Sqlite from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { JobDatabase } from '../src/db/database.js';

const applicationFixture = (db: JobDatabase, suffix = 'application') => db.import({
  source: 'generic', sourceUrl: `https://example.test/jobs/${suffix}`, title: 'Process Engineer', company: 'Example',
  warnings: [], parseStatus: 'parsed', parserVersion: 'test'
}, { html: '<main>Role</main>', text: 'Role', collectorVersion: 'test', capturedAt: '2026-10-20T12:00:00.000Z' });

describe('cold outreach data model', () => {
  it('uses the existing record and date infrastructure without inventing vacancy data', () => {
    const db = new JobDatabase(':memory:');
    const application = applicationFixture(db);
    db.addEvent(application.jobId, { type: 'applied', occurred_at: '2026-10-21T12:00:00.000Z', note: '' });
    const before = { days: db.applicationStats(), effectiveness: db.applicationEffectiveness(), sankey: db.applicationSankey(), cohorts: db.cohortApplications(), counts: db.jobCounts() };

    const outreach = db.createOutreachRecord({ company: 'Example', contact_name: 'Alex Recruiter', contact_email: 'ALEX@EXAMPLE.TEST', summary: 'Discussing a possible materials role.', occurred_at: '2026-10-22T12:00:00.000Z' });
    db.addEvent(outreach.id, { type: 'applied', occurred_at: '2026-10-22T12:00:00.000Z', note: 'Regression guard: must not become an application.' });

    expect(outreach).toMatchObject({
      record_type: 'cold_outreach', source: 'cold_outreach', source_job_id: outreach.id, source_url: '', title: null,
      company: 'Example', outreach_contact_name: 'Alex Recruiter', outreach_contact_email: 'alex@example.test',
      outreach_summary: 'Discussing a possible materials role.', outreach_summary_edited: 1,
      captured_at: '2026-10-22T12:00:00.000Z', created_at: '2026-10-22T12:00:00.000Z', last_activity_at: '2026-10-22T12:00:00.000Z'
    });
    expect(db.jobOptions()).toEqual([expect.objectContaining({ id: application.jobId })]);
    expect({ days: db.applicationStats(), effectiveness: db.applicationEffectiveness(), sankey: db.applicationSankey(), cohorts: db.cohortApplications(), counts: db.jobCounts() }).toEqual(before);
    db.db.close();
  });

  it('stores one canonical message location and provides thread-to-conversation relations', () => {
    const db = new JobDatabase(':memory:'); const now = '2026-10-22T12:00:00.000Z';
    const outreach = db.createOutreachRecord({ contact_email: 'contact@example.test', occurred_at: now });
    const email = db.saveEmail({
      uid_validity: `Sent\u001f7`, imap_uid: 42, received_at: now, body_text: 'Hello', body_html: '<p>Hello</p>', body_hash: 'message-hash',
      rfc_message_id: '<message-1@example.test>', in_reply_to: null, references_json: '[]', provider_message_id: 'provider-message-1', provider_thread_id: 'provider-thread-1',
      subject: 'Introduction', sender_name: 'Nikolay', sender_email: 'nikolay@example.test', recipients_json: '[{"name":"Contact","address":"contact@example.test"}]', direction: 'outgoing', original_url: 'https://mail.example.test/message/1',
      category: null, classification_json: null, proposed_job_id: null, match_status: null, review_status: 'pending_review', unresolved_reason: null, initial_import: 0
    });
    const threadId = crypto.randomUUID();
    db.db.prepare('INSERT INTO email_threads (id,created_at,updated_at) VALUES (?,?,?)').run(threadId, now, now);
    db.db.prepare('INSERT INTO email_thread_keys (thread_id,kind,value,created_at) VALUES (?,?,?,?)').run(threadId, 'provider', 'provider-thread-1', now);
    db.db.prepare('INSERT INTO email_thread_messages (thread_id,email_id,link_method,linked_at) VALUES (?,?,?,?)').run(threadId, email.id, 'provider_thread', now);
    db.db.prepare('INSERT INTO outreach_conversation_threads (record_id,thread_id,link_method,linked_at) VALUES (?,?,?,?)').run(outreach.id, threadId, 'manual', now);

    expect(db.email(email.id)).toMatchObject({ rfc_message_id: '<message-1@example.test>', direction: 'outgoing', subject: 'Introduction' });
    expect(db.hasEmail(`Sent\u001f7`, 42)).toBe(true);
    expect(db.db.prepare('SELECT mailbox, email_id FROM email_locations').get()).toEqual({ mailbox: 'Sent', email_id: email.id });
    expect(db.db.prepare('SELECT record_id FROM outreach_conversation_threads WHERE thread_id=?').get(threadId)).toEqual({ record_id: outreach.id });

    const backup = db.portableBackup(); const restored = new JobDatabase(':memory:'); restored.restorePortableBackup(backup.data);
    expect(restored.get(outreach.id)).toMatchObject({ record_type: 'cold_outreach', outreach_contact_email: 'contact@example.test' });
    expect(restored.email(email.id)).toMatchObject({ rfc_message_id: '<message-1@example.test>', direction: 'outgoing' });
    expect(restored.db.prepare('SELECT record_id FROM outreach_conversation_threads WHERE thread_id=?').get(threadId)).toEqual({ record_id: outreach.id });
    restored.db.close(); db.db.close();
  });

  it('migrates pre-feature records additively and backfills email provenance', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'job-tracker-outreach-migration-')); const databasePath = path.join(directory, 'jobs.sqlite');
    try {
      const legacy = new Sqlite(databasePath); const timestamp = '2026-10-20T12:00:00.000Z';
      legacy.exec(`CREATE TABLE jobs (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, source_job_id TEXT, source_url TEXT NOT NULL,
        title TEXT, company TEXT, location TEXT, geo_country_code TEXT, geo_country TEXT, geo_region TEXT, geo_city TEXT, posting_language_code TEXT, geo_source TEXT, workplace_type TEXT, employment_type TEXT, application_id TEXT, result_outcome TEXT, cover_letter_text TEXT, cover_letter_model TEXT, cover_letter_updated_at TEXT,
        description_html TEXT, description_text TEXT, status TEXT NOT NULL DEFAULT 'saved', interview_stage TEXT, notes TEXT NOT NULL DEFAULT '',
        captured_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_activity_at TEXT NOT NULL, parse_status TEXT NOT NULL DEFAULT 'partial');
        CREATE TABLE email_records (
          id TEXT PRIMARY KEY, uid_validity TEXT NOT NULL, imap_uid INTEGER NOT NULL, received_at TEXT NOT NULL, body_text TEXT NOT NULL, body_source TEXT NOT NULL DEFAULT 'plain', body_hash TEXT NOT NULL,
          category TEXT, classification_json TEXT, proposed_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL, match_status TEXT, review_status TEXT NOT NULL DEFAULT 'pending_review', review_action TEXT, unresolved_reason TEXT, initial_import INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(uid_validity, imap_uid));`);
      legacy.prepare('INSERT INTO jobs (id,source,source_job_id,source_url,title,company,status,notes,captured_at,created_at,updated_at,last_activity_at,parse_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('legacy-job', 'generic', null, 'https://example.test/jobs/legacy', 'Legacy Engineer', 'Legacy Co', 'saved', 'Keep me', timestamp, timestamp, timestamp, timestamp, 'parsed');
      legacy.prepare('INSERT INTO email_records (id,uid_validity,imap_uid,received_at,body_text,body_source,body_hash,review_status,initial_import,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('legacy-email', `INBOX\u001f12`, 7, timestamp, 'Legacy message', 'plain', 'legacy-hash', 'pending_review', 0, timestamp, timestamp);
      legacy.close();

      const migrated = new JobDatabase(databasePath);
      expect(migrated.get('legacy-job')).toMatchObject({ id: 'legacy-job', record_type: 'application', title: 'Legacy Engineer', company: 'Legacy Co', notes: 'Keep me', created_at: timestamp });
      expect(migrated.email('legacy-email')).toMatchObject({ rfc_message_id: null, references_json: '[]', recipients_json: '[]', direction: 'unknown', body_text: 'Legacy message' });
      expect(migrated.db.prepare('SELECT mailbox, uid_validity, imap_uid FROM email_locations WHERE email_id=?').get('legacy-email')).toEqual({ mailbox: 'INBOX', uid_validity: `INBOX\u001f12`, imap_uid: 7 });
      const recordType = (migrated.db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string; notnull: number; dflt_value: string | null }>).find(column => column.name === 'record_type');
      expect(recordType).toMatchObject({ notnull: 1, dflt_value: "'application'" });
      migrated.db.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
