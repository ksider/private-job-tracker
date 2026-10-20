import type { Settings } from '../types.js'; import { importSnapshot } from '../api/client.js'; import { queuedSnapshots, removeQueued } from '../queue/indexed-db.js';
const getSettings = async (): Promise<Settings> => chrome.storage.local.get({ backendUrl: '', apiToken: '' }) as Promise<Settings>;
async function retryQueue() { const settings = await getSettings(); if (!settings.backendUrl || !settings.apiToken) return; for (const item of await queuedSnapshots()) { try { await importSnapshot(settings, item.snapshot); await removeQueued(item.id); } catch { break; } } }
chrome.runtime.onMessage.addListener((message, _sender, respond) => { if (message.type === 'retry-queue') { retryQueue().then(() => respond({ ok: true })).catch(error => respond({ ok: false, error: String(error) })); return true; } });
chrome.runtime.onStartup.addListener(() => { void retryQueue(); });
