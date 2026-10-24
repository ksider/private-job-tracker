import type { Collector } from './types.js';
import type { CollectorResult } from '../types.js';
import { sanitizeFragment } from '../snapshot/sanitizer.js';

export const smartRecruitersCollector: Collector = {
  source: 'smartrecruiters',
  matches: url => /^https:\/\/jobs\.smartrecruiters\.com\//i.test(url),
  collect(): CollectorResult {
    // This function only reads the current job page after the popup's explicit Save Job command.
    const job = document.querySelector('main.jobad-main.job, main[itemtype="http://schema.org/JobPosting"]');
    const snapshot = job?.cloneNode(true) as Element | undefined;
    const value = (selector: string, attribute?: string) => {
      const element = job?.querySelector(selector);
      return (attribute ? element?.getAttribute(attribute) : element?.textContent)?.replace(/\s+/g, ' ').trim() || undefined;
    };
    const metadata = document.createElement('div');
    const mark = (attribute: string, field: string | undefined) => { if (field) metadata.setAttribute(attribute, field); };
    mark('data-company-name', value('[itemprop="hiringOrganization"] meta[itemprop="name"]', 'content'));
    mark('data-job-location', value('spl-job-location', 'formattedaddress') ?? value('[itemprop="jobLocation"]'));
    mark('data-employment-type', value('[itemprop="employmentType"]'));
    mark('data-workplace-type', value('spl-job-location', 'workplacetype'));
    snapshot?.prepend(metadata);
    const html = sanitizeFragment(snapshot?.outerHTML ?? '');
    const warnings = html ? [] : ['SmartRecruiters job details are not visible. Open the vacancy page fully and save again.'];
    return {
      snapshot: {
        schema_version: 1,
        source: 'smartrecruiters',
        content_type: 'job',
        url: window.location.href,
        page_title: document.title,
        captured_at: new Date().toISOString(),
        snapshot: { format: 'html', html, text: snapshot?.textContent?.replace(/\s+/g, ' ').trim() || null },
        metadata: { collector_version: '1.0.0' }
      },
      warnings,
      preview: (snapshot?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
    };
  }
};
