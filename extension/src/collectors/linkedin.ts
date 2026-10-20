import type { Collector } from './types.js'; import type { CollectorResult } from '../types.js'; import { sanitizeFragment } from '../snapshot/sanitizer.js';
const choose = (...selectors: string[]) => selectors.map(selector => document.querySelector(selector)).find(Boolean) as Element | undefined;
export const linkedInCollector: Collector = {
  source: 'linkedin', matches: url => /^https:\/\/(www\.)?linkedin\.com\/jobs\/(view|search)/.test(url),
  collect(): CollectorResult {
    // This function only reads the current document after the popup's explicit Save Job command.
    const description = choose('[id^="JobDetails_AboutTheJob_"]', '.jobs-description__content', '.description__text', '.jobs-box__html-content');
    const titleHint = document.title.split('|')[0]?.trim(); const companyLink = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/company/"]')].find(link => Boolean(link.textContent?.trim()));
    let header: Element | undefined;
    for (let node: Element | null | undefined = companyLink?.parentElement; node && !header; node = node.parentElement) { const value = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''; if (titleHint && value.includes(titleHint) && value.length <= 1_500) header = node; }
    const parts = [['header', header], ['description', description]].filter((entry): entry is [string, Element] => Boolean(entry[1])).map(([name, element]) => `<section data-snapshot-section="${name}">${element.outerHTML}</section>`);
    const warnings: string[] = []; if (!description) warnings.push('Description is not currently visible. Expand it manually and save again for a fuller snapshot.'); if (!header) warnings.push('Could not identify the job header; the backend will use the page title where possible.');
    const html = sanitizeFragment(parts.join(''));
    return { snapshot: { schema_version: 1, source: 'linkedin', content_type: 'job', url: window.location.href, page_title: document.title, captured_at: new Date().toISOString(), snapshot: { format: 'html', html, text: null }, metadata: { collector_version: '1.0.0' } }, warnings, preview: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) };
  }
};
