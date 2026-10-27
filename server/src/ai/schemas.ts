import { z } from 'zod';

export const ProviderTypeSchema = z.enum(['openai', 'gemini', 'mistral', 'ollama', 'openai_compatible']);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;
export const ConnectionCreateSchema = z.object({ provider_type: ProviderTypeSchema, display_name: z.string().trim().min(1).max(100), base_url: z.string().trim().max(500).optional(), api_key: z.string().max(1000).optional().default(''), model: z.string().trim().min(1).max(200), max_output_tokens: z.number().int().min(128).max(16_384).optional().default(1200), timeout_ms: z.number().int().min(5_000).max(180_000).optional().default(60_000), email_requests_per_minute: z.number().int().min(1).max(600).optional().default(10), enabled: z.boolean().optional().default(true) });
export const ConnectionPatchSchema = ConnectionCreateSchema.partial().refine(value => Object.keys(value).length > 0, 'At least one field is required');
export const AiSettingsPatchSchema = z.object({ default_connection_id: z.string().uuid().nullable().optional(), default_model: z.string().trim().max(200).nullable().optional(), tag_connection_id: z.string().uuid().nullable().optional(), email_connection_id: z.string().uuid().nullable().optional(), generic_parse_connection_id: z.string().uuid().nullable().optional(), auto_match_on_import: z.boolean().optional(), auto_tags_on_import: z.boolean().optional(), auto_generic_parse_on_import: z.boolean().optional(), auto_email_classification: z.boolean().optional() }).refine(value => Object.keys(value).length > 0, 'At least one field is required');
export const MatchRequestSchema = z.object({ connection_id: z.string().uuid().optional(), model: z.string().trim().max(200).optional(), consent: z.boolean().optional().default(false) });
export const TagSuggestionsRequestSchema = z.object({ connection_id: z.string().uuid().optional(), model: z.string().trim().max(200).optional() });
export const GenericParseRequestSchema = z.object({ connection_id: z.string().uuid().optional(), model: z.string().trim().max(200).optional() });
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
