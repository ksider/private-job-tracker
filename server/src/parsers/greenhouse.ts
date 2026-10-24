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

const pageTitle = (value: string) => value.match(/^Job Application for\s+(.+?)\s+at\s+(.+?)$/i);

export class GreenhouseParser implements SourceParser {
  readonly source = 'greenhouse';
  readonly version = '1.0.0';

  canParse(snapshot: PageSnapshot) {
    return snapshot.source === this.source || new URL(snapshot.url).hostname.endsWith('greenhouse.io');
  }

  parse(snapshot: PageSnapshot): ParsedJob {
    const $ = cheerio.load(snapshot.snapshot.html);
    const titleParts = pageTitle(snapshot.page_title);
    const sourceJobId = snapshot.url.match(/\/jobs\/(\d+)/)?.[1];
    const title = text($, ['.job__title h1', '.job__header h1', 'h1']) ?? titleParts?.[1]?.trim();
    const company = text($, ['[data-company-name]']) ?? titleParts?.[2]?.trim();
    const location = text($, ['.job__location']);
    const description = $('.job__description, [data-job-description]').first();
    const descriptionHtml = description.length ? description.html() ?? undefined : undefined;
    const descriptionText = description.length ? description.text().replace(/\s+/g, ' ').trim() : undefined;
    const warnings: string[] = [];
    if (!sourceJobId) warnings.push('Greenhouse job id was not found in URL.');
    if (!title) warnings.push('Greenhouse job title was not found.');
    if (!company) warnings.push('Greenhouse company was not found.');
    if (!descriptionText) warnings.push('Greenhouse job description was not captured; open the vacancy page before saving.');
    return { source: this.source, sourceJobId, sourceUrl: snapshot.url, title, company, location, descriptionHtml, descriptionText, warnings, parseStatus: warnings.length ? 'partial' : 'parsed', parserVersion: this.version };
  }
}
