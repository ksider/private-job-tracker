import type { Collector } from './types.js'; import type { CollectorResult } from '../types.js'; import { sanitizeFragment } from '../snapshot/sanitizer.js';
export const genericCollector: Collector = {
  source: 'generic', matches: () => true,
  collect(): CollectorResult {
    const selection = window.getSelection(); const selected = selection && selection.rangeCount ? selection.getRangeAt(0).cloneContents() : null;
    const holder = document.createElement('div'); // detached node; the live DOM is never touched.
    if (selected && !selected.textContent?.trim().match(/^$/)) holder.append(selected); else { const main = document.querySelector('main, article'); if (main) holder.innerHTML = main.outerHTML; }
    const html = sanitizeFragment(holder.innerHTML); const warnings = html ? [] : ['Select the relevant job text, or open a page with a main/article element. Nothing was sent automatically.'];
    return { snapshot: { schema_version: 1, source: 'generic', content_type: 'job', url: window.location.href, page_title: document.title, captured_at: new Date().toISOString(), snapshot: { format: 'html', html, text: holder.textContent?.replace(/\s+/g, ' ').trim() || null }, metadata: { collector_version: '1.0.0' } }, warnings, preview: (holder.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) };
  }
};
