import type { PageSnapshot } from '@job-tracker/shared';
import type { SourceParser } from './types.js';
import { LinkedInParser } from './linkedin.js'; import { GenericParser } from './generic.js';
import { SuccessFactorsParser } from './successfactors.js';
import { WorkdayParser } from './workday.js';
export class ParserRegistry { constructor(private readonly parsers: SourceParser[] = [new LinkedInParser(), new SuccessFactorsParser(), new WorkdayParser(), new GenericParser()]) {} find(snapshot: PageSnapshot) { return this.parsers.find(parser => parser.canParse(snapshot))!; } }
