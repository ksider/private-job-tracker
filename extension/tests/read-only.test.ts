import { describe, expect, it } from 'vitest'; import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/popup.ts', import.meta.url), 'utf8'); const manifest = await readFile(new URL('../manifest.json', import.meta.url), 'utf8');
describe('browser read-only contract', () => {
  it('does not ship forbidden page automation or source network calls', () => { expect(source).not.toMatch(/\.click\s*\(/); expect(source).not.toMatch(/dispatchEvent|scrollTo|\.focus\s*\(|MutationObserver|linkedin\.com.*fetch|fetch.*linkedin\.com/); });
  it('has minimal persistent permissions and no source host permissions', () => { const data = JSON.parse(manifest); expect(data.permissions).toEqual(['activeTab', 'scripting', 'storage']); expect(data).not.toHaveProperty('host_permissions'); expect(data.permissions).not.toContain('cookies'); });
  it('strips active elements before payload creation', () => { expect(source).toMatch(/script,iframe,form,input,button/); expect(source).toMatch(/document\.implementation\.createHTMLDocument/); });
  it('keeps the complete Workday job container for future parser upgrades', () => { expect(source).toMatch(/jobPostingPage/); expect(source).toMatch(/cloneNode\(true\)/); expect(source).toMatch(/jobSidebar/); });
  it('recognizes Greenhouse job pages without operating on the source site', () => { expect(source).toMatch(/job-post-container/); expect(source).toMatch(/source === 'greenhouse'/); });
  it('recognizes SmartRecruiters job pages without operating on the source site', () => { expect(source).toMatch(/jobad-main/); expect(source).toMatch(/source === 'smartrecruiters'/); });
});
