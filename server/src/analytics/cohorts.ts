export type CohortApplication = {
  id: string;
  appliedAt: string;
  applicationDateEstimated?: boolean;
  firstResponseEventAt: string | null;
  firstResponseEmailAt: string | null;
  firstHrEventAt: string | null;
  firstHrEmailAt: string | null;
  hasUndatedHrProgression: boolean;
};

export type CohortMetric = {
  horizonDays: number;
  eligibleApplications: number;
  respondedCount: number;
  responseRate: number | null;
  hrAdvancedCount: number;
  hrConversionRate: number | null;
  noResponseCount: number;
  noResponseRate: number | null;
  incompleteHistoryCount: number;
};

export type CohortAnalytics = {
  asOf: string;
  metrics: CohortMetric[];
  quality: {
    applicationsWithKnownDate: number;
    estimatedApplicationDates: number;
    confirmedResponses: number;
    applicationsWithoutConfirmedResponse: number;
    incompleteHistory: number;
    missingApplicationDate: number;
    hrProgressionMissingDate: number;
    medianResponseDays: number | null;
    responseTimeObservations: number;
  };
};

const dayMs = 86_400_000;
const timestamp = (value: string | null) => value ? Date.parse(value) : Number.NaN;
const earliestAfter = (appliedAt: number, ...values: Array<string | null>) => {
  const dates = values.map(timestamp).filter(value => Number.isFinite(value) && value >= appliedAt);
  return dates.length ? Math.min(...dates) : null;
};
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const rounded = (value: number) => Math.round(value * 10) / 10;

export function calculateCohortAnalytics(applications: CohortApplication[], options: { asOf: Date; missingApplicationDate: number; horizons?: number[] }): CohortAnalytics {
  const asOf = options.asOf.getTime();
  const horizons = options.horizons ?? [7, 14, 30];
  const prepared = applications.flatMap(application => {
    const appliedAt = timestamp(application.appliedAt);
    if (!Number.isFinite(appliedAt)) return [];
    return [{ ...application, appliedAt, responseAt: earliestAfter(appliedAt, application.firstResponseEventAt, application.firstResponseEmailAt), hrAt: earliestAfter(appliedAt, application.firstHrEventAt, application.firstHrEmailAt) }];
  });
  const responseTimes = prepared.flatMap(application => application.responseAt === null || application.responseAt > asOf ? [] : [(application.responseAt - application.appliedAt) / dayMs]);
  const incompleteHistory = prepared.filter(application => application.hasUndatedHrProgression && application.hrAt === null);
  const metrics = horizons.map(horizonDays => {
    const cutoff = asOf - horizonDays * dayMs;
    const eligible = prepared.filter(application => application.appliedAt <= cutoff);
    const deadline = (application: typeof eligible[number]) => application.appliedAt + horizonDays * dayMs;
    const responded = eligible.filter(application => application.responseAt !== null && application.responseAt <= deadline(application));
    const progressed = eligible.filter(application => application.hrAt !== null && application.hrAt <= deadline(application));
    const incomplete = eligible.filter(application => application.hasUndatedHrProgression && application.hrAt === null);
    const noResponse = eligible.filter(application => (application.responseAt === null || application.responseAt > deadline(application)) && !incomplete.includes(application));
    const observable = eligible.length - incomplete.length;
    return {
      horizonDays,
      eligibleApplications: eligible.length,
      respondedCount: responded.length,
      responseRate: eligible.length ? responded.length / eligible.length : null,
      hrAdvancedCount: progressed.length,
      hrConversionRate: eligible.length ? progressed.length / eligible.length : null,
      noResponseCount: noResponse.length,
      noResponseRate: observable ? noResponse.length / observable : null,
      incompleteHistoryCount: incomplete.length
    };
  });
  return {
    asOf: options.asOf.toISOString(),
    metrics,
    quality: {
      applicationsWithKnownDate: prepared.length,
      estimatedApplicationDates: prepared.filter(application => application.applicationDateEstimated).length,
      confirmedResponses: responseTimes.length,
      applicationsWithoutConfirmedResponse: prepared.length - responseTimes.length,
      incompleteHistory: incompleteHistory.length + options.missingApplicationDate,
      missingApplicationDate: options.missingApplicationDate,
      hrProgressionMissingDate: incompleteHistory.length,
      medianResponseDays: median(responseTimes.map(rounded)),
      responseTimeObservations: responseTimes.length
    }
  };
}
