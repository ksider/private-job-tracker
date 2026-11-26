import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Sqlite from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { JobDatabase } from '../src/db/database.js';

const applicationFixture = (db: JobDatabase, suffix = 'application') => db.import({
  source: 'generic', sourceUrl: `https://example.test/jobs/${suffix}`, title: 'Process Engineer', company: 'Example',
  warnings: [], parseStatus: 'parsed', parserVersion: 'test'
}, { html: '<main>Role</main>', text: 'Role', collectorVersion: 'test', capturedAt: '2026-10-20T12:00:00.000Z' });

describe('cold outreach data model', () => {
  it('serves mixed boards through one API while keeping vacancy fields and AI Match unavailable for Outreach', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'job-tracker-outreach-api-')); const databasePath = path.join(directory, 'jobs.sqlite');
    try {
      const seed = new JobDatabase(databasePath); const application = applicationFixture(seed, 'mixed-board'); const outreach = seed.createOutreachRecord({ company: 'Acme', contact_name: 'Ada Contact', contact_email: 'ADA@ACME.TEST', summary: 'Warm introduction from a conference.', occurred_at: new Date().toISOString() }); seed.db.close();
      const app = buildApp({ databasePath, apiToken: 'token', aiSecretsKey: '0123456789abcdef' });

      const mixed = await app.inject({ method: 'GET', url: '/api/jobs?archive=all&order=title' });
      expect(mixed.statusCode).toBe(200);
      expect(mixed.json().map((item: { id: string }) => item.id)).toEqual([outreach.id, application.jobId]);
      expect(mixed.json().find((item: { id: string }) => item.id === outreach.id)).toMatchObject({ record_type: 'cold_outreach', title: null, outreach_contact_name: 'Ada Contact', ai_match: null, next_interview: null });

      const filtered = await app.inject({ method: 'GET', url: '/api/jobs?archive=all&record_type=cold_outreach' });
      expect(filtered.json()).toHaveLength(1);
      expect(filtered.json()[0]).toMatchObject({ id: outreach.id, outreach_contact_email: 'ada@acme.test' });
      const created = await app.inject({ method: 'POST', url: '/api/outreach', payload: { company: 'Northwind', contact_name: 'Grace', contact_email: 'GRACE@NORTHWIND.TEST', summary: 'Met at a conference.' } });
      expect(created.statusCode).toBe(200);
      expect(created.json()).toMatchObject({ record_type: 'cold_outreach', title: null, company: 'Northwind', outreach_contact_email: 'grace@northwind.test' });
      const detail = await app.inject({ method: 'GET', url: `/api/jobs/${outreach.id}` });
      expect(detail.json()).toMatchObject({ id: outreach.id, record_type: 'cold_outreach', title: null, description_html: null, appointments: [], ai_match: null });
      const conversation = await app.inject({ method: 'GET', url: `/api/jobs/${outreach.id}/conversation?limit=1` });
      expect(conversation.statusCode).toBe(200);
      expect(conversation.json()).toMatchObject({ messages: [], has_more: false, next_before: null, participants: [expect.objectContaining({ email: 'ada@acme.test', name: 'Ada Contact' })] });
      const applicationConversation = await app.inject({ method: 'GET', url: `/api/jobs/${application.jobId}/conversation` });
      expect(applicationConversation.statusCode).toBe(409);
      const search = await app.inject({ method: 'GET', url: '/api/search?q=Ada' });
      expect(search.json()).toEqual([expect.objectContaining({ id: outreach.id, record_type: 'cold_outreach', outreach_contact_name: 'Ada Contact' })]);

      const vacancyPatch = await app.inject({ method: 'PATCH', url: `/api/jobs/${outreach.id}`, payload: { title: 'Invented role' } });
      expect(vacancyPatch.statusCode).toBe(409);
      const aiMatch = await app.inject({ method: 'POST', url: `/api/jobs/${outreach.id}/ai-match`, payload: {} });
      expect(aiMatch.statusCode).toBe(409);
      const outreachPatch = await app.inject({ method: 'PATCH', url: `/api/jobs/${application.jobId}`, payload: { outreach_contact_name: 'Wrong type' } });
      expect(outreachPatch.statusCode).toBe(409);

      const updated = await app.inject({ method: 'PATCH', url: `/api/jobs/${outreach.id}`, payload: { outreach_contact_name: 'Ada Lovelace', outreach_summary: 'Manual context update.', status: 'interview' } });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({ record_type: 'cold_outreach', title: null, outreach_contact_name: 'Ada Lovelace', outreach_summary: 'Manual context update.', status: 'interview', interview_stage: null });
      const archived = await app.inject({ method: 'PATCH', url: `/api/jobs/${outreach.id}`, payload: { status: 'archived' } });
      expect(archived.statusCode).toBe(200);
      const invalidRestore = await app.inject({ method: 'PATCH', url: `/api/jobs/${outreach.id}`, payload: { status: 'interview' } });
      expect(invalidRestore.statusCode).toBe(409);
      await app.close();

      const verified = new JobDatabase(databasePath);
      expect(verified.events(outreach.id).map(event => event.type)).toEqual(['saved']);
      verified.db.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

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
    const threadId = db.threadForEmail(email.id)!.id;
    db.linkEmailToOutreach(outreach.id, email.id);

    expect(db.email(email.id)).toMatchObject({ rfc_message_id: '<message-1@example.test>', direction: 'outgoing', subject: 'Introduction' });
    expect(db.hasEmail(`Sent\u001f7`, 42)).toBe(true);
    expect(db.db.prepare('SELECT mailbox, email_id FROM email_locations').get()).toEqual({ mailbox: 'Sent', email_id: email.id });
    expect(db.db.prepare('SELECT record_id FROM outreach_conversation_threads WHERE thread_id=?').get(threadId)).toEqual({ record_id: outreach.id });
    const model = db.createConnection({ provider_type: 'ollama', display_name: 'Summary model', encrypted_api_key: '', model: 'summary-model', temperature: 0.1, max_output_tokens: 256, timeout_ms: 60_000, requests_per_minute: 10, tokens_per_minute: 20_000, enabled: true });
    const started = db.startOutreachEmailAnalysis({ email_id: email.id, content_hash: email.body_hash, provider_connection_id: model.id, provider_type: 'ollama', model: 'summary-model', prompt_version: 'outreach-email-summary-v1' });
    const completed = db.completeOutreachEmailAnalysis(started.analysis.id, { summary: 'Nikolay sent an introduction to the contact.' });
    expect(db.outreachConversation(outreach.id).messages).toMatchObject([{ id: email.id, ai_summary: 'Nikolay sent an introduction to the contact.', ai_model: 'summary-model' }]);

    const backup = db.portableBackup(); const restored = new JobDatabase(':memory:'); restored.restorePortableBackup(backup.data);
    expect(restored.get(outreach.id)).toMatchObject({ record_type: 'cold_outreach', outreach_contact_email: 'contact@example.test' });
    expect(restored.email(email.id)).toMatchObject({ rfc_message_id: '<message-1@example.test>', direction: 'outgoing' });
    expect(restored.db.prepare('SELECT record_id FROM outreach_conversation_threads WHERE thread_id=?').get(threadId)).toEqual({ record_id: outreach.id });
    expect(restored.outreachParticipants(outreach.id).map(participant => participant.email)).toEqual(['contact@example.test', 'nikolay@example.test']);
    expect(restored.db.prepare('SELECT result_json FROM outreach_email_analyses WHERE id=?').get(completed.id)).toEqual({ result_json: JSON.stringify({ summary: 'Nikolay sent an introduction to the contact.' }) });
    restored.db.close(); db.db.close();
  });

  it('deduplicates messages across folders and keeps multiple technical threads on one logical conversation', () => {
    const db = new JobDatabase(':memory:');
    const outreach = db.createOutreachRecord({ company: 'Example', contact_email: 'contact@example.test', occurred_at: '2026-10-20T12:00:00.000Z' });
    const base = {
      body_text: 'Hello', body_hash: 'same-body', category: null, classification_json: null, proposed_job_id: null,
      match_status: null, review_status: 'pending_review' as const, unresolved_reason: null, initial_import: 0
    };
    const sent = db.saveEmail({
      ...base, uid_validity: `Sent\u001f7`, imap_uid: 10, received_at: '2026-10-21T12:00:00.000Z',
      rfc_message_id: '<MESSAGE-1@EXAMPLE.TEST>', provider_message_id: 'provider-message-1', provider_thread_id: 'provider-thread-1',
      sender_email: 'me@example.test', recipients_json: '[{"address":"contact@example.test"}]', direction: 'outgoing'
    });
    const inboxCopy = db.saveEmail({
      ...base, uid_validity: `All Mail\u001f8`, imap_uid: 99, received_at: '2026-10-21T12:00:00.000Z',
      rfc_message_id: 'message-1@example.test', provider_message_id: 'provider-message-1', provider_thread_id: 'provider-thread-1'
    });
    expect(inboxCopy.id).toBe(sent.id);
    expect(db.db.prepare('SELECT COUNT(*) AS count FROM email_records').get()).toEqual({ count: 1 });
    expect(db.db.prepare('SELECT COUNT(*) AS count FROM email_locations WHERE email_id=?').get(sent.id)).toEqual({ count: 2 });

    db.linkEmailToOutreach(outreach.id, sent.id, 'explicit');
    const reply = db.saveEmail({
      ...base, body_text: 'Reply', body_hash: 'reply-body', uid_validity: `INBOX\u001f8`, imap_uid: 100, received_at: '2026-10-22T12:00:00.000Z',
      rfc_message_id: '<message-2@example.test>', in_reply_to: '<message-1@example.test>', references_json: '["<message-1@example.test>"]',
      provider_message_id: 'provider-message-2', provider_thread_id: 'provider-thread-2', sender_email: 'contact@example.test', recipients_json: '[{"name":"Hiring manager","address":"manager@example.test"}]', direction: 'incoming'
    });
    expect(db.threadForEmail(reply.id)?.id).toBe(db.threadForEmail(sent.id)?.id);
    expect(db.outreachCandidatesForEmail(reply.id)).toEqual([{ record_id: outreach.id, match_status: 'exact', reasons: ['linked_thread'] }]);

    const detached = db.saveEmail({
      ...base, body_text: 'New subject', body_hash: 'new-body', uid_validity: `INBOX\u001f8`, imap_uid: 101, received_at: '2026-10-23T12:00:00.000Z',
      rfc_message_id: '<message-3@example.test>', provider_message_id: 'provider-message-3', provider_thread_id: 'provider-thread-3',
      sender_email: 'manager@example.test', direction: 'incoming'
    });
    expect(db.outreachCandidatesForEmail(detached.id)).toEqual([{ record_id: outreach.id, match_status: 'probable', reasons: ['contact_email'] }]);
    const linked = db.confirmOutreachEmailLink(outreach.id, detached.id);
    expect(linked.email).toMatchObject({ review_status: 'ignored', unresolved_reason: 'outreach_linked' });
    expect(db.threadsForOutreach(outreach.id)).toHaveLength(2);
    expect(db.messagesForOutreach(outreach.id).map(message => message.id)).toEqual([sent.id, reply.id, detached.id]);
    const newestPage = db.outreachConversation(outreach.id, undefined, 2);
    expect(newestPage).toMatchObject({ messages: [{ id: reply.id }, { id: detached.id }], has_more: true, next_before: reply.id });
    expect(db.outreachConversation(outreach.id, newestPage.next_before!, 2)).toMatchObject({ messages: [{ id: sent.id }], has_more: false, next_before: sent.id });
    expect(db.outreachParticipants(outreach.id).map(participant => participant.email)).toEqual(['contact@example.test', 'me@example.test', 'manager@example.test']);
    expect(db.get(outreach.id)?.last_activity_at).toBe('2026-10-23T12:00:00.000Z');

    const sameDomain = db.createOutreachRecord({ company: 'Example', contact_email: 'other@example.test' });
    const domainOnly = db.saveEmail({
      ...base, body_text: 'Unrelated', body_hash: 'unrelated-body', uid_validity: `INBOX\u001f8`, imap_uid: 102, received_at: '2026-10-24T12:00:00.000Z',
      rfc_message_id: '<unrelated@example.test>', sender_email: 'stranger@example.test', direction: 'incoming'
    });
    expect(db.outreachCandidatesForEmail(domainOnly.id)).toEqual([]);
    expect(() => db.linkEmailToOutreach(sameDomain.id, sent.id)).toThrow('already linked');
    db.db.close();
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
      expect(migrated.threadForEmail('legacy-email')).toBeDefined();
      const recordType = (migrated.db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string; notnull: number; dflt_value: string | null }>).find(column => column.name === 'record_type');
      expect(recordType).toMatchObject({ notnull: 1, dflt_value: "'application'" });
      migrated.db.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
