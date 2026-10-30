import type { Collector } from './types.js'; import type { CollectorResult } from '../types.js'; import { sanitizeFragment } from '../snapshot/sanitizer.js';
const choose = (...selectors: string[]) => selectors.map(selector => document.querySelector(selector)).find(Boolean) as Element | undefined;
export const linkedInCollector: Collector = {
  source: 'linkedin', matches: url => /^https:\/\/(www\.)?linkedin\.com\/jobs\/(view|search)/.test(url),
  collect(): CollectorResult {
    // This function only reads the current document after the popup's explicit Save Job command.
    const normalize = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim() ?? '';
    const aboutHeading = [...document.querySelectorAll<HTMLElement>('h2')].find(heading => /^about the job$/i.test(normalize(heading.textContent)));
    const description = choose('[id^="JobDetails_AboutTheJob_"]', '.jobs-description__content', '.description__text', '.jobs-box__html-content') ?? aboutHeading?.parentElement?.parentElement ?? undefined;
    const selectedCardElement = [...document.querySelectorAll<HTMLElement>('[role="button"]')].find(card => /^selected[,:]/i.test(normalize(card.textContent)));
    const appliedEasyApplyCard = normalize(selectedCardElement?.textContent);
    const easyApply = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')].some(button => /^easy\s+apply(?:\s+to\s+(?:this\s+)?job)?$/i.test(button.getAttribute('aria-label')?.trim() ?? '')) || Boolean(appliedEasyApplyCard && /\bapplied\b[\s\S]*\beasy\s+apply\b/i.test(appliedEasyApplyCard));
    const titleHint = document.title.split('|')[0]?.trim(); const companyLink = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/company/"]')].find(link => Boolean(link.textContent?.trim()));
    let header: Element | undefined;
    for (let node: Element | null | undefined = companyLink?.parentElement; node && !header; node = node.parentElement) { const value = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''; if (titleHint && value.includes(titleHint) && value.length <= 1_500) header = node; }
    const snapshot = document.body.cloneNode(true) as HTMLElement;
    const cloneOf = (element: Element | undefined) => {
      if (!element) return undefined;
      const path: number[] = [];
      for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
        const parent = node.parentElement; if (!parent) return undefined;
        const index = [...parent.children].indexOf(node); if (index < 0) return undefined;
        path.push(index);
      }
      return path.reverse().reduce<Element | undefined>((node, index) => node?.children[index], snapshot);
    };
    cloneOf(selectedCardElement ?? header ?? undefined)?.setAttribute('data-snapshot-section', 'header');
    cloneOf(description)?.setAttribute('data-snapshot-section', 'description');
    const parts = [`<section data-snapshot-section="linkedin-page">${snapshot.innerHTML}</section>`];
    // Preserve the application mode, never the interactive LinkedIn button itself.
    if (easyApply) parts.push('<span data-snapshot-section="easy-apply">Easy Apply</span>');
    const warnings: string[] = []; if (!description) warnings.push('Description heading is not currently visible. The complete page was saved; open the description and save again for a focused parse.'); if (!header) warnings.push('Could not identify the job header; the backend will use the page title where possible.');
    const html = sanitizeFragment(parts.join(''));
    return { snapshot: { schema_version: 1, source: 'linkedin', content_type: 'job', url: window.location.href, page_title: document.title, captured_at: new Date().toISOString(), snapshot: { format: 'html', html, text: null }, metadata: { collector_version: '1.4.0' } }, warnings, preview: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) };
  }
};
