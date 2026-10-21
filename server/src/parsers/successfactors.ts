import * as cheerio from 'cheerio';
import type { PageSnapshot } from '@job-tracker/shared';
import type { ParsedJob } from '../db/database.js';
import type { SourceParser } from './types.js';

const text = ($: cheerio.CheerioAPI, selectors: string[]) => { for (const selector of selectors) { const value = $(selector).first().text().replace(/\s+/g, ' ').trim(); if (value) return value; } return undefined; };

export class SuccessFactorsParser implements SourceParser {
  readonly source = 'successfactors'; readonly version = '1.0.0';
  canParse(snapshot: PageSnapshot) { return snapshot.source === this.source || /(?:class=["'][^"']*\bjobDisplayShell\b|id=["']job-company["']|id=["']job-location["']|class=["'][^"']*\bjobdescription\b)/.test(snapshot.snapshot.html); }
  parse(snapshot: PageSnapshot): ParsedJob {
    const $ = cheerio.load(snapshot.snapshot.html);
    const title = text($, ['#job-title', '.jobTitle h1', '[itemprop="title"]', 'h1']) ?? (snapshot.page_title || undefined);
    const company = text($, ['#job-company span', '.jobCompany span']) ?? $('meta[itemprop="hiringOrganization"]').attr('content')?.trim();
    const location = text($, ['#job-location .jobGeoLocation', '.jobLocation .jobGeoLocation']) ?? $('meta[itemprop="streetAddress"]').attr('content')?.trim();
    const description = $('.jobdescription, [itemprop="description"]').first(); const descriptionHtml = description.length ? description.html() ?? undefined : undefined; const descriptionText = description.length ? description.text().replace(/\s+/g, ' ').trim() : undefined;
    const warnings: string[] = []; if (!title) warnings.push('SuccessFactors job title was not found.'); if (!company) warnings.push('SuccessFactors company was not found.'); if (!descriptionText) warnings.push('SuccessFactors job description was not found.');
    return { source: snapshot.source || this.source, sourceUrl: snapshot.url, title, company, location, descriptionHtml, descriptionText, warnings, parseStatus: warnings.length ? 'partial' : 'parsed', parserVersion: this.version };
  }
}
