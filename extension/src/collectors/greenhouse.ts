import type { Collector } from './types.js';
import type { CollectorResult } from '../types.js';
import { sanitizeFragment } from '../snapshot/sanitizer.js';

export const greenhouseCollector: Collector = {
  source: 'greenhouse',
  matches: url => /^https:\/\/(?:boards|job-boards)(?:\.[a-z0-9-]+)?\.greenhouse\.io\//i.test(url),
  collect(): CollectorResult {
    // This function only reads the current job page after the popup's explicit Save Job command.
    const job = document.querySelector('.job-post-container, .job-post');
    const html = sanitizeFragment(job?.outerHTML ?? '');
    const warnings = html ? [] : ['Greenhouse job details are not visible. Open the vacancy page fully and save again.'];
    return {
      snapshot: {
        schema_version: 1,
        source: 'greenhouse',
        content_type: 'job',
        url: window.location.href,
        page_title: document.title,
        captured_at: new Date().toISOString(),
        snapshot: { format: 'html', html, text: job?.textContent?.replace(/\s+/g, ' ').trim() || null },
        metadata: { collector_version: '1.0.0' }
      },
      warnings,
      preview: (job?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
    };
  }
};
