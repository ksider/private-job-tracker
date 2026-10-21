import * as cheerio from 'cheerio';
import type { PageSnapshot } from '@job-tracker/shared';
import type { ParsedJob } from '../db/database.js';
import type { SourceParser } from './types.js';
export class GenericParser implements SourceParser {
  readonly source = 'generic'; readonly version = '1.0.0';
  canParse() { return true; }
  parse(snapshot: PageSnapshot): ParsedJob {
    const $ = cheerio.load(snapshot.snapshot.html); const text = (selectors: string[]) => { for (const selector of selectors) { const value = $(selector).first().text().replace(/\s+/g, ' ').trim(); if (value) return value; } return undefined; };
    const successFactors = $('.jobDisplayShell, #job-company, #job-location, .jobdescription').length > 0;
    const title = text(['#job-title', '[itemprop="title"]', 'h1']) ?? (snapshot.page_title || undefined);
    const company = text(['#job-company span', '[itemprop="hiringOrganization"]']) ?? $('meta[itemprop="hiringOrganization"]').attr('content')?.trim();
    const location = text(['#job-location .jobGeoLocation', '[itemprop="streetAddress"]']) ?? $('meta[itemprop="streetAddress"]').attr('content')?.trim();
    const description = $('.jobdescription, [itemprop="description"]').first(); const descriptionHtml = description.length ? description.html() ?? undefined : snapshot.snapshot.html;
    const bodyText = snapshot.snapshot.text ?? $.text().replace(/\s+/g, ' ').trim(); const descriptionText = description.length ? description.text().replace(/\s+/g, ' ').trim() : bodyText;
    const warnings = successFactors ? [] : ['No site-specific parser is available; raw snapshot was retained.'];
    return { source: snapshot.source || 'generic', sourceUrl: snapshot.url, title, company, location, descriptionHtml, descriptionText: descriptionText || undefined, warnings, parseStatus: warnings.length || !title || !descriptionText ? 'partial' : 'parsed', parserVersion: this.version };
  }
}
