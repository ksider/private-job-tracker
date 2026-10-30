import { z } from 'zod';

const RowsSchema = z.array(z.record(z.string(), z.unknown()));
export const PortableBackupSchema = z.object({
  schema_version: z.literal(1),
  exported_at: z.string(),
  data: z.object({
    jobs: RowsSchema, snapshots: RowsSchema, job_events: RowsSchema, interview_appointments: RowsSchema.optional().default([]), tags: RowsSchema, job_tags: RowsSchema,
    job_match_analyses: RowsSchema, ai_strategy_analyses: RowsSchema.optional().default([]), email_records: RowsSchema, email_effects: RowsSchema,
    ai_provider_connections: RowsSchema.optional().default([]), ai_settings: RowsSchema.optional().default([]), imap_settings: RowsSchema.optional().default([])
  }),
  candidate_profile: z.unknown().nullable().optional()
});

export const BackupRestoreRequestSchema = z.object({ backup: PortableBackupSchema, confirm: z.literal(true) });

export const BackupSettingsSchema = z.object({
  webhook_url: z.string().trim().refine(value => { if (!value) return true; try { return new URL(value).protocol === 'https:'; } catch { return false; } }, 'Webhook URL must use HTTPS.'),
  webhook_secret: z.string().max(500).optional(),
  automatic_enabled: z.boolean(),
  interval_hours: z.number().int().min(1).max(168)
});
