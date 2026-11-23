import type { JobEventType } from '@job-tracker/shared';

export const UNKNOWN_COUNTRY = '__unknown__';
export const OTHER_COUNTRIES = '__other__';

export type SankeyDimension = 'source' | 'tag' | 'country' | 'language' | 'ai_match';
export type SankeyDetail = 'compact' | 'detailed';
export type SankeyCountryMode = 'top' | 'all';
export type SankeyEvent = { type: JobEventType; occurred_at: string | null; created_at: string | null };
export type SankeyTag = { id: string; name: string; color: string };
export type SankeyApplication = {
  id: string;
  source: string;
  geo_country_code: string | null;
  geo_country: string | null;
  geo_city: string | null;
  location: string | null;
  posting_language_code: string | null;
  ai_classification: string | null;
  result_outcome: 'rejected' | 'offer' | 'withdrawn' | 'other' | null;
  applied_at: string;
  events: SankeyEvent[];
  tags: SankeyTag[];
};

export type SankeyNode = {
  id: string;
  label: string;
  kind: 'category' | 'stage' | 'state' | 'outcome';
  value: number;
  parent_value: number;
  percentage: number;
  application_ids: string[];
  filter_value?: string;
  color?: string;
  depth: number;
};

export type SankeyLink = {
  source: string;
  target: string;
  value: number;
  source_count: number;
  destination_count: number;
  conversion: number;
  application_ids: string[];
  summary?: boolean;
};

export type SankeyMatrixGroup = {
  id: string;
  label: string;
  applications: number;
  hr_plus: number;
  hr_screening: number;
  technical_interview: number;
  final_interview: number;
  offers: number;
  hr_plus_without_rejection: number;
  rejected: number;
  rejected_before_hr_plus: number;
  rejected_after_hr_plus: number;
  other: number;
  hr_plus_rate: number;
  application_ids: string[];
  hr_plus_application_ids: string[];
  hr_screening_application_ids: string[];
  technical_interview_application_ids: string[];
  final_interview_application_ids: string[];
  offer_application_ids: string[];
  hr_plus_without_rejection_application_ids: string[];
  rejected_application_ids: string[];
  rejected_before_hr_plus_application_ids: string[];
  other_application_ids: string[];
};

type Geography = { code: string; name: string; unknown: boolean };
type Filters = { sources: string[]; tags: string[]; countries: string[]; languages: string[]; matches: string[] };

const ISO_CODES = new Set(`AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK`.split(' '));
const displayNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const normalizedText = (value: string | null | undefined) => (value ?? '').trim().toLocaleLowerCase('en').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[._]/g, ' ').replace(/\s+/g, ' ');
const COUNTRY_ALIASES: Record<string, string> = {
  'united states': 'US', 'united states of america': 'US', 'usa': 'US', 'u s a': 'US', 'us': 'US',
  'united kingdom': 'GB', 'great britain': 'GB', 'uk': 'GB', 'u k': 'GB', 'england': 'GB',
  'netherlands': 'NL', 'the netherlands': 'NL', 'holland': 'NL', 'nederland': 'NL',
  'germany': 'DE', 'deutschland': 'DE', 'federal republic of germany': 'DE',
  'serbia': 'RS', 'srbija': 'RS', 'russia': 'RU', 'russian federation': 'RU',
  'czech republic': 'CZ', 'czechia': 'CZ', 'south korea': 'KR', 'republic of korea': 'KR',
  'uae': 'AE', 'u a e': 'AE', 'united arab emirates': 'AE', 'vietnam': 'VN', 'viet nam': 'VN',
};
const CITY_COUNTRIES: Record<string, string> = {
  // Keep this deliberately narrow: ambiguous city names must remain Unknown.
  amsterdam: 'NL',
};
const countryNameIndex = new Map<string, string>();
for (const code of ISO_CODES) {
  const name = displayNames?.of(code);
  if (name && name !== code) countryNameIndex.set(normalizedText(name), code);
}
for (const [name, code] of Object.entries(COUNTRY_ALIASES)) countryNameIndex.set(name, code);

const countryName = (code: string) => displayNames?.of(code) || code;
const codeFromText = (value: string | null | undefined) => {
  const normalized = normalizedText(value);
  if (!normalized) return null;
  const directCode = normalized.replace(/\s/g, '').toUpperCase();
  if (directCode.length === 2 && ISO_CODES.has(directCode)) return directCode;
  return countryNameIndex.get(normalized) ?? CITY_COUNTRIES[normalized] ?? null;
};

