import { genericCollector } from './generic.js'; import { greenhouseCollector } from './greenhouse.js'; import { linkedInCollector } from './linkedin.js'; import { smartRecruitersCollector } from './smartrecruiters.js';
export const getCollector = (url: string) => [linkedInCollector, greenhouseCollector, smartRecruitersCollector, genericCollector].find(collector => collector.matches(url))!;
