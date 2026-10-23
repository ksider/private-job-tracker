import { z } from 'zod';

export const BackupSettingsSchema = z.object({
  webhook_url: z.string().trim().refine(value => { if (!value) return true; try { return new URL(value).protocol === 'https:'; } catch { return false; } }, 'Webhook URL must use HTTPS.'),
  webhook_secret: z.string().max(500).optional(),
  automatic_enabled: z.boolean(),
  interval_hours: z.number().int().min(1).max(168)
});
