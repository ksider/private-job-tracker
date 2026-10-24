import { genericCollector } from './generic.js'; import { greenhouseCollector } from './greenhouse.js'; import { linkedInCollector } from './linkedin.js';
export const getCollector = (url: string) => [linkedInCollector, greenhouseCollector, genericCollector].find(collector => collector.matches(url))!;