export function normalizeSankeyGeography(input: Pick<SankeyApplication, 'geo_country_code' | 'geo_country' | 'geo_city' | 'location'>): Geography {
  const suppliedCode = input.geo_country_code?.trim().toUpperCase() ?? '';
  const locationLead = input.location?.split(',')[0]?.trim() ?? null;
  const code = ISO_CODES.has(suppliedCode) ? suppliedCode : codeFromText(input.geo_country) ?? codeFromText(input.geo_city) ?? codeFromText(locationLead);
  return code ? { code, name: countryName(code), unknown: false } : { code: UNKNOWN_COUNTRY, name: 'Unknown', unknown: true };
}

const STAGES: Record<string, { label: string; color: string; depth: number }> = {
  'stage:sent': { label: 'Отправлено', color: '#2563eb', depth: 1 },
  'stage:hr': { label: 'HR-скрининг', color: '#7c3aed', depth: 2 },
  'stage:technical': { label: 'Техническое интервью', color: '#4f46e5', depth: 3 },
  'stage:final': { label: 'Финальное интервью', color: '#c026d3', depth: 4 },
};
const EVENT_STAGE: Partial<Record<JobEventType, keyof typeof STAGES>> = { hr_screening: 'stage:hr', interview: 'stage:technical', final_interview: 'stage:final' };
const PROGRESSION_EVENTS = new Set<JobEventType>(['hr_screening', 'interview', 'final_interview', 'follow_up']);
const OUTCOMES: Record<string, { label: string; color: string }> = {
  offer: { label: 'Оффер', color: '#059669' }, rejected: { label: 'Отказ', color: '#dc2626' },
  withdrawn: { label: 'Отозвана', color: '#64748b' }, other: { label: 'Другой результат', color: '#475569' },
};
const eventMillis = (event: SankeyEvent) => {
  const occurred = event.occurred_at ? Date.parse(event.occurred_at) : Number.NaN;
  if (Number.isFinite(occurred)) return { value: occurred, missing: false };
  const created = event.created_at ? Date.parse(event.created_at) : Number.NaN;
  return { value: Number.isFinite(created) ? created : Number.MAX_SAFE_INTEGER, missing: true };
};

export function applicationStagePath(row: SankeyApplication, detail: SankeyDetail) {
  const appliedAt = Date.parse(row.applied_at);
  const ordered = row.events.map((event, index) => ({ event, index, ...eventMillis(event) })).filter(item => !Number.isFinite(appliedAt) || item.value >= appliedAt).sort((left, right) => left.value - right.value || left.index - right.index);
  const terminalType = row.result_outcome;
  const rejection = terminalType === 'rejected' ? ordered.find(item => item.event.type === 'rejection_received') : undefined;
  const result = ordered.find(item => item.event.type === 'result');
  const terminalAt = rejection?.value ?? result?.value ?? Number.POSITIVE_INFINITY;
  const recordedEventSequence: string[] = []; const uniqueStages = new Set<string>();
  let missingTimestamps = 0; let reachedHrPlus = row.result_outcome === 'offer';
  for (const item of ordered) {
    const base = EVENT_STAGE[item.event.type];
    if (item.value > terminalAt || !PROGRESSION_EVENTS.has(item.event.type)) continue;
    reachedHrPlus = true; if (item.missing) missingTimestamps += 1;
    if (!base) continue;
    recordedEventSequence.push(base); uniqueStages.add(base);
  }
  // The database keeps the chronological event sequence unchanged. The chart
  // projects only recorded stages into the fixed hiring order so ECharts never
  // needs synthetic "repeat" nodes or cyclic links.
  const recordedStages = [...uniqueStages].sort((left, right) => STAGES[left].depth - STAGES[right].depth);
  const stages = detail === 'compact' && recordedStages.length > 1 ? [recordedStages.at(-1)!] : recordedStages;
  const path = ['stage:sent', ...stages];
  if (terminalType) path.push(`outcome:${terminalType}`);
  else path.push(reachedHrPlus ? 'state:active' : 'state:waiting');
  const distinctEventSequence = recordedEventSequence.filter((stage, index) => index === 0 || stage !== recordedEventSequence[index - 1]);
  const sequenceAdjusted = distinctEventSequence.some((stage, index) => stage !== recordedStages[index]) || distinctEventSequence.length !== recordedStages.length;
  return { path, recordedStages, recordedEventSequence, reachedHrPlus, sequenceAdjusted, missingTimestamps, summarized: detail === 'compact' && recordedStages.length > 1 };
}

