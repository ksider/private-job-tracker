import { z } from 'zod';

export const ProviderTypeSchema = z.enum(['openai', 'gemini', 'mistral', 'ollama', 'openai_compatible']);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;
export const ConnectionCreateSchema = z.object({ provider_type: ProviderTypeSchema, display_name: z.string().trim().min(1).max(100), base_url: z.string().trim().max(500).optional(), api_key: z.string().max(1000).optional().default(''), model: z.string().trim().min(1).max(200), max_output_tokens: z.number().int().min(128).max(16_384).optional().default(1200), timeout_ms: z.number().int().min(5_000).max(180_000).optional().default(60_000), enabled: z.boolean().optional().default(true) });
export const ConnectionPatchSchema = ConnectionCreateSchema.partial().refine(value => Object.keys(value).length > 0, 'At least one field is required');
export const AiSettingsPatchSchema = z.object({ default_connection_id: z.string().uuid().nullable().optional(), default_model: z.string().trim().max(200).nullable().optional() }).refine(value => Object.keys(value).length > 0, 'At least one field is required');
export const MatchRequestSchema = z.object({ connection_id: z.string().uuid().optional(), model: z.string().trim().max(200).optional(), consent: z.boolean().optional().default(false) });
export const TagSuggestionsRequestSchema = z.object({ connection_id: z.string().uuid().optional(), model: z.string().trim().max(200).optional() });
export const TagSuggestionsResultSchema = z.object({ tag_ids: z.array(z.string().uuid()).max(5).default([]), new_tags: z.array(z.string().trim().min(1).max(60)).max(5).default([]) }).refine(value => value.tag_ids.length + value.new_tags.length <= 5, 'At most five tags may be suggested');

const RequirementSchema = z.object({ requirement: z.string().min(1).max(600), job_quote: z.string().min(1).max(600), importance: z.enum(['required', 'preferred', 'unspecified']), status: z.enum(['confirmed', 'partial', 'not_evidenced', 'contradicted', 'not_applicable']), evidenceIds: z.array(z.string().min(1)).max(20), explanation: z.string().min(1).max(1200) });
export const MatchMatrixSchema = z.object({ summary: z.string().min(1).max(2000), requirements: z.array(RequirementSchema).min(1).max(40), eligibility: z.array(z.object({ criterion: z.string().min(1).max(500), status: z.enum(['compatible', 'incompatible', 'unknown']), explanation: z.string().min(1).max(1000) })).max(20), strengths: z.array(z.string().max(500)).max(15), gaps: z.array(z.string().max(500)).max(15), recommendations: z.array(z.string().max(500)).max(15) });
export type MatchMatrix = z.infer<typeof MatchMatrixSchema>;
export type MatchClassification = 'strong' | 'potential' | 'weak' | 'insufficient_data';
export type MatchResult = MatchMatrix & { classification: MatchClassification };
