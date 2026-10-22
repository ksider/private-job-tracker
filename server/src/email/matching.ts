import type { JobRow } from '../db/database.js';
import type { EmailClassification } from './schemas.js';

export type EmailMatch = { jobId: string | null; status: 'exact' | 'probable' | 'no_match'; reason: string; unresolvedReason: string | null };
const normalized = (value: string | null | undefined) => (value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const includes = (left: string, right: string) => Boolean(left && right && (left.includes(right) || right.includes(left)));

export function matchEmailToJob(jobs: JobRow[], classification: EmailClassification, bodyText: string): EmailMatch {
  const applicationId = normalized(classification.applicationId);
  if (applicationId) {
    const matches = jobs.filter(job => normalized(job.application_id) === applicationId);
    if (matches.length === 1) return { jobId: matches[0].id, status: 'exact', reason: 'Exact application ID', unresolvedReason: null };
    if (matches.length > 1) return { jobId: null, status: 'no_match', reason: 'Application ID is not unique', unresolvedReason: 'ambiguous_match' };
  }
  const title = normalized(classification.jobTitle); const company = normalized(classification.company);
  const exactBoth = jobs.filter(job => normalized(job.title) === title && normalized(job.company) === company);
  if (exactBoth.length === 1) return { jobId: exactBoth[0].id, status: 'exact', reason: 'Exact job title and company', unresolvedReason: null };
  if (exactBoth.length > 1) return { jobId: null, status: 'no_match', reason: 'Several vacancies have the same title and company', unresolvedReason: 'ambiguous_match' };
  const both = jobs.filter(job => includes(normalized(job.title), title) && includes(normalized(job.company), company));
  if (both.length === 1) return { jobId: both[0].id, status: 'exact', reason: 'Matching job title and company', unresolvedReason: null };
  if (both.length > 1) return { jobId: null, status: 'no_match', reason: 'Several vacancies match the title and company', unresolvedReason: 'ambiguous_match' };
  const titleMatches = jobs.filter(job => includes(normalized(job.title), title));
  if (titleMatches.length === 1) return { jobId: titleMatches[0].id, status: 'probable', reason: 'Matching job title only', unresolvedReason: 'insufficient_evidence' };
  const companyMatches = jobs.filter(job => includes(normalized(job.company), company));
  if (companyMatches.length === 1) return { jobId: companyMatches[0].id, status: 'probable', reason: 'Matching company only', unresolvedReason: 'insufficient_evidence' };
  const text = normalized(bodyText);
  const idInText = jobs.filter(job => job.application_id && text.includes(normalized(job.application_id)));
  if (idInText.length === 1) return { jobId: idInText[0].id, status: 'exact', reason: 'Application ID in email text', unresolvedReason: null };
  return { jobId: null, status: 'no_match', reason: 'No reliable vacancy match', unresolvedReason: 'no_job_found' };
}