const groupId = (dimension: SankeyDimension, value: string) => `${dimension}:${value || 'none'}`;
const sourceLabel = (source: string) => source || 'Не указан';
const languageLabel = (code: string | null) => code ? code.toUpperCase() : 'Не определён';
const matchLabel: Record<string, string> = { strong: 'Сильное соответствие', potential: 'Частичное соответствие', weak: 'Слабое соответствие', insufficient_data: 'Недостаточно данных', not_analyzed: 'Без AI Match' };
const matchColor: Record<string, string> = { strong: '#059669', potential: '#d97706', weak: '#dc2626', insufficient_data: '#94a3b8', not_analyzed: '#cbd5e1' };

export function buildSankeyDataset(allRows: SankeyApplication[], options: { dimension: SankeyDimension; detail: SankeyDetail; countryMode: SankeyCountryMode; filters: Filters }) {
  const normalized = allRows.map(row => ({ ...row, geography: normalizeSankeyGeography(row) }));
  const countryFilterCodes = new Set(options.filters.countries.map(value => value === UNKNOWN_COUNTRY ? value : codeFromText(value) ?? value.toUpperCase()));
  const rows = normalized.filter(row =>
    (!options.filters.sources.length || options.filters.sources.includes(row.source || 'Не указан')) &&
    (!countryFilterCodes.size || countryFilterCodes.has(row.geography.code)) &&
    (!options.filters.languages.length || options.filters.languages.includes(row.posting_language_code?.toLowerCase() || UNKNOWN_COUNTRY)) &&
    (!options.filters.matches.length || options.filters.matches.includes(row.ai_classification ?? 'not_analyzed')) &&
    (!options.filters.tags.length || options.filters.tags.some(id => row.tags.some(tag => tag.id === id)))
  );
  type NodeSeed = Omit<SankeyNode, 'value' | 'parent_value' | 'percentage' | 'application_ids'> & { ids: Set<string> };
  type LinkSeed = Omit<SankeyLink, 'value' | 'source_count' | 'destination_count' | 'conversion' | 'application_ids'> & { ids: Set<string> };
  type MatrixSeed = { id: string; label: string; ids: Set<string>; hrPlusIds: Set<string>; hrScreeningIds: Set<string>; technicalInterviewIds: Set<string>; finalInterviewIds: Set<string>; offerIds: Set<string>; rejectedBeforeHrPlusIds: Set<string>; rejectedAfterHrPlusIds: Set<string>; otherIds: Set<string> };
  const nodeSeeds = new Map<string, NodeSeed>(); const linkSeeds = new Map<string, LinkSeed>(); const matrixSeeds = new Map<string, MatrixSeed>();
  const ensureNode = (id: string, label: string, kind: SankeyNode['kind'], depth: number, filterValue?: string, color?: string) => {
    if (!nodeSeeds.has(id)) nodeSeeds.set(id, { id, label, kind, depth, ids: new Set(), ...(filterValue ? { filter_value: filterValue } : {}), ...(color ? { color } : {}) });
    return nodeSeeds.get(id)!;
  };
  const ensurePathNode = (id: string) => {
    if (STAGES[id]) return ensureNode(id, STAGES[id].label, 'stage', STAGES[id].depth, undefined, STAGES[id].color);
    if (id === 'state:waiting') return ensureNode(id, 'Ожидает ответа', 'state', 5, undefined, '#d97706');
    if (id === 'state:active') return ensureNode(id, 'Активный процесс', 'state', 5, undefined, '#0284c7');
    const outcome = OUTCOMES[id.slice('outcome:'.length)] ?? OUTCOMES.other;
    return ensureNode(id, outcome.label, 'outcome', 5, undefined, outcome.color);
  };
  const addLink = (source: string, target: string, applicationId: string, summary = false) => {
    const key = `${source}\u0000${target}`; const current = linkSeeds.get(key) ?? { source, target, ids: new Set<string>() };
    current.ids.add(applicationId); if (summary) current.summary = true; linkSeeds.set(key, current);
  };
  const rawCategoryGroups = (row: typeof rows[number]) => {
    if (options.dimension === 'source') return [{ value: row.source || 'Не указан', label: sourceLabel(row.source), color: '#2563eb' }];
    if (options.dimension === 'country') {
      return [{ value: row.geography.code, label: `${row.geography.unknown ? '' : `${String.fromCodePoint(...row.geography.code.split('').map(char => 127397 + char.charCodeAt(0)))} `}${row.geography.name}`, color: row.geography.unknown ? '#94a3b8' : '#2563eb' }];
    }
    if (options.dimension === 'language') { const value = row.posting_language_code?.toLowerCase() || UNKNOWN_COUNTRY; return [{ value, label: languageLabel(row.posting_language_code), color: '#7c3aed' }]; }
    if (options.dimension === 'ai_match') { const value = row.ai_classification ?? 'not_analyzed'; return [{ value, label: matchLabel[value], color: matchColor[value] }]; }
    const tags = row.tags.filter(tag => !options.filters.tags.length || options.filters.tags.includes(tag.id));
    return tags.length ? tags.map(tag => ({ value: tag.id, label: tag.name, color: tag.color })) : [{ value: '', label: 'Без тегов', color: '#94a3b8' }];
  };
  const groupCounts = new Map<string, number>();
  for (const row of rows) for (const value of new Set(rawCategoryGroups(row).map(group => group.value))) groupCounts.set(value, (groupCounts.get(value) ?? 0) + 1);
  const topGroups = new Set([...groupCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 8).map(([value]) => value));
  const dimensionFilterActive = options.dimension === 'source' ? options.filters.sources.length > 0
    : options.dimension === 'tag' ? options.filters.tags.length > 0
      : options.dimension === 'country' ? countryFilterCodes.size > 0
        : options.dimension === 'language' ? options.filters.languages.length > 0
          : options.filters.matches.length > 0;
  const categoryGroups = (row: typeof rows[number]) => {
    const groups = rawCategoryGroups(row).map(group => options.countryMode === 'top' && !dimensionFilterActive && !topGroups.has(group.value)
      ? { value: OTHER_COUNTRIES, label: 'Other', color: '#94a3b8' }
      : group);
    return [...new Map(groups.map(group => [group.value, group])).values()];
  };

  let missingTimestamps = 0; let countedApplications = 0; let adjustedSequences = 0;
  for (const row of rows) {
    const built = applicationStagePath(row, options.detail); missingTimestamps += built.missingTimestamps; if (built.sequenceAdjusted) adjustedSequences += 1;
    // Matrix buckets are mutually exclusive. A later rejection does not erase
    // a recorded HR+ conversion; the detailed flow still shows where it ended.
    const reachedHrPlus = built.reachedHrPlus;
    const rejected = row.result_outcome === 'rejected';
    for (const pathId of built.path) ensurePathNode(pathId).ids.add(row.id);
    for (let index = 0; index < built.path.length - 1; index += 1) addLink(built.path[index], built.path[index + 1], row.id, built.summarized && index === 0);
    for (const group of categoryGroups(row)) {
      const category = ensureNode(groupId(options.dimension, group.value), group.label, 'category', 0, group.value || undefined, group.color);
      category.ids.add(row.id); addLink(category.id, built.path[0], row.id); countedApplications += 1;
      const matrix = matrixSeeds.get(category.id) ?? { id: category.id, label: group.label, ids: new Set<string>(), hrPlusIds: new Set<string>(), hrScreeningIds: new Set<string>(), technicalInterviewIds: new Set<string>(), finalInterviewIds: new Set<string>(), offerIds: new Set<string>(), rejectedBeforeHrPlusIds: new Set<string>(), rejectedAfterHrPlusIds: new Set<string>(), otherIds: new Set<string>() };
      matrix.ids.add(row.id);
      if (built.recordedStages.includes('stage:hr')) matrix.hrScreeningIds.add(row.id);
      if (built.recordedStages.includes('stage:technical')) matrix.technicalInterviewIds.add(row.id);
      if (built.recordedStages.includes('stage:final')) matrix.finalInterviewIds.add(row.id);
      if (row.result_outcome === 'offer') matrix.offerIds.add(row.id);
      if (reachedHrPlus) { matrix.hrPlusIds.add(row.id); if (rejected) matrix.rejectedAfterHrPlusIds.add(row.id); }
      else if (rejected) matrix.rejectedBeforeHrPlusIds.add(row.id);
      else matrix.otherIds.add(row.id);
      matrixSeeds.set(category.id, matrix);
    }
  }
  const population = rows.length;
  const nodes = [...nodeSeeds.values()].map(seed => { const { ids, ...node } = seed; const application_ids = [...ids]; const parent = population; return { ...node, value: application_ids.length, parent_value: parent, percentage: parent ? application_ids.length / parent : 0, application_ids } satisfies SankeyNode; });
  const countByNode = new Map(nodes.map(node => [node.id, node.value]));
  const links = [...linkSeeds.values()].map(seed => { const application_ids = [...seed.ids]; const sourceCount = countByNode.get(seed.source) ?? application_ids.length; const destinationCount = countByNode.get(seed.target) ?? application_ids.length; return { source: seed.source, target: seed.target, value: application_ids.length, source_count: sourceCount, destination_count: destinationCount, conversion: sourceCount ? application_ids.length / sourceCount : 0, application_ids, ...(seed.summary ? { summary: true } : {}) }; });
  const nodeOrder = new Map(nodes.map(node => [node.id, node.depth]));
  links.sort((left, right) => (nodeOrder.get(left.source) ?? 0) - (nodeOrder.get(right.source) ?? 0) || left.source.localeCompare(right.source) || left.target.localeCompare(right.target));
  const matrix = [...matrixSeeds.values()].map(seed => {
    const hrPlusWithoutRejectionIds = [...seed.hrPlusIds].filter(id => !seed.rejectedAfterHrPlusIds.has(id));
    const rejectedIds = [...seed.rejectedBeforeHrPlusIds, ...seed.rejectedAfterHrPlusIds];
    return {
      id: seed.id,
      label: seed.label,
      applications: seed.ids.size,
      hr_plus: seed.hrPlusIds.size,
      hr_screening: seed.hrScreeningIds.size,
      technical_interview: seed.technicalInterviewIds.size,
      final_interview: seed.finalInterviewIds.size,
      offers: seed.offerIds.size,
      hr_plus_without_rejection: hrPlusWithoutRejectionIds.length,
      rejected: rejectedIds.length,
      rejected_before_hr_plus: seed.rejectedBeforeHrPlusIds.size,
      rejected_after_hr_plus: seed.rejectedAfterHrPlusIds.size,
      other: seed.otherIds.size,
      hr_plus_rate: seed.ids.size ? seed.hrPlusIds.size / seed.ids.size : 0,
      application_ids: [...seed.ids],
      hr_plus_application_ids: [...seed.hrPlusIds],
      hr_screening_application_ids: [...seed.hrScreeningIds],
      technical_interview_application_ids: [...seed.technicalInterviewIds],
      final_interview_application_ids: [...seed.finalInterviewIds],
      offer_application_ids: [...seed.offerIds],
      hr_plus_without_rejection_application_ids: hrPlusWithoutRejectionIds,
      rejected_application_ids: rejectedIds,
      rejected_before_hr_plus_application_ids: [...seed.rejectedBeforeHrPlusIds],
      other_application_ids: [...seed.otherIds],
    } satisfies SankeyMatrixGroup;
  }).sort((left, right) => right.applications - left.applications || left.label.localeCompare(right.label, 'ru'));
  const waiting = nodes.find(node => node.id === 'state:waiting')?.value ?? 0; const active = nodes.find(node => node.id === 'state:active')?.value ?? 0;
  const terminal = nodes.filter(node => node.kind === 'outcome').reduce((sum, node) => sum + node.value, 0);
  return { rows, nodes, links, matrix, applications: population, countedApplications, reconciliation: { applications: population, traced: waiting + active + terminal, waiting, active, terminal, missing_timestamps: missingTimestamps, adjusted_sequences: adjustedSequences, unknown_geography: rows.filter(row => row.geography.unknown).length } };
}

export function sankeyCountryCatalog(rows: SankeyApplication[]) {
  const counts = new Map<string, { name: string; count: number }>();
  for (const row of rows) { const country = normalizeSankeyGeography(row); const current = counts.get(country.code); counts.set(country.code, { name: country.name, count: (current?.count ?? 0) + 1 }); }
  return [...counts.entries()].map(([code, value]) => ({ code, name: value.name, count: value.count })).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'en'));
}
