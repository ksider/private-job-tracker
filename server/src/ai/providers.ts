import type { ProviderType } from './schemas.js';

export type ProviderConnection = { provider_type: ProviderType; base_url: string | null; api_key: string; model: string; temperature?: number; max_output_tokens: number; timeout_ms: number; rate_limit_key?: string; requests_per_minute?: number; tokens_per_minute?: number };
export type ModelInfo = { id: string; name: string };
export type GenerationRequest = { system: string; user: string };
export interface AIProvider { readonly id: ProviderType; validate(connection: ProviderConnection): Promise<void>; listModels(connection: ProviderConnection): Promise<ModelInfo[]>; generateJson(connection: ProviderConnection, request: GenerationRequest): Promise<unknown>; }

const endpoint = (base: string, suffix: string) => `${base.replace(/\/$/, '')}${suffix}`;
const safeJson = (text: string) => { const trimmed = text.trim(); const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim() ?? trimmed; try { return JSON.parse(fenced); } catch { const first = fenced.indexOf('{'); const last = fenced.lastIndexOf('}'); if (first >= 0 && last > first) return JSON.parse(fenced.slice(first, last + 1)); throw new Error('AI provider returned content that does not contain a valid JSON object.'); } };
const errorDetail = (payload: string) => { try { const parsed = JSON.parse(payload) as { message?: unknown; error?: { message?: unknown } | string; detail?: unknown }; const value = parsed.error && typeof parsed.error === 'object' ? parsed.error.message : parsed.message ?? parsed.error ?? parsed.detail; return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 400) : ''; } catch { return payload.replace(/\s+/g, ' ').trim().slice(0, 400); } };
const responseFormatUnsupported = (error: unknown) => error instanceof Error && /AI provider request failed \(4\d\d\).*\b(response[ _-]?format|structured output|json[ _-]?(?:object|mode|schema))\b/i.test(error.message);
async function request(url: string, init: RequestInit, timeoutMs: number) { const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }); const payload = await response.text(); if (!response.ok) { const detail = errorDetail(payload); const target = new URL(url); console.warn(`[AI provider] ${init.method ?? 'GET'} ${target.origin}${target.pathname} failed with ${response.status}${detail ? `: ${detail}` : ''}`); throw new Error(`AI provider request failed (${response.status})${detail ? `: ${detail}` : '.'}`); } try { return JSON.parse(payload) as unknown; } catch { throw new Error('AI provider returned an invalid JSON response.'); } }
const publicHttpsUrl = (raw: string) => { const url = new URL(raw); const privateHost = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(url.hostname); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || privateHost) throw new Error('Generic OpenAI-compatible endpoints must use a public HTTPS base URL without credentials. Use Ollama for local endpoints.'); return url.toString().replace(/\/$/, ''); };
const ollamaUrl = (raw: string | null) => { const url = new URL(raw || 'http://127.0.0.1:11434'); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Ollama URL must be a plain HTTP(S) server URL.'); return url.toString().replace(/\/$/, ''); };
export function validateProviderBaseUrl(type: ProviderType, baseUrl?: string) { if (!baseUrl || type === 'openrouter') return; if (type === 'ollama') { ollamaUrl(baseUrl); return; } publicHttpsUrl(baseUrl); }

class OpenAiCompatibleProvider implements AIProvider {
  constructor(readonly id: ProviderType, private readonly fixedBase?: string, private readonly skipResponseFormat?: (connection: ProviderConnection) => boolean, private readonly forceFixedBase = false) {}
  private base(connection: ProviderConnection) { return this.forceFixedBase && this.fixedBase ? this.fixedBase : connection.base_url ? publicHttpsUrl(connection.base_url) : this.fixedBase ?? publicHttpsUrl(connection.base_url || ''); }
  private headers(connection: ProviderConnection) { return { 'content-type': 'application/json', ...(connection.api_key ? { authorization: `Bearer ${connection.api_key}` } : {}) }; }
  async validate(connection: ProviderConnection) { await this.listModels(connection); }
  async listModels(connection: ProviderConnection) {
    const data = await request(endpoint(this.base(connection), '/models'), { headers: this.headers(connection) }, connection.timeout_ms) as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }> };
    return (data.data?.map(model => model.id).filter((id): id is string => Boolean(id)) ?? data.models?.map(model => model.name).filter((id): id is string => Boolean(id)) ?? []).map(id => ({ id, name: id }));
  }
  async generateJson(connection: ProviderConnection, prompt: GenerationRequest) {
    const body = { model: connection.model, temperature: connection.temperature ?? 0, max_tokens: connection.max_output_tokens, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }] };
    const generate = (withResponseFormat: boolean) => request(endpoint(this.base(connection), '/chat/completions'), { method: 'POST', headers: this.headers(connection), body: JSON.stringify({ ...body, ...(withResponseFormat ? { response_format: { type: 'json_object' } } : {}) }) }, connection.timeout_ms) as Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
    let data: { choices?: Array<{ message?: { content?: string } }> };
    try { data = await generate(!this.skipResponseFormat?.(connection)); }
    catch (error) {
      // Some OpenRouter routes (including free models) deliberately omit JSON
      // mode. The prompts still demand JSON and safeJson validates it locally.
      if (!responseFormatUnsupported(error)) throw error;
      data = await generate(false);
    }
    const content = data.choices?.[0]?.message?.content; if (!content) throw new Error('AI provider returned no analysis content.'); return safeJson(content);
  }
}

