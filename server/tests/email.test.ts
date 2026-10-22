import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { JobDatabase } from '../src/db/database.js';
import { matchEmailToJob } from '../src/email/matching.js';

describe('email sync foundations', () => {
  it('keeps an IMAP password encrypted and out of the settings response', async () => {
    const app = buildApp({ databasePath: ':memory:', apiToken: 'token', aiSecretsKey: '0123456789abcdef' });
    const saved = await app.inject({ method: 'PUT', url: '/api/settings/imap', payload: { host: 'imap.example.test', port: 993, tls_mode: 'tls', username: 'user@example.test', password: 'app-password', mailbox: 'INBOX', enabled: false, allow_ai_email_text: false } });
    expect(saved.statusCode).toBe(200); expect(JSON.stringify(saved.json())).not.toContain('app-password'); expect(saved.json()).toMatchObject({ password_configured: true, host: 'imap.example.test' });
    const loaded = await app.inject({ method: 'GET', url: '/api/settings/imap' });
    expect(JSON.stringify(loaded.json())).not.toContain('app-password'); await app.close();
  });
  it('does not make a company-only match exact when several applications exist', () => {
    const jobs = [{ id: 'a', title: 'Engineer', company: 'Example GmbH', application_id: null }, { id: 'b', title: 'Scientist', company: 'Example GmbH', application_id: null }] as never;
    const match = matchEmailToJob(jobs, { category: 'rejection', company: 'Example GmbH', jobTitle: null, applicationId: null, evidenceQuote: 'We regret to inform you', explanation: 'Employer rejection.' }, 'We regret to inform you.');
    expect(match).toMatchObject({ status: 'no_match', unresolvedReason: 'no_job_found' });
  });
  it('prefers an exact title over a longer title that merely contains it', () => {
    const jobs = [{ id: 'advanced', title: 'Advanced Materials Engineer, Global Materials Science', company: 'Amazon', application_id: null }, { id: 'exact', title: 'Materials Engineer, Global Materials Science', company: 'Amazon', application_id: null }] as never;
    const match = matchEmailToJob(jobs, { category: 'rejection', company: 'Amazon', jobTitle: 'Materials Engineer, Global Materials Science', applicationId: null, evidenceQuote: 'We regret to inform you', explanation: 'Employer rejection.' }, 'We regret to inform you.');
    expect(match).toMatchObject({ jobId: 'exact', status: 'exact' });
  });
  it('records and reverts a confirmed rejection as an email effect', () => {
    const db = new JobDatabase(':memory:'); const now = '2026-10-22T12:00:00.000Z';
    const imported = db.import({ source: 'generic', sourceUrl: 'https://example.test/jobs/1', title: 'Process Engineer', company: 'Example', warnings: [], parseStatus: 'parsed', parserVersion: 'test' }, { html: '<main>Role</main>', text: 'Role', collectorVersion: 'test', capturedAt: now });
    const email = db.saveEmail({ uid_validity: '7', imap_uid: 42, received_at: now, body_text: 'Unfortunately, we will not continue.', body_hash: 'hash', category: 'rejection', classification_json: '{}', proposed_job_id: imported.jobId, match_status: 'exact', review_status: 'pending_review', unresolved_reason: null, initial_import: 0 });
    db.confirmEmail(email.id); expect(db.get(imported.jobId)).toMatchObject({ status: 'archived', archive_reason: 'email_review', result_outcome: 'rejected' });
    db.revertEmailEffect(email.id); expect(db.get(imported.jobId)).toMatchObject({ status: 'saved', result_outcome: null });
  });
  it('archives a probable email rejection in the review column', () => {
    const db = new JobDatabase(':memory:'); const now = '2026-10-22T12:00:00.000Z';
    const imported = db.import({ source: 'generic', sourceUrl: 'https://example.test/jobs/2', title: 'Materials Engineer', company: 'Example', warnings: [], parseStatus: 'parsed', parserVersion: 'test' }, { html: '<main>Role</main>', text: 'Role', collectorVersion: 'test', capturedAt: now });
    const email = db.saveEmail({ uid_validity: '7', imap_uid: 43, received_at: now, body_text: 'Unfortunately, we will not continue.', body_hash: 'hash-2', category: 'rejection', classification_json: '{}', proposed_job_id: imported.jobId, match_status: 'probable', review_status: 'pending_review', unresolved_reason: 'insufficient_evidence', initial_import: 0 });
    db.autoApplyRejection(email.id); expect(db.get(imported.jobId)).toMatchObject({ status: 'archived', archive_reason: 'email_review', result_outcome: 'rejected' });
  });
  it('moves an archived email rejection between review and exact confirmation reversibly', () => {
    const db = new JobDatabase(':memory:'); const now = '2026-10-22T12:00:00.000Z';
    const imported = db.import({ source: 'generic', sourceUrl: 'https://example.test/jobs/3', title: 'Process Engineer', company: 'Example', warnings: [], parseStatus: 'parsed', parserVersion: 'test' }, { html: '<main>Role</main>', text: 'Role', collectorVersion: 'test', capturedAt: now });
    const email = db.saveEmail({ uid_validity: '7', imap_uid: 44, received_at: now, body_text: 'Unfortunately, we will not continue.', body_hash: 'hash-3', category: 'rejection', classification_json: '{}', proposed_job_id: imported.jobId, match_status: 'probable', review_status: 'pending_review', unresolved_reason: 'insufficient_evidence', initial_import: 0 });
    db.autoApplyRejection(email.id);
    expect(db.moveArchiveEmailReview(imported.jobId, 'email_exact')).toMatchObject({ archive_reason: 'email_exact' }); expect(db.email(email.id)).toMatchObject({ review_status: 'applied' });
    expect(db.moveArchiveEmailReview(imported.jobId, 'email_review')).toMatchObject({ archive_reason: 'email_review' }); expect(db.email(email.id)).toMatchObject({ review_status: 'pending_review', unresolved_reason: 'manual_review' });
  });
  it('returns a bounded email log without email bodies', () => {
    const db = new JobDatabase(':memory:'); const now = '2026-10-22T12:00:00.000Z';
    db.saveEmail({ uid_validity: '7', imap_uid: 45, received_at: now, body_text: 'Private email body', body_hash: 'hash-4', category: 'other', classification_json: '{}', proposed_job_id: null, match_status: 'no_match', review_status: 'pending_review', unresolved_reason: null, initial_import: 0 });
    const log = db.emailLog(1); expect(log).toMatchObject({ total: 1, limit: 1, offset: 0 }); expect(log.items[0]).not.toHaveProperty('body_text'); expect(log.items[0]).not.toHaveProperty('classification_json');
  });
});
