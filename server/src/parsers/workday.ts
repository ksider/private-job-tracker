import * as cheerio from 'cheerio';
import type { PageSnapshot } from '@job-tracker/shared';
import type { ParsedJob } from '../db/database.js';
import type { SourceParser } from './types.js';

const text = ($: cheerio.CheerioAPI, selectors: string[]) => {
  for (const selector of selectors) {
    const value = $(selector).first().text().replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return undefined;
};

const companyFromSidebar = ($: cheerio.CheerioAPI) => {
  const sidebar = $('[data-company-name]').first();
  for (const paragraph of sidebar.find('p').toArray()) {
    const value = $(paragraph).text().replace(/\s+/g, ' ').trim();
    const match = value.match(/^(?:(?:the|die)\s+)?(.+?)\s+(?:is|ist|are)\b/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return sidebar.find('b, strong').first().text().replace(/\s+/g, ' ').trim() || undefined;
};

export class WorkdayParser implements SourceParser {
  readonly source = 'workday';
  readonly version = '1.0.0';

  canParse(snapshot: PageSnapshot) {
    return snapshot.source === this.source || /data-(?:job-title|job-location)|data-snapshot-section=["']workday-description["']/.test(snapshot.snapshot.html);
  }

  parse(snapshot: PageSnapshot): ParsedJob {
    const $ = cheerio.load(snapshot.snapshot.html);
    const title = text($, ['[data-job-title]', '[data-automation-id="jobPostingHeader"]', '[data-automation-id="jobPostingTitle"]', 'h1', 'h2']) ?? (snapshot.page_title || undefined);
    const company = text($, ['[data-automation-id="jobPostingCompany"]', '[data-automation-id="company"]']) ?? companyFromSidebar($);
    const location = text($, ['[data-job-location] dd', '[data-job-location]', '[data-automation-id="job-posting-details"] [data-automation-id="locations"] dd', '[data-automation-id="locations"] dd', '[data-automation-id="jobPostingLocation"]']);
    const description = $('[data-snapshot-section="workday-description"], [data-automation-id="jobPostingDescription"]').first();
    const descriptionHtml = description.length ? description.html() ?? undefined : undefined;
    const descriptionText = description.length ? description.text().replace(/\s+/g, ' ').trim() : undefined;
    const warnings: string[] = [];
    if (!title) warnings.push('Workday job title was not found.');
    if (!company) warnings.push('Workday company was not present in this job page.');
    if (!descriptionText) warnings.push('Workday job description was not found.');
    return {
      source: snapshot.source || this.source,
      sourceUrl: snapshot.url,
      title,
      company,
      location,
      descriptionHtml,
      descriptionText,
      warnings,
      parseStatus: warnings.length ? 'partial' : 'parsed',
      parserVersion: this.version
    };
  }
}
