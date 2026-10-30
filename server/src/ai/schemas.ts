import { z } from 'zod';

export const ProviderTypeSchema = z.enum(['openai', 'gemini', 'mistral', 'ollama', 'openrouter', 'openai_compatible']);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;
export const ConnectionCreateSchema = z.object({ provider_type: ProviderTypeSchema, display_name: z.string().trim().min(1).max(100), base_url: z.string().trim().max(500).optional(), api_key: z.string().max(1000).optional().default(''), model: z.string().trim().min(1).max(200), temperature: z.number().min(0).max(2).optional().default(0.1), max_output_tokens: z.number().int().min(128).max(16_384).optional().default(1200), timeout_ms: z.number().int().min(5_000).max(180_000).optional().default(60_000), requests_per_minute: z.number().int().min(1).max(600).optional().default(10), tokens_per_minute: z.number().int().min(1_000).max(2_000_000).optional().default(60_000), enabled: z.boolean().optional().default(true) });
export const ConnectionPatchSchema = ConnectionCreateSchema.partial().refine(value => Object.keys(value).length > 0, 'At least one field is required');
export const AiSettingsPatchSchema = z.object({ default_connection_id: z.string().uuid().nullable().optional(), default_model: z.string().trim().max(200).nullable().optional(), tag_connection_id: z.string().uuid().nullable().optional(), email_connection_id: z.string().uuid().nullable().optional(), generic_parse_connection_id: z.string().uuid().nullable().optional(), snapshot_parse_connection_id: z.string().uuid().nullable().optional(), auto_match_on_import: z.boolean().optional(), auto_tags_on_import: z.boolean().optional(), auto_generic_parse_on_import: z.boolean().optional(), auto_location_on_import: z.boolean().optional(), auto_email_classification: z.boolean().optional() }).refine(value => Object.keys(value).length > 0, 'At least one field is required');
export const MatchRequestSchema = z.object({ connection_id: z.string().uuid().optional(), model: z.string().trim().max(200).optional(), consent: z.boolean().optional().default(false) });
export const TagSuggestionsRequestSchema = z.object({ connection_id: z.string().uuid().optional(), model: z.string().trim().max(200).optional() });
export const GenericParseRequestSchema = z.object({ connection_id: z.string().uuid().optional(), model: z.string().trim().max(200).optional() });
export const LocationNormalizeRequestSchema = z.object({ model: z.string().trim().max(200).optional() });
export const StrategyRequestSchema = z.object({ connection_id: z.string().uuid() });
export const TagSuggestionsResultSchema = z.object({ tag_ids: z.array(z.string().uuid()).max(20).default([]), new_tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]) });
const GenericParseTextSchema = z.string().trim().max(500).nullable().optional().catch(null).transform(value => value || null);
export const GenericParseResultSchema = z.object({
  title: GenericParseTextSchema,
  company: GenericParseTextSchema,
  location: GenericParseTextSchema,
  workplace_type: GenericParseTextSchema,
  employment_type: GenericParseTextSchema,
});
export type GenericParseResult = z.infer<typeof GenericParseResultSchema>;
export const LocationNormalizationResultSchema = z.object({
  country_code: z.string().trim().regex(/^[A-Za-z]{2}$/).nullable().optional().catch(null).transform(value => value ? value.toUpperCase() : null),
  country: GenericParseTextSchema,
  region: GenericParseTextSchema,
  city: GenericParseTextSchema,
});
export type LocationNormalizationResult = z.infer<typeof LocationNormalizationResultSchema>;

export type MatchClassification = 'strong' | 'potential' | 'weak' | 'insufficient_data';
const MatchClassificationSchema = z.enum(['strong', 'potential', 'weak', 'insufficient_data']);
const MatchTextSchema = z.string().trim().max(2_000).catch('');
const MatchListSchema = z.array(z.string().trim().min(1).max(600)).max(8).catch([]);

/**
 * This is intentionally a compact opinion, not an evidence-audit protocol.
 * The classification remains constrained because the UI uses it for the
 * visible match state; narrative fields may be omitted by a weaker model.
 */
export const MatchMatrixSchema = z.object({
  classification: MatchClassificationSchema,
  vacancy_summary: MatchTextSchema,
  fit_summary: MatchTextSchema,
  fit_reasons: MatchListSchema,
  concerns: MatchListSchema,
  recommendations: MatchListSchema,
});
export type MatchMatrix = z.infer<typeof MatchMatrixSchema>;
export type MatchResult = MatchMatrix;

const StrategyTextSchema = z.string().trim().min(1).max(500);
export const StrategyAdviceSchema = z.object({
  headline: StrategyTextSchema,
  actions: z.array(StrategyTextSchema).min(1).max(3),
  caveat: StrategyTextSchema,
});
export type StrategyAdvice = z.infer<typeof StrategyAdviceSchema>;
