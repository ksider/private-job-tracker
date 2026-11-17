import { load } from 'cheerio';

export type EmailTextSource = 'plain' | 'html_fallback' | 'missing';
export type ExtractedEmailText = { text: string; source: EmailTextSource };

const cleanText = (value: string) => value.replace(/\r/g, '').replace(/\u00a0/g, ' ')
  .replace(/^\s*(unsubscribe|manage preferences|privacy policy).*$/gim, '')
  .replace(/^On .+wrote:\s*[\s\S]*$/im, '')
  .replace(/\n{3,}/g, '\n\n').trim().slice(0, 100_000);

const knownPlainPlaceholder = /^(?:this is a multi-?part message in mime format\.?|this message requires html|view (?:this )?email in (?:your )?browser\.?|(?:click|tap) here to view (?:this )?email\.?|\[image(?::[^\]]*)?\])$/i;
const clearlyUninformative = (text: string) => {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact || knownPlainPlaceholder.test(compact)) return true;
  const words = compact.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  return words.length < 2 && compact.length < 24;
};

export function htmlToEmailText(html: string) {
  const document = load(html);
  document('script,style,noscript,template,head,meta,link,svg,canvas,iframe,object,embed,form,input,button,textarea,select,video,audio').remove();
  document('img,[width="1"][height="1"],[style*="display:none" i],[style*="display: none" i],[style*="visibility:hidden" i],[style*="visibility: hidden" i]').remove();
  return cleanText(document.root().text().replace(/[\t \f\v]+/g, ' ').replace(/ *\n */g, '\n'));
}

/** Chooses the informative MIME body, never returning raw HTML. */
export function extractEmailText(plain: string | null | undefined, html: string | null | undefined): ExtractedEmailText {
  const plainText = cleanText(plain ?? '');
  const fallback = htmlToEmailText(html ?? '');
  if (plainText && (!clearlyUninformative(plainText) || !fallback)) return { text: plainText, source: 'plain' };
  if (fallback) return { text: fallback, source: 'html_fallback' };
  return { text: '', source: 'missing' };
}
