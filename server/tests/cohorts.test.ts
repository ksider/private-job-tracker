import { describe, expect, it } from 'vitest';
import { calculateCohortAnalytics, calculateResponseTimeStatistics, type CohortApplication } from '../src/analytics/cohorts.js';
import { JobDatabase } from '../src/db/database.js';

const asOf = new Date('2026-10-31T00:00:00.000Z');
const application = (overrides: Partial<CohortApplication> = {}): CohortApplication => ({ id: crypto.randomUUID(), appliedAt: '2026-10-01T00:00:00.000Z', firstResponseEventAt: null, firstResponseEmailAt: null, firstHrEventAt: null, firstHrEmailAt: null, hasUndatedHrProgression: false, ...overrides });
const metrics = (items: CohortApplication[], horizons = [7, 14, 30]) => calculateCohortAnalytics(items, { asOf, missingApplicationDate: 0, horizons }).metrics[0];

describe('cohort conversion analytics', () => {
  it('excludes an application younger than its observation horizon', () => {
    expect(metrics([application({ appliedAt: '2026-10-27T00:00:00.000Z' })]).eligibleApplications).toBe(0);
  });
  it('counts a dated HR progression inside the horizon exactly once', () => {
    expect(metrics([application({ firstHrEventAt: '2026-10-04T00:00:00.000Z' })])).toMatchObject({ eligibleApplications: 1, hrAdvancedCount: 1, hrConversionRate: 1 });
  });
  it('does not count an HR progression that happens after the horizon', () => {
    expect(metrics([application({ firstHrEventAt: '2026-10-09T00:00:00.000Z' })])).toMatchObject({ hrAdvancedCount: 0, hrConversionRate: 0 });
  });
  it('counts a rejection as a response but never as HR progression', () => {
    expect(metrics([application({ firstResponseEventAt: '2026-10-05T00:00:00.000Z' })])).toMatchObject({ respondedCount: 1, hrAdvancedCount: 0, responseRate: 1 });
  });
  it('does not turn an automatic application confirmation into a response without a confirmed meaningful event', () => {
    expect(metrics([application()])).toMatchObject({ respondedCount: 0, noResponseCount: 1, responseRate: 0 });
  });
  it('keeps a response after 14 days out of shorter cohorts and includes it at 30 days', () => {
    const item = application({ firstResponseEmailAt: '2026-10-16T00:00:00.000Z' });
    const result = calculateCohortAnalytics([item], { asOf, missingApplicationDate: 0, horizons: [7, 14, 30] }).metrics;
    expect(result).toMatchObject([{ horizonDays: 7, respondedCount: 0, noResponseCount: 1 }, { horizonDays: 14, respondedCount: 0, noResponseCount: 1 }, { horizonDays: 30, respondedCount: 1, noResponseCount: 0 }]);
  });
  it('reports the first response median, no-response count, and incomplete history separately', () => {
    const result = calculateCohortAnalytics([
      application({ firstResponseEmailAt: '2026-10-03T00:00:00.000Z' }),
      application({ firstResponseEventAt: '2026-10-07T00:00:00.000Z' }),
      application(),
      application({ hasUndatedHrProgression: true })
    ], { asOf, missingApplicationDate: 2, horizons: [7] });
    expect(result.quality).toMatchObject({ confirmedResponses: 2, medianResponseDays: 4, applicationsWithoutConfirmedResponse: 2, incompleteHistory: 3, missingApplicationDate: 2, hrProgressionMissingDate: 1 });
    expect(result.metrics[0]).toMatchObject({ eligibleApplications: 4, noResponseCount: 1, incompleteHistoryCount: 1 });
  });
  it('keeps average and median response-time calculations on the same valid intervals', () => {
    const statistics = calculateResponseTimeStatistics([0, 0, 4, 4, 4]);
    expect(statistics).toEqual({ observations: 5, averageDays: 2.4, medianDays: 4 });
    expect(calculateResponseTimeStatistics([0, 0.1, 0.1, 0.1, 0.1])).toMatchObject({ observations: 5, medianDays: 0.1 });
    expect(() => calculateResponseTimeStatistics([-1])).toThrow('finite, non-negative intervals');
  });
  it('uses the earliest confirmed meaningful event or email once per application', () => {
    const db = new JobDatabase(':memory:');
    const raw = { html: '<main>Role</main>', text: 'Role', collectorVersion: 'test', capturedAt: '2026-10-01T00:00:00.000Z' };
    const first = db.import({ source: 'generic', sourceUrl: 'https://example.test/response/first', title: 'First', warnings: [], parseStatus: 'parsed', parserVersion: 'test' }, raw);
    const second = db.import({ source: 'generic', sourceUrl: 'https://example.test/response/second', title: 'Second', warnings: [], parseStatus: 'parsed', parserVersion: 'test' }, raw);
    const confirmationOnly = db.import({ source: 'generic', sourceUrl: 'https://example.test/response/confirmation', title: 'Confirmation', warnings: [], parseStatus: 'parsed', parserVersion: 'test' }, raw);
    for (const job of [first, second, confirmationOnly]) db.addEvent(job.jobId, { type: 'applied', occurred_at: '2026-10-01T00:00:00.000Z', note: '' });
    db.addEvent(first.jobId, { type: 'hr_screening', occurred_at: '2026-10-05T00:00:00.000Z', note: '' });
    db.saveEmail({ uid_validity: 'test', imap_uid: 1, received_at: '2026-10-03T00:00:00.000Z', body_text: 'Assessment', body_hash: 'assessment', category: 'assessment', classification_json: '{}', proposed_job_id: first.jobId, match_status: 'exact', review_status: 'applied', unresolved_reason: null, initial_import: 0 });
    db.saveEmail({ uid_validity: 'test', imap_uid: 2, received_at: '2026-10-07T00:00:00.000Z', body_text: 'Rejection', body_hash: 'rejection', category: 'rejection', classification_json: '{}', proposed_job_id: second.jobId, match_status: 'exact', review_status: 'applied', unresolved_reason: null, initial_import: 0 });
    db.saveEmail({ uid_validity: 'test', imap_uid: 3, received_at: '2026-10-02T00:00:00.000Z', body_text: 'Thank you', body_hash: 'confirmation', category: 'application_confirmation', classification_json: '{}', proposed_job_id: confirmationOnly.jobId, match_status: 'exact', review_status: 'applied', unresolved_reason: null, initial_import: 0 });

    const effectiveness = db.applicationEffectiveness().sort((left, right) => left.id.localeCompare(right.id));
    const responseDays = effectiveness.flatMap(row => row.response_at ? [(Date.parse(row.response_at) - Date.parse(row.applied_at)) / 86_400_000] : []);
    const cohorts = calculateCohortAnalytics(db.cohortApplications().map(row => ({ id: row.id, appliedAt: row.applied_at, firstResponseEventAt: row.first_response_event_at, firstResponseEmailAt: row.first_response_email_at, firstHrEventAt: row.first_hr_event_at, firstHrEmailAt: row.first_hr_email_at, hasUndatedHrProgression: Boolean(row.has_undated_hr_progression) })), { asOf, missingApplicationDate: 0 });

    expect(effectiveness).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.jobId, response_at: '2026-10-03T00:00:00.000Z', hr_response_at: '2026-10-05T00:00:00.000Z' }),
      expect.objectContaining({ id: second.jobId, response_at: '2026-10-07T00:00:00.000Z', hr_response_at: null }),
      expect.objectContaining({ id: confirmationOnly.jobId, response_at: null, hr_response_at: null })
    ]));
    expect(calculateResponseTimeStatistics(responseDays)).toEqual({ observations: 2, averageDays: 4, medianDays: 4 });
    expect(cohorts.quality).toMatchObject({ confirmedResponses: 2, responseTimeObservations: 2, medianResponseDays: 4 });
    db.db.close();
  });
  it('treats a confirmed interview invitation email as both a response and HR+', () => {
    const db = new JobDatabase(':memory:');
    const job = db.import({ source: 'generic', sourceUrl: 'https://example.test/response/invitation', title: 'Invitation', warnings: [], parseStatus: 'parsed', parserVersion: 'test' }, { html: '<main>Role</main>', text: 'Role', collectorVersion: 'test', capturedAt: '2026-10-01T00:00:00.000Z' });
    db.addEvent(job.jobId, { type: 'applied', occurred_at: '2026-10-01T00:00:00.000Z', note: '' });
    db.saveEmail({ uid_validity: 'test', imap_uid: 4, received_at: '2026-10-03T00:00:00.000Z', body_text: 'Interview invitation', body_hash: 'invitation', category: 'interview_invitation', classification_json: '{}', proposed_job_id: job.jobId, match_status: 'exact', review_status: 'applied', unresolved_reason: null, initial_import: 0 });
    expect(db.applicationEffectiveness()).toEqual([expect.objectContaining({ id: job.jobId, response_at: '2026-10-03T00:00:00.000Z', hr_response_at: '2026-10-03T00:00:00.000Z' })]);
    db.db.close();
  });
  it('uses UTC instants at the exact horizon boundary', () => {
    const item = application({ appliedAt: '2026-10-24T00:00:00.000Z', firstResponseEmailAt: '2026-10-31T00:00:00.000Z' });
    const result = calculateCohortAnalytics([item], { asOf, missingApplicationDate: 0, horizons: [7] }).metrics[0];
    expect(result).toMatchObject({ eligibleApplications: 1, respondedCount: 1 });
  });
  it('includes a legacy sent card without an applied event, marking its card date as estimated', () => {
    const db = new JobDatabase(':memory:');
    const imported = db.import({ source: 'manual', sourceUrl: 'https://example.test/jobs/1', title: 'Role', warnings: [], parseStatus: 'parsed', parserVersion: 'test' }, { html: '<main>Role</main>', text: 'Role', collectorVersion: 'test', capturedAt: '2026-01-01T00:00:00.000Z' });
    db.db.prepare("UPDATE jobs SET status='sent' WHERE id=?").run(imported.jobId);
    expect(db.cohortApplications()).toEqual([expect.objectContaining({ id: imported.jobId, application_date_source: 'created_at' })]);
    expect(db.applicationStats()).toEqual([expect.objectContaining({ count: 1 })]);
    db.db.close();
  });
});