class OllamaProvider implements AIProvider {
  readonly id = 'ollama' as const;
  private base(connection: ProviderConnection) { return ollamaUrl(connection.base_url); }
  async validate(connection: ProviderConnection) { await this.listModels(connection); }
  async listModels(connection: ProviderConnection) { const data = await request(endpoint(this.base(connection), '/api/tags'), {}, connection.timeout_ms) as { models?: Array<{ name?: string }> }; return (data.models ?? []).flatMap(model => model.name ? [{ id: model.name, name: model.name }] : []); }
  async generateJson(connection: ProviderConnection, prompt: GenerationRequest) { const data = await request(endpoint(this.base(connection), '/api/chat'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: connection.model, stream: false, format: 'json', options: { temperature: connection.temperature ?? 0, num_predict: connection.max_output_tokens }, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }] }) }, connection.timeout_ms) as { message?: { content?: string } }; if (!data.message?.content) throw new Error('Ollama returned no analysis content.'); return safeJson(data.message.content); }
}

class GeminiProvider extends OpenAiCompatibleProvider {
  constructor() { super('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'); }
}

export class ProviderRegistry {
  private readonly providers = new Map<ProviderType, AIProvider>([
    ['openai', new OpenAiCompatibleProvider('openai', 'https://api.openai.com/v1')],
    ['mistral', new OpenAiCompatibleProvider('mistral', 'https://api.mistral.ai/v1')],
    ['openai_compatible', new OpenAiCompatibleProvider('openai_compatible')],
    ['openrouter', new OpenAiCompatibleProvider('openrouter', 'https://openrouter.ai/api/v1', connection => /:free$/i.test(connection.model), true)],
    ['ollama', new OllamaProvider()], ['gemini', new GeminiProvider()]
  ]);
  private readonly nextRequestAt = new Map<string, number>();
  get(type: ProviderType) { return this.providers.get(type)!; }
  private async waitForSlot(connection: ProviderConnection, request: GenerationRequest) {
    if (!connection.rate_limit_key || !connection.requests_per_minute || !connection.tokens_per_minute) return;
    // A conservative reservation (input estimate plus max output) keeps every
    // tracker feature under the provider's shared RPM and TPM budget.
    const estimatedTokens = Math.ceil((request.system.length + request.user.length) / 4) + connection.max_output_tokens;
    const rpmInterval = 60_000 / connection.requests_per_minute;
    const tpmInterval = estimatedTokens * 60_000 / connection.tokens_per_minute;
    const now = Date.now(); const next = Math.max(now, this.nextRequestAt.get(connection.rate_limit_key) ?? 0);
    this.nextRequestAt.set(connection.rate_limit_key, next + Math.ceil(Math.max(rpmInterval, tpmInterval)));
    if (next > now) await new Promise<void>(resolve => setTimeout(resolve, next - now));
  }
  async generateJson(connection: ProviderConnection, request: GenerationRequest) { await this.waitForSlot(connection, request); return this.get(connection.provider_type).generateJson(connection, request); }
  limited(connection: ProviderConnection): AIProvider {
    const provider = this.get(connection.provider_type);
    return { id: provider.id, validate: value => provider.validate(value), listModels: value => provider.listModels(value), generateJson: (_value, request) => this.generateJson(connection, request) };
  }
  definitions() { return [...this.providers.keys()].map(id => ({ id, name: ({ openai: 'OpenAI', gemini: 'Google Gemini', mistral: 'Mistral AI', ollama: 'Ollama (local)', openrouter: 'OpenRouter', openai_compatible: 'OpenAI-compatible API' } as Record<ProviderType, string>)[id] })); }
}
