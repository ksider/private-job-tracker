import * as cheerio from 'cheerio';
import type { PageSnapshot } from '@job-tracker/shared';
import type { ParsedJob } from '../db/database.js';
import type { SourceParser } from './types.js';
export class GenericParser implements SourceParser {
  readonly source = 'generic'; readonly version = '1.0.0';
  canParse() { return true; }
  parse(snapshot: PageSnapshot): ParsedJob { const $ = cheerio.load(snapshot.snapshot.html); const bodyText = snapshot.snapshot.text ?? $.text().replace(/\s+/g, ' ').trim(); return { source: snapshot.source || 'generic', sourceUrl: snapshot.url, title: snapshot.page_title || undefined, descriptionHtml: snapshot.snapshot.html, descriptionText: bodyText || undefined, warnings: ['No site-specific parser is available; raw snapshot was retained.'], parseStatus: 'partial', parserVersion: this.version }; }
}
