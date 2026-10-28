import { JobDatabase } from '../db/database.js';
import { normalizeJobLocation } from '../ai/location-normalization.js';
import { ProviderRegistry } from '../ai/providers.js';
import { SecretStore } from '../ai/secret-store.js';

const args = new Set(process.argv.slice(2));
const numericArg = (name: string, fallback: number) => {
  const value = process.argv.find(argument => argument.startsWith(`${name}=`))?.slice(name.length + 1);
  const parsed = value ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
};
const apply = args.has('--apply');
const includeArchived = args.has('--include-archived');
const limit = numericArg('--limit', 10_000);
const databasePath = process.env.DATABASE_PATH ?? './data/jobs.db';
const secret = process.env.AI_SECRETS_KEY ?? process.env.API_TOKEN;

const db = new JobDatabase(databasePath);
try {
  const candidates = db.geographyBackfillCandidates({ includeArchived, limit });
  if (!apply) {
    console.log(`Preview: ${candidates.length} vacancy(s) need geography normalization${includeArchived ? ', including archived' : ''}.`);
    console.log('No AI request was sent. Run again with --apply to process them.');
    process.exitCode = 0;
  } else {
    if (!secret) throw new Error('AI_SECRETS_KEY or API_TOKEN is required to decrypt the selected AI provider key.');
    const settings = db.settings(); const connection = db.getConnection(settings.tag_connection_id ?? settings.default_connection_id ?? '');
    if (!connection?.enabled) throw new Error('Configure an enabled AI provider for tags before running geography backfill.');
    const providers = new ProviderRegistry(); const secrets = new SecretStore(secret);
    const limitedConnection = { provider_type: connection.provider_type, base_url: connection.base_url, api_key: connection.encrypted_api_key ? secrets.decrypt(connection.encrypted_api_key) : '', model: connection.model, temperature: connection.temperature, max_output_tokens: connection.max_output_tokens, timeout_ms: connection.timeout_ms, rate_limit_key: connection.id, requests_per_minute: connection.requests_per_minute, tokens_per_minute: connection.tokens_per_minute };
    let completed = 0; let empty = 0; let failed = 0;
    for (const job of candidates) {
      try {
        const fields = await normalizeJobLocation({ provider: providers.limited(limitedConnection), connection: limitedConnection, location: job.location, descriptionText: job.description_text });
        db.update(job.id, { geo_country_code: fields.country_code, geo_country: fields.country, geo_region: fields.region, geo_city: fields.city, geo_source: 'ai' });
        completed += 1; if (!fields.country && !fields.region && !fields.city) empty += 1;
        console.log(`[${completed}/${candidates.length}] ${job.company ?? '—'} · ${job.title ?? '—'}`);
      } catch (error) { failed += 1; console.error(`Failed: ${job.id} · ${error instanceof Error ? error.message : 'Unknown error'}`); }
    }
    console.log(`Done: ${completed} processed, ${empty} without confident geography, ${failed} failed.`);
    if (failed) process.exitCode = 1;
  }
} finally {
  db.db.close();
}
