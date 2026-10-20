import { genericCollector } from './generic.js'; import { linkedInCollector } from './linkedin.js';
export const getCollector = (url: string) => [linkedInCollector, genericCollector].find(collector => collector.matches(url))!;
