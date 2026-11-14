import type { AiConnectionRow, AiFunctionKey, JobDatabase } from '../db/database.js';
import type { AIProvider, ProviderConnection, ProviderRegistry, UsageMetrics } from './providers.js';
import type { SecretStore } from './secret-store.js';

export type AiRouteContext = { model: AiConnectionRow; connection: ProviderConnection; provider: AIProvider };
export type AiRouteResult<T> = { value: T; model: AiConnectionRow; attempted_model_ids: string[] };

const providerWideFailure = (error: unknown) => error instanceof Error && (/AI provider request failed \((401|402|403)\)/.test(error.message) || /consent is required|no captured|not found/i.test(error.message));

export class AiRouter {
  constructor(private readonly db: JobDatabase, private readonly providers: ProviderRegistry, private readonly secrets: SecretStore) {}

  connectionFor(model: AiConnectionRow, purpose: string): ProviderConnection {
    return {
      provider_type: model.provider_type,
      base_url: model.base_url,
      api_key: model.encrypted_api_key ? this.secrets.decrypt(model.encrypted_api_key) : '',
      model: model.model,
      temperature: model.temperature,
      max_output_tokens: model.max_output_tokens,
      timeout_ms: model.timeout_ms,
      rate_limit_key: model.provider_id ?? model.id,
      requests_per_minute: model.requests_per_minute,
      tokens_per_minute: model.tokens_per_minute,
      onUsage: (usage: UsageMetrics) => this.db.recordAiUsage({ connection_id: model.id, model: model.model, purpose, ...usage }),
    };
  }

  async run<T>(functionKey: AiFunctionKey, purpose: string, execute: (context: AiRouteContext) => Promise<T>, explicitModelId?: string): Promise<AiRouteResult<T>> {
    const candidates = this.db.routeCandidates(functionKey, explicitModelId);
    if (!candidates.length) throw new Error(`No enabled AI model is configured for ${functionKey}.`);
    const attemptedModelIds: string[] = [];
    let lastError: unknown;
    for (const model of candidates) {
      attemptedModelIds.push(model.id);
      const connection = this.connectionFor(model, purpose);
      try {
        const value = await execute({ model, connection, provider: this.providers.limited(connection) });
        return { value, model, attempted_model_ids: attemptedModelIds };
      } catch (error) {
        lastError = error;
        if (providerWideFailure(error)) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Every configured AI model failed for ${functionKey}.`);
  }
}
