import path from 'node:path'; import { fileURLToPath } from 'node:url';
import Fastify from 'fastify'; import fastifyStatic from '@fastify/static';
import { JobEventCreateSchema, JobPatchSchema, SnapshotSchema } from '@job-tracker/shared';
import { JobDatabase } from './db/database.js'; import { ParserRegistry } from './parsers/registry.js'; import { safeDescriptionHtml, sanitizeSnapshotHtml } from './security.js';
import { hashJobDescription, matchJob, MATCH_PROMPT_VERSION } from './ai/job-matching.js'; import { ProfileLoader } from './ai/profile.js'; import { ProviderRegistry, validateProviderBaseUrl } from './ai/providers.js'; import { AiSettingsPatchSchema, ConnectionCreateSchema, ConnectionPatchSchema, MatchRequestSchema } from './ai/schemas.js'; import { SecretStore } from './ai/secret-store.js';

export type AppConfig = { databasePath: string; apiToken: string; webRoot?: string; profilePath?: string; aiSecretsKey?: string };
const here = path.dirname(fileURLToPath(import.meta.url));
export function buildApp(config: AppConfig) {
  const app = Fastify({ logger: true, bodyLimit: 1_100_000 }); const db = new JobDatabase(config.databasePath); const registry = new ParserRegistry(); const providers = new ProviderRegistry(); const secrets = new SecretStore(config.aiSecretsKey ?? config.apiToken); const profiles = new ProfileLoader(config.profilePath ?? path.resolve(here, '../../.ai/nikolai_semenov_master_profile_v1.json'));
  const analysisView = (analysis: ReturnType<JobDatabase['latestAnalysis']>, profileHash?: string, descriptionText?: string | null) => analysis ? { id: analysis.id, classification: analysis.classification, result: analysis.result_json ? JSON.parse(analysis.result_json) : null, status: analysis.status, model: analysis.model, provider_type: analysis.provider_type, created_at: analysis.created_at, completed_at: analysis.completed_at, outdated: Boolean(profileHash && descriptionText && (analysis.profile_hash !== profileHash || analysis.job_description_hash !== hashJobDescription(descriptionText))) } : null;
  const connectionFor = (connection: NonNullable<ReturnType<JobDatabase['getConnection']>>, model?: string) => ({ provider_type: connection.provider_type, base_url: connection.base_url, api_key: connection.encrypted_api_key ? secrets.decrypt(connection.encrypted_api_key) : '', model: model || connection.model, max_output_tokens: connection.max_output_tokens, timeout_ms: connection.timeout_ms });
  app.register(fastifyStatic, { root: config.webRoot ?? path.resolve(here, '../../web/dist'), prefix: '/assets/' });
  // The API is called by the installed MV3 extension. Only Chrome extension origins
  // receive CORS headers; authorization is still required on every protected route.
  const extensionOrigin = (origin: string | undefined) => Boolean(origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin));
  app.options('/*', async (request, reply) => {
    const origin = request.headers.origin;
    if (!extensionOrigin(origin)) return reply.code(403).send({ error: 'Extension origin required' });
    return reply.headers({ 'access-control-allow-origin': origin!, 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type', 'access-control-max-age': '600', vary: 'Origin' }).code(204).send();
  });
  app.addHook('onSend', async (request, reply) => {
    // Asset names are stable during local development; force a normal reload to
    // retrieve the latest compiled UI instead of requiring cache-busting reloads.
    if (request.url.startsWith('/assets/')) reply.header('cache-control', 'no-store');
    const origin = request.headers.origin; if (extensionOrigin(origin)) reply.headers({ 'access-control-allow-origin': origin!, vary: 'Origin' });
  });
  const bearer = (request: { headers: { authorization?: string } }) => request.headers.authorization === `Bearer ${config.apiToken}`;
  app.get('/api/health', async (request, reply) => {
    if (request.headers.authorization && !bearer(request)) return reply.code(401).send({ error: 'Invalid API token' });
    return { ok: true, import_authorized: bearer(request) };
  });
  app.post('/api/snapshots/import', async (request, reply) => {
    if (!bearer(request)) return reply.code(401).send({ error: 'Bearer token required' });
    const checked = SnapshotSchema.safeParse(request.body); if (!checked.success) return reply.code(400).send({ error: 'Invalid snapshot', details: checked.error.flatten() });
    const snapshot = checked.data; const sanitized = sanitizeSnapshotHtml(snapshot.snapshot.html); if (!sanitized.trim()) return reply.code(400).send({ error: 'Snapshot has no safe HTML content' });
    const clean = { ...snapshot, snapshot: { ...snapshot.snapshot, html: sanitized } }; const parser = registry.find(clean); const parsed = parser.parse(clean); const result = db.import(parsed, { html: sanitized, text: snapshot.snapshot.text ?? null, collectorVersion: snapshot.metadata.collector_version, capturedAt: snapshot.captured_at });
    return { success: true, job_id: result.jobId, action: result.action, parser: parser.source, warnings: parsed.warnings };
  });
  app.get('/api/jobs', async request => { const profileHash = await profiles.load().then(profile => profile.hash).catch(() => undefined); return db.list(request.query as { search?: string; status?: string; source?: string; order?: string; archive?: string }).map(job => ({ ...job, ai_match: analysisView(db.latestAnalysis(job.id), profileHash, job.description_text) })); });
  app.get('/api/jobs/:id', async (request, reply) => { const id = (request.params as { id: string }).id; const job = db.get(id); const profileHash = await profiles.load().then(profile => profile.hash).catch(() => undefined); return job ? { ...job, description_html: safeDescriptionHtml(job.description_html), events: db.events(id), ai_match: analysisView(db.latestAnalysis(id), profileHash, job.description_text) } : reply.code(404).send({ error: 'Job not found' }); });
  app.patch('/api/jobs/:id', async (request, reply) => { const checked = JobPatchSchema.safeParse(request.body); if (!checked.success) return reply.code(400).send({ error: 'Invalid job update', details: checked.error.flatten() }); const job = db.update((request.params as { id: string }).id, checked.data); return job ?? reply.code(404).send({ error: 'Job not found' }); });
  app.post('/api/jobs/:id/events', async (request, reply) => { const checked = JobEventCreateSchema.safeParse(request.body); if (!checked.success) return reply.code(400).send({ error: 'Invalid timeline event', details: checked.error.flatten() }); const job = db.addEvent((request.params as { id: string }).id, checked.data); return job ? { job, events: db.events(job.id) } : reply.code(404).send({ error: 'Job not found' }); });
  app.get('/api/ai/providers', async () => providers.definitions());
  app.get('/api/ai/connections', async () => db.listConnections());
  app.post('/api/ai/connections', async (request, reply) => { const checked = ConnectionCreateSchema.safeParse(request.body); if (!checked.success) return reply.code(400).send({ error: 'Invalid AI connection', details: checked.error.flatten() }); const data = checked.data; if (data.provider_type !== 'ollama' && !data.api_key) return reply.code(400).send({ error: 'API key is required for this provider.' }); try { validateProviderBaseUrl(data.provider_type, data.base_url); return db.createConnection({ ...data, encrypted_api_key: data.api_key ? secrets.encrypt(data.api_key) : '' }); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not save AI connection.' }); } });
  app.patch('/api/ai/connections/:id', async (request, reply) => { const checked = ConnectionPatchSchema.safeParse(request.body); if (!checked.success) return reply.code(400).send({ error: 'Invalid AI connection update', details: checked.error.flatten() }); try { const data = checked.data; const old = db.getConnection((request.params as { id: string }).id); if (!old) return reply.code(404).send({ error: 'AI connection not found' }); validateProviderBaseUrl(data.provider_type ?? old.provider_type, data.base_url === undefined ? old.base_url ?? undefined : data.base_url); return db.updateConnection(old.id, { ...data, encrypted_api_key: data.api_key ? secrets.encrypt(data.api_key) : undefined }); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not update AI connection.' }); } });
  app.delete('/api/ai/connections/:id', async (request, reply) => db.deleteConnection((request.params as { id: string }).id) ? reply.code(204).send() : reply.code(404).send({ error: 'AI connection not found' }));
  app.post('/api/ai/connections/:id/test', async (request, reply) => { const connection = db.getConnection((request.params as { id: string }).id); if (!connection) return reply.code(404).send({ error: 'AI connection not found' }); try { await providers.get(connection.provider_type).validate(connectionFor(connection)); return { ok: true }; } catch { return reply.code(502).send({ error: 'Provider connection could not be verified. Check endpoint, key, and network access.' }); } });
  app.get('/api/ai/connections/:id/models', async (request, reply) => { const connection = db.getConnection((request.params as { id: string }).id); if (!connection) return reply.code(404).send({ error: 'AI connection not found' }); try { return { models: await providers.get(connection.provider_type).listModels(connectionFor(connection)) }; } catch { return reply.code(502).send({ error: 'Provider model list is unavailable. You may enter a model ID manually.' }); } });
  app.get('/api/ai/settings', async () => db.settings());
  app.patch('/api/ai/settings', async (request, reply) => { const checked = AiSettingsPatchSchema.safeParse(request.body); if (!checked.success) return reply.code(400).send({ error: 'Invalid AI settings', details: checked.error.flatten() }); if (checked.data.default_connection_id && !db.getConnection(checked.data.default_connection_id)) return reply.code(400).send({ error: 'Default AI connection does not exist.' }); return db.updateSettings(checked.data); });
  app.post('/api/jobs/:id/ai-match', async (request, reply) => {
    const checked = MatchRequestSchema.safeParse(request.body ?? {});
    if (!checked.success) return reply.code(400).send({ error: 'Invalid match request', details: checked.error.flatten() });
    const job = db.get((request.params as { id: string }).id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    const settings = db.settings();
    let connection = db.getConnection(checked.data.connection_id ?? settings.default_connection_id ?? '');
    if (!connection || !connection.enabled) return reply.code(409).send({ error: 'Configure and select an enabled default AI provider first.' });
    if (!connection.profile_consent_at) {
      if (!checked.data.consent) return reply.code(412).send({ error: `Confirm that your candidate profile may be sent to ${connection.display_name}.`, requires_consent: true, connection_id: connection.id });
      connection = db.giveProfileConsent(connection.id)!;
    }
    const model = checked.data.model || settings.default_model || connection.model;
    let analysisId: string | undefined;
    try {
      const profile = await profiles.load();
      const description = job.description_text ?? '';
      analysisId = db.startAnalysis({ job_id: job.id, provider_connection_id: connection.id, provider_type: connection.provider_type, model, profile_hash: profile.hash, job_description_hash: hashJobDescription(description), prompt_version: MATCH_PROMPT_VERSION });
      const matched = await matchJob({ provider: providers.get(connection.provider_type), connection: connectionFor(connection, model), descriptionText: description, profile });
      const analysis = db.completeAnalysis(analysisId, matched.result)!;
      return { analysis: analysisView(analysis, profile.hash, description) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI matching failed.';
      if (analysisId) db.failAnalysis(analysisId, message);
      app.log.warn({ err: error, jobId: job.id, connectionId: connection.id, provider: connection.provider_type, model }, 'AI matching failed');
      const safeMessage = message.startsWith('This vacancy') || message.startsWith('AI provider request failed') || message.startsWith('AI provider returned') ? message : 'AI matching failed. Check the server log for details.';
      return reply.code(502).send({ error: safeMessage });
    }
  });
  app.get('/api/jobs/:id/ai-match', async (request, reply) => { const job = db.get((request.params as { id: string }).id); if (!job) return reply.code(404).send({ error: 'Job not found' }); const profileHash = await profiles.load().then(profile => profile.hash).catch(() => undefined); return { analysis: analysisView(db.latestAnalysis(job.id), profileHash, job.description_text) }; });
  app.get('/api/jobs/:id/ai-match/history', async (request, reply) => { const job = db.get((request.params as { id: string }).id); if (!job) return reply.code(404).send({ error: 'Job not found' }); return { analyses: db.analysisHistory(job.id).map(analysis => analysisView(analysis)) }; });
  app.delete('/api/jobs/:id', async (request, reply) => db.delete((request.params as { id: string }).id) ? reply.code(204).send() : reply.code(404).send({ error: 'Job not found' }));
  app.post('/api/jobs/:id/reparse', async (request, reply) => { const job = db.get((request.params as { id: string }).id); const raw = db.latestSnapshot((request.params as { id: string }).id); if (!job || !raw) return reply.code(404).send({ error: 'Job or snapshot not found' }); const snapshot = SnapshotSchema.parse({ schema_version: 1, source: job.source, content_type: 'job', url: job.source_url, page_title: job.title ?? '', captured_at: raw.captured_at, snapshot: { format: 'html', html: raw.raw_html, text: raw.raw_text }, metadata: { collector_version: 'reparse' } }); const parsed = registry.find(snapshot).parse(snapshot); const result = db.import(parsed, { html: raw.raw_html, text: raw.raw_text, collectorVersion: 'reparse', capturedAt: raw.captured_at }); return { success: true, job_id: result.jobId, action: result.action, warnings: parsed.warnings }; });
  app.post('/auth/logout', async () => ({ ok: true }));
  app.get('/login', async (_, reply) => reply.redirect('/'));
  app.get('/', async (_, reply) => reply.type('text/html').sendFile('index.html'));
  return app;
}
