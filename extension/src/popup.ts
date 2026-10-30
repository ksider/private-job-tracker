import type { CollectorResult, Settings } from './types.js';
import { getCollector } from './collectors/registry.js';
import { BackendApiError, importSnapshot } from './api/client.js';
import { queueSnapshot, queuedSnapshots } from './queue/indexed-db.js';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;
const setMessage = (message: string, bad = false) => { const el = $('#message'); el.textContent = message; el.className = bad ? 'message error' : 'message'; };
const settings = async (): Promise<Settings> => chrome.storage.local.get({ backendUrl: '', apiToken: '' }) as Promise<Settings>;
async function refreshQueue() { $('#queue').textContent = String((await queuedSnapshots()).length); }
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab.id || !tab.url) throw new Error('No active page'); return tab; }

async function collect(tabId: number): Promise<CollectorResult> {
  const tab = await activeTab(); const collectorSource = getCollector(tab.url!).source;
  type FrameCapture = { capture: CollectorResult; selectedTextLength: number };
  const frames = await chrome.scripting.executeScript({ target: { tabId, allFrames: collectorSource === 'generic' }, world: 'ISOLATED', func: (initialSource) => {
    // Passive read only: no fetch, click, events, focus, scrolling, observer, or DOM writes.
    const select = (...items: string[]) => items.map(item => document.querySelector(item)).find(Boolean) as Element | undefined;
    const copyOf = (snapshot: HTMLElement, element: Element | undefined) => {
      if (!element) return undefined;
      const path: number[] = [];
      for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
        const parent = node.parentElement; if (!parent) return undefined;
        const index = [...parent.children].indexOf(node); if (index < 0) return undefined;
        path.push(index);
      }
      return path.reverse().reduce<Element | undefined>((node, index) => node?.children[index], snapshot);
    };
    const wrapFullPage = (sourceName: string, snapshot: HTMLElement) => `<section data-snapshot-section="${sourceName}-page">${snapshot.innerHTML}</section>`;
    const copy = document.implementation.createHTMLDocument('snapshot'); let html = ''; let selectedTextLength = 0; const warnings: string[] = [];
    const successFactors = Boolean(select('.jobDisplayShell', '#job-company', '#job-location', '.jobdescription'));
    const workday = Boolean(select('[data-automation-id="jobPostingPage"]', '[data-automation-id="jobPostingHeader"]', '[data-automation-id="jobPostingDescription"]'));
    const greenhouse = Boolean(select('.job-post-container', '.job__header', '.job__description'));
    const smartRecruiters = Boolean(select('main.jobad-main.job', 'main[itemtype="http://schema.org/JobPosting"]'));
    const source = initialSource === 'linkedin' || initialSource === 'greenhouse' || initialSource === 'smartrecruiters' ? initialSource : successFactors ? 'successfactors' : workday ? 'workday' : greenhouse ? 'greenhouse' : smartRecruiters ? 'smartrecruiters' : initialSource;
    if (source === 'linkedin') {
      const normalize = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim() ?? '';
      const aboutHeading = [...document.querySelectorAll<HTMLElement>('h2')].find(heading => /^about the job$/i.test(normalize(heading.textContent)));
      const description = select('[id^="JobDetails_AboutTheJob_"]', '.jobs-description__content', '.description__text', '.jobs-box__html-content') ?? aboutHeading?.parentElement?.parentElement ?? undefined;
      const selectedCardElement = [...document.querySelectorAll<HTMLElement>('[role="button"]')].find(card => /^selected[,:]/i.test(normalize(card.textContent)));
      const selectedCard = normalize(selectedCardElement?.textContent);
      const easyApply = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')].some(button => /^easy\s+apply(?:\s+to\s+(?:this\s+)?job)?$/i.test(button.getAttribute('aria-label')?.trim() ?? '')) || Boolean(selectedCard && /\bapplied\b[\s\S]*\beasy\s+apply\b/i.test(selectedCard));
      const titleHint = document.title.split('|')[0]?.trim(); const companyLink = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/company/"]')].find(link => Boolean(link.textContent?.trim()));
      let header: Element | undefined;
      for (let node: Element | null | undefined = companyLink?.parentElement; node && !header; node = node.parentElement) { const value = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''; if (titleHint && value.includes(titleHint) && value.length <= 1_500) header = node; }
      // LinkedIn regularly renames classes and reshapes the job layout. Keep the complete
      // detached page so a later parser can recover fields that today's selectors miss.
      // The source page itself is never changed.
      const snapshot = document.body.cloneNode(true) as HTMLElement;
      const snapshotHeader = copyOf(snapshot, selectedCardElement ?? header ?? undefined);
      const snapshotDescription = copyOf(snapshot, description);
      snapshotHeader?.setAttribute('data-snapshot-section', 'header');
      snapshotDescription?.setAttribute('data-snapshot-section', 'description');
      html = wrapFullPage('linkedin', snapshot);
      if (easyApply) html += '<span data-snapshot-section="easy-apply">Easy Apply</span>';
      if (!description) warnings.push('Job description heading is not visible. The complete page was saved; open the description and save again for a focused parse.');
      if (!header) warnings.push('Job header was not located; the backend will use the page title where possible.');
    } else if (source === 'successfactors') {
      const job = select('.jobDisplayShell') ?? select('#job-title')?.parentElement ?? undefined;
      const snapshot = document.body.cloneNode(true) as HTMLElement;
      copyOf(snapshot, job)?.setAttribute('data-snapshot-section', 'successfactors-job');
      html = wrapFullPage('successfactors', snapshot);
      if (!job) warnings.push('SuccessFactors job details are not visible. Open the vacancy page fully and save again.');
    } else if (source === 'workday') {
      const page = select('[data-automation-id="jobPostingPage"]');
      const snapshot = document.body.cloneNode(true) as HTMLElement;
      const mark = (selector: string, attribute: string) => snapshot?.querySelector(selector)?.setAttribute(attribute, '');
      mark('[data-automation-id="jobPostingHeader"], [data-automation-id="jobPostingTitle"]', 'data-job-title');
      mark('[data-automation-id="job-posting-details"] [data-automation-id="locations"], [data-automation-id="locations"]', 'data-job-location');
      snapshot?.querySelector('[data-automation-id="jobPostingDescription"]')?.setAttribute('data-snapshot-section', 'workday-description');
      mark('[data-automation-id="jobSidebar"] [data-automation-id="richText"]', 'data-company-name');
      copyOf(snapshot, page)?.setAttribute('data-snapshot-section', 'workday-job');
      html = wrapFullPage('workday', snapshot);
      if (!page) warnings.push('Workday job details are not visible. Open the vacancy page fully and save again.');
    } else if (source === 'greenhouse') {
      const job = select('.job-post-container', '.job-post');
      const snapshot = document.body.cloneNode(true) as HTMLElement;
      copyOf(snapshot, job)?.setAttribute('data-snapshot-section', 'greenhouse-job');
      html = wrapFullPage('greenhouse', snapshot);
      if (!job) warnings.push('Greenhouse job details are not visible. Open the vacancy page fully and save again.');
    } else if (source === 'smartrecruiters') {
      const job = select('main.jobad-main.job', 'main[itemtype="http://schema.org/JobPosting"]');
      const snapshot = document.body.cloneNode(true) as HTMLElement;
      const value = (selector: string, attribute?: string) => {
        const element = job?.querySelector(selector);
        return (attribute ? element?.getAttribute(attribute) : element?.textContent)?.replace(/\s+/g, ' ').trim() || undefined;
      };
      const metadata = snapshot.ownerDocument.createElement('div');
      const mark = (attribute: string, field: string | undefined) => { if (field) metadata.setAttribute(attribute, field); };
      mark('data-company-name', value('[itemprop="hiringOrganization"] meta[itemprop="name"]', 'content'));
      mark('data-job-location', value('spl-job-location', 'formattedaddress') ?? value('[itemprop="jobLocation"]'));
      mark('data-employment-type', value('[itemprop="employmentType"]'));
      mark('data-workplace-type', value('spl-job-location', 'workplacetype'));
      snapshot.prepend(metadata);
      copyOf(snapshot, job)?.setAttribute('data-snapshot-section', 'smartrecruiters-job');
      html = wrapFullPage('smartrecruiters', snapshot);
      if (!job) warnings.push('SmartRecruiters job details are not visible. Open the vacancy page fully and save again.');
    } else {
      const selection = window.getSelection();
      selectedTextLength = selection?.toString().trim().length ?? 0;
      if (selection && selection.rangeCount && selectedTextLength) { const node = selection.getRangeAt(0).cloneContents(); const holder = document.createElement('div'); holder.append(node); html = holder.innerHTML; }
      else { const main = select('main', 'article'); html = main?.outerHTML ?? ''; if (!html) warnings.push('Select the relevant job text, or use a page with main/article.'); }
    }
    copy.body.innerHTML = html;
    copy.querySelectorAll('script,iframe,form,input,button,textarea,select,video,audio,img,link,style,object,embed,meta').forEach(element => element.remove());
    copy.querySelectorAll('*').forEach(element => [...element.attributes].forEach(attribute => { if (attribute.name.startsWith('on') || ['src', 'srcset', 'action', 'formaction'].includes(attribute.name) || (attribute.name === 'href' && !/^(https?:|mailto:|#|\/)/.test(attribute.value))) element.removeAttribute(attribute.name); }));
    const clean = copy.body.innerHTML.slice(0, 5_000_000);
    const easyApply = source === 'linkedin' && copy.querySelector('[data-snapshot-section="easy-apply"]') !== null;
    return { capture: { snapshot: { schema_version: 1, source, content_type: 'job', url: location.href, page_title: document.title, captured_at: new Date().toISOString(), snapshot: { format: 'html', html: clean, text: copy.body.textContent?.replace(/\s+/g, ' ').trim() || null }, metadata: { collector_version: source === 'linkedin' ? '1.4.0' : '1.3.0', easy_apply: easyApply } }, warnings, preview: (copy.body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) }, selectedTextLength };
  }, args: [collectorSource] });
  const captures = frames.flatMap(frame => frame.result ? [frame.result as FrameCapture] : []);
  const selected = captures.filter(item => item.selectedTextLength > 0).sort((left, right) => right.selectedTextLength - left.selectedTextLength)[0];
  const fallback = captures.filter(item => item.capture.snapshot.snapshot.html).sort((left, right) => (right.capture.snapshot.snapshot.text?.length ?? 0) - (left.capture.snapshot.snapshot.text?.length ?? 0))[0];
  return (selected ?? fallback ?? captures[0])?.capture ?? { snapshot: { schema_version: 1, source: collectorSource, content_type: 'job', url: tab.url!, page_title: tab.title ?? '', captured_at: new Date().toISOString(), snapshot: { format: 'html', html: '', text: null }, metadata: { collector_version: '1.3.0' } }, warnings: ['No readable frame was available.'], preview: '' };
}

async function save() { const tab = await activeTab(); $('#site').textContent = new URL(tab.url!).hostname; const button = $('#save') as HTMLButtonElement; button.disabled = true; try { const captured = await collect(tab.id!); $('#preview').textContent = captured.preview || 'No usable content captured'; const config = await settings(); if (!captured.snapshot.snapshot.html) throw new Error(captured.warnings[0] ?? 'Nothing was captured'); if (!config.backendUrl || !config.apiToken) throw new Error('Configure the tracker server first.'); try { const response = await importSnapshot(config, captured.snapshot); setMessage(`Saved (${response.action}). ${[...captured.warnings, ...response.warnings].join(' ')}`); } catch (error) { if (error instanceof BackendApiError) throw new Error(`Server rejected the snapshot (${error.status}): ${error.message}`); await queueSnapshot({ id: crypto.randomUUID(), dedupeKey: `${captured.snapshot.source}:${captured.snapshot.url}`, snapshot: captured.snapshot, createdAt: new Date().toISOString() }); setMessage('Server unavailable: snapshot saved in this browser queue.'); } } catch (error) { setMessage(error instanceof Error ? error.message : String(error), true); } finally { button.disabled = false; await refreshQueue(); } }
document.addEventListener('DOMContentLoaded', async () => { try { const tab = await activeTab(); $('#site').textContent = new URL(tab.url!).hostname; } catch { $('#site').textContent = 'Unavailable'; } await refreshQueue(); $('#save').onclick = () => void save(); $('#retry').onclick = () => chrome.runtime.sendMessage({ type: 'retry-queue' }).then(refreshQueue); $('#settings').onclick = () => chrome.runtime.openOptionsPage(); $('#open').onclick = async () => { const config = await settings(); if (config.backendUrl) await chrome.tabs.create({ url: config.backendUrl }); }; });
