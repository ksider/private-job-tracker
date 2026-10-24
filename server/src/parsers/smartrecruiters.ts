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

const attribute = ($: cheerio.CheerioAPI, selector: string, name: string) => $(selector).first().attr(name)?.replace(/\s+/g, ' ').trim() || undefined;
const workplaceType = (value: string | undefined) => value ? value.split(/[-_\s]+/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('-') : undefined;

export class SmartRecruitersParser implements SourceParser {
  readonly source = 'smartrecruiters';
  readonly version = '1.0.0';

  canParse(snapshot: PageSnapshot) {
    return snapshot.source === this.source || new URL(snapshot.url).hostname.endsWith('smartrecruiters.com');
  }

  parse(snapshot: PageSnapshot): ParsedJob {
    const $ = cheerio.load(snapshot.snapshot.html);
    const sourceJobId = snapshot.url.match(/\/(\d+)(?:-[^/?#]*)?(?:[/?#]|$)/)?.[1];
    const title = text($, ['main.jobad-main [itemprop="title"]', '[itemprop="title"]', '.job-title', 'h1']);
    const company = attribute($, '[data-company-name]', 'data-company-name') ?? text($, ['[itemprop="hiringOrganization"] [itemprop="name"]']) ?? attribute($, '[itemprop="hiringOrganization"] meta[itemprop="name"]', 'content');
    const locationText = attribute($, '[data-job-location]', 'data-job-location') ?? text($, ['[itemprop="jobLocation"] .job-detail', '[itemprop="jobLocation"]']);
    const address = [
      attribute($, '[itemprop="jobLocation"] meta[itemprop="streetAddress"]', 'content'),
      [attribute($, '[itemprop="jobLocation"] meta[itemprop="postalCode"]', 'content'), attribute($, '[itemprop="jobLocation"] meta[itemprop="addressLocality"]', 'content')].filter(Boolean).join(' '),
      attribute($, '[itemprop="jobLocation"] meta[itemprop="addressRegion"]', 'content'),
      attribute($, '[itemprop="jobLocation"] meta[itemprop="addressCountry"]', 'content')
    ].filter(Boolean).join(', ');
    const location = locationText ?? (address || undefined);
    const employmentType = attribute($, '[data-employment-type]', 'data-employment-type') ?? text($, ['[itemprop="employmentType"]']);
    const workplace = attribute($, '[data-workplace-type]', 'data-workplace-type') ?? attribute($, 'spl-job-location', 'workplacetype');
    const description = $('[itemprop="description"], .job-sections').first();
    const descriptionHtml = description.length ? description.html() ?? undefined : undefined;
    const descriptionText = description.length ? description.text().replace(/\s+/g, ' ').trim() : undefined;
    const warnings: string[] = [];
    if (!sourceJobId) warnings.push('SmartRecruiters job id was not found in URL.');
    if (!title) warnings.push('SmartRecruiters job title was not found.');
    if (!company) warnings.push('SmartRecruiters company was not found.');
    if (!descriptionText) warnings.push('SmartRecruiters job description was not captured; open the vacancy page before saving.');
    return { source: this.source, sourceJobId, sourceUrl: snapshot.url, title, company, location, employmentType, workplaceType: workplaceType(workplace), descriptionHtml, descriptionText, warnings, parseStatus: warnings.length ? 'partial' : 'parsed', parserVersion: this.version };
  }
}
