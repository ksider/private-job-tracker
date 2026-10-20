import * as cheerio from 'cheerio';
import type { PageSnapshot } from '@job-tracker/shared';
import type { ParsedJob } from '../db/database.js';
import type { SourceParser } from './types.js';

const text = ($: cheerio.CheerioAPI, selectors: string[]) => { for (const selector of selectors) { const found = $(selector).first().text().replace(/\s+/g, ' ').trim(); if (found) return found; } return undefined; };
const titleFromPageTitle = (pageTitle: string) => pageTitle.split('|')[0]?.trim() || undefined;
const companyFromPageTitle = (pageTitle: string) => pageTitle.split('|').map(value => value.trim())[1] || undefined;
const headerLocation = (header: string | undefined, title: string | undefined, company: string | undefined) => {
  if (!header) return undefined; let remaining = header;
  for (const value of [company, title]) if (value) remaining = remaining.replace(value, '');
  return remaining.split('·')[0]?.trim() || undefined;
};
export class LinkedInParser implements SourceParser {
  readonly source = 'linkedin'; readonly version = '1.0.0';
  canParse(snapshot: PageSnapshot) { return snapshot.source === this.source || new URL(snapshot.url).hostname.endsWith('linkedin.com'); }
  parse(snapshot: PageSnapshot): ParsedJob {
    const $ = cheerio.load(snapshot.snapshot.html); const sourceJobId = snapshot.url.match(/\/jobs\/view\/(\d+)/)?.[1];
    const header = text($, ['[data-snapshot-section="header"]']);
    const title = text($, ['[data-job-title]', '.job-details-jobs-unified-top-card__job-title', 'h1']) ?? titleFromPageTitle(snapshot.page_title);
    const company = text($, ['[data-company-name]', '.job-details-jobs-unified-top-card__company-name', '.topcard__org-name-link', '[data-snapshot-section="header"] a[href*="/company/"]']) ?? companyFromPageTitle(snapshot.page_title);
    const location = text($, ['[data-job-location]', '.job-details-jobs-unified-top-card__bullet', '.topcard__flavor--bullet']) ?? headerLocation(header, title, company);
    const description = $('[data-snapshot-section="description"], [id^="JobDetails_AboutTheJob_"], [data-job-description], .jobs-description__content, .description__text, .jobs-box__html-content').first();
    const descriptionHtml = description.length ? description.html() ?? undefined : undefined;
    const descriptionText = description.length ? description.text().replace(/\s+/g, ' ').trim() : undefined;
    const employmentType = text($, ['[data-employment-type]']) ?? header?.match(/Full-time|Part-time|Contract|Internship/i)?.[0]; const workplaceType = text($, ['[data-workplace-type]']) ?? header?.match(/Hybrid|Remote|On-site/i)?.[0];
    const warnings: string[] = []; if (!sourceJobId) warnings.push('LinkedIn job id was not found in URL.'); if (!title) warnings.push('Job title was not found.'); if (!descriptionText) warnings.push('Job description was not captured; open it manually before saving.');
    return { source: this.source, sourceJobId, sourceUrl: snapshot.url, title, company, location, workplaceType, employmentType, descriptionHtml, descriptionText, warnings, parseStatus: warnings.length ? 'partial' : 'parsed', parserVersion: this.version };
  }
}
