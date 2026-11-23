import { describe, expect, it } from 'vitest';
import { applicationStagePath, buildSankeyDataset, normalizeSankeyGeography, type SankeyApplication } from '../src/analytics/sankey.js';

const application = (id: string, patch: Partial<SankeyApplication> = {}): SankeyApplication => ({
  id, source: 'linkedin', geo_country_code: 'DE', geo_country: 'Germany', geo_city: null, location: null,
  posting_language_code: 'en', ai_classification: null, result_outcome: null, applied_at: '2026-10-01T10:00:00.000Z', events: [], tags: [], ...patch,
});
const options = (patch: Partial<Parameters<typeof buildSankeyDataset>[1]> = {}): Parameters<typeof buildSankeyDataset>[1] => ({
  dimension: 'country', detail: 'detailed', countryMode: 'all', filters: { sources: [], tags: [], countries: [], languages: [], matches: [] }, ...patch,
});

describe('Sankey normalization and event paths', () => {
  it('merges spelling variants by canonical country code and resolves an unambiguous city', () => {
    expect(normalizeSankeyGeography(application('de', { geo_country_code: 'de', geo_country: 'Deutschland' }))).toMatchObject({ code: 'DE', name: 'Germany' });
    expect(normalizeSankeyGeography(application('nl-name', { geo_country_code: null, geo_country: 'The Netherlands' }))).toMatchObject({ code: 'NL', name: 'Netherlands' });
    expect(normalizeSankeyGeography(application('nl-city', { geo_country_code: null, geo_country: 'Amsterdam', geo_city: null }))).toMatchObject({ code: 'NL', name: 'Netherlands' });
    expect(normalizeSankeyGeography(application('unknown', { geo_country_code: null, geo_country: 'Remote EMEA', geo_city: null, location: null }))).toEqual({ code: '__unknown__', name: 'Unknown', unknown: true });
    const dataset = buildSankeyDataset([
      application('one', { geo_country_code: 'NL', geo_country: 'Netherlands' }),
      application('two', { geo_country_code: null, geo_country: 'Holland' }),
      application('three', { geo_country_code: null, geo_country: 'Amsterdam' }),
    ], options());
    expect(dataset.nodes.filter(node => node.kind === 'category')).toEqual([expect.objectContaining({ id: 'country:NL', value: 3 })]);
  });

  it('uses only recorded transitions and never infers an HR stage from a later current stage', () => {
    const row = application('sequence', { events: [
      { type: 'interview', occurred_at: '2026-10-03T10:00:00.000Z', created_at: '2026-10-03T10:00:00.000Z' },
      { type: 'interview', occurred_at: '2026-10-03T10:05:00.000Z', created_at: '2026-10-03T10:05:00.000Z' },
      { type: 'final_interview', occurred_at: '2026-10-05T10:00:00.000Z', created_at: '2026-10-05T10:00:00.000Z' },
    ] });
    expect(applicationStagePath(row, 'detailed').path).toEqual(['stage:sent', 'stage:technical', 'stage:final', 'state:active']);
    const dataset = buildSankeyDataset([row], options());
    expect(dataset.nodes).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'stage:hr' })]));
    expect(dataset.links).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'stage:technical', target: 'stage:final', value: 1 })]));
  });

  it('keeps the recorded sequence for audit but projects only canonical stage nodes', () => {
    const row = application('corrected-sequence', { events: [
      { type: 'interview', occurred_at: '2026-10-02T10:00:00.000Z', created_at: '2026-10-02T10:00:00.000Z' },
      { type: 'hr_screening', occurred_at: '2026-10-03T10:00:00.000Z', created_at: '2026-10-03T10:00:00.000Z' },
      { type: 'interview', occurred_at: '2026-10-04T10:00:00.000Z', created_at: '2026-10-04T10:00:00.000Z' },
    ] });
    expect(applicationStagePath(row, 'detailed')).toMatchObject({
      path: ['stage:sent', 'stage:hr', 'stage:technical', 'state:active'],
      recordedEventSequence: ['stage:technical', 'stage:hr', 'stage:technical'],
      sequenceAdjusted: true,
    });
    const dataset = buildSankeyDataset([row], options());
    expect(dataset.nodes.map(node => node.id)).not.toEqual(expect.arrayContaining([expect.stringContaining('@')]));
    expect(dataset.nodes.map(node => node.label)).not.toEqual(expect.arrayContaining([expect.stringContaining('повтор')]));
    expect(dataset.reconciliation.adjusted_sequences).toBe(1);
  });

  it('attributes a rejection to the last interview stage recorded before the rejection', () => {
    const row = application('rejected', { result_outcome: 'rejected', events: [
      { type: 'hr_screening', occurred_at: '2026-10-02T10:00:00.000Z', created_at: '2026-10-02T10:00:00.000Z' },
      { type: 'interview', occurred_at: '2026-10-04T10:00:00.000Z', created_at: '2026-10-04T10:00:00.000Z' },
      { type: 'rejection_received', occurred_at: '2026-10-05T10:00:00.000Z', created_at: '2026-10-05T10:00:00.000Z' },
      { type: 'final_interview', occurred_at: '2026-10-06T10:00:00.000Z', created_at: '2026-10-06T10:00:00.000Z' },
    ] });
    expect(applicationStagePath(row, 'detailed').path).toEqual(['stage:sent', 'stage:hr', 'stage:technical', 'outcome:rejected']);
    const dataset = buildSankeyDataset([row], options());
    expect(dataset.links).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'stage:technical', target: 'outcome:rejected', value: 1 })]));
    expect(dataset.nodes).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'stage:final' })]));
  });

  it('keeps events with missing occurred timestamps in creation order and reports data quality', () => {
    const row = application('missing-time', { events: [{ type: 'hr_screening', occurred_at: null, created_at: '2026-10-03T10:00:00.000Z' }] });
    expect(applicationStagePath(row, 'detailed')).toMatchObject({ path: ['stage:sent', 'stage:hr', 'state:active'], missingTimestamps: 1 });
    expect(buildSankeyDataset([row], options()).reconciliation).toMatchObject({ applications: 1, traced: 1, active: 1, missing_timestamps: 1 });
  });

  it('aggregates Top 8 plus Other and reconciles every application exactly once', () => {
    const codes = ['DE', 'NL', 'FR', 'GB', 'ES', 'IT', 'PL', 'RS', 'SE', 'NO'];
    const rows = codes.map((code, index) => application(`country-${code}`, { geo_country_code: code, geo_country: code, events: index === 0 ? [
      { type: 'interview', occurred_at: '2026-10-02T10:00:00.000Z', created_at: '2026-10-02T10:00:00.000Z' },
      { type: 'interview', occurred_at: '2026-10-02T10:05:00.000Z', created_at: '2026-10-02T10:05:00.000Z' },
    ] : [] }));
    rows[1].result_outcome = 'rejected'; rows[1].events = [{ type: 'rejection_received', occurred_at: '2026-10-03T10:00:00.000Z', created_at: '2026-10-03T10:00:00.000Z' }];
    const dataset = buildSankeyDataset(rows, options({ countryMode: 'top' }));
    const categories = dataset.nodes.filter(node => node.kind === 'category');
    expect(categories).toHaveLength(9);
    expect(categories).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'country:__other__', label: 'Other', value: 2 })]));
    expect(dataset.reconciliation).toEqual(expect.objectContaining({ applications: 10, traced: 10, waiting: 8, active: 1, terminal: 1 }));
    expect(dataset.links.find(link => link.source === 'stage:technical' && link.target === 'state:active')).toMatchObject({ value: 1, source_count: 1, destination_count: 1, conversion: 1 });
    expect(dataset.links.find(link => link.source === 'stage:sent' && link.target === 'stage:technical')).toMatchObject({ value: 1 });
  });

  it('offers Top 8 plus Other for tags and collapses several minor tags only once per application', () => {
    const rows = Array.from({ length: 8 }, (_, tagIndex) => [0, 1].map(copy => application(`top-${tagIndex}-${copy}`, {
      tags: [{ id: `top-${tagIndex}`, name: `Top ${tagIndex}`, color: '#2563eb' }],
    }))).flat();
    rows.push(application('minor-tags', { tags: [
      { id: 'minor-a', name: 'Minor A', color: '#64748b' },
      { id: 'minor-b', name: 'Minor B', color: '#64748b' },
    ] }));
    const dataset = buildSankeyDataset(rows, options({ dimension: 'tag', countryMode: 'top' }));
    const categories = dataset.nodes.filter(node => node.kind === 'category');
    expect(categories).toHaveLength(9);
    expect(categories).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'tag:__other__', label: 'Other', value: 1 })]));
    expect(dataset.countedApplications).toBe(17);
    expect(dataset.matrix.reduce((sum, group) => sum + group.applications, 0)).toBe(17);
  });

  it('treats follow-up as HR progression without inventing a separate chart stage', () => {
    const row = application('follow-up-only', { events: [{ type: 'follow_up', occurred_at: '2026-10-02T10:00:00.000Z', created_at: '2026-10-02T10:00:00.000Z' }] });
    expect(applicationStagePath(row, 'detailed')).toMatchObject({ path: ['stage:sent', 'state:active'], reachedHrPlus: true });
    const dataset = buildSankeyDataset([row], options());
    expect(dataset.nodes.map(node => node.label)).not.toContain('Follow-up');
    expect(dataset.matrix[0]).toMatchObject({ hr_plus: 1 });
  });

  it('keeps reached stages visible when an application was later rejected', () => {
    const dataset = buildSankeyDataset([
      application('waiting'),
      application('active', { events: [{ type: 'hr_screening', occurred_at: '2026-10-02T10:00:00.000Z', created_at: '2026-10-02T10:00:00.000Z' }] }),
      application('rejected-early', { result_outcome: 'rejected', events: [{ type: 'rejection_received', occurred_at: '2026-10-02T10:00:00.000Z', created_at: '2026-10-02T10:00:00.000Z' }] }),
      application('rejected-after-hr', { result_outcome: 'rejected', events: [
        { type: 'interview', occurred_at: '2026-10-02T10:00:00.000Z', created_at: '2026-10-02T10:00:00.000Z' },
        { type: 'rejection_received', occurred_at: '2026-10-03T10:00:00.000Z', created_at: '2026-10-03T10:00:00.000Z' },
      ] }),
    ], options());
    expect(dataset.matrix).toEqual([expect.objectContaining({
      id: 'country:DE', applications: 4, hr_plus: 2, hr_plus_without_rejection: 1, rejected: 2, rejected_before_hr_plus: 1,
      rejected_after_hr_plus: 1, other: 1, hr_plus_rate: 0.5, offers: 0,
    })]);
    const group = dataset.matrix[0];
    expect(group.hr_plus_without_rejection + group.rejected + group.other).toBe(group.applications);
    expect(group.hr_plus_application_ids).toEqual(expect.arrayContaining(['active', 'rejected-after-hr']));
    expect(group.hr_plus_without_rejection_application_ids).toEqual(['active']);
    expect(group.rejected_application_ids).toEqual(expect.arrayContaining(['rejected-early', 'rejected-after-hr']));
    expect(group.rejected_before_hr_plus_application_ids).toEqual(['rejected-early']);
  });
});
