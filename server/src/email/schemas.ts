import { z } from 'zod';

export const EmailCategorySchema = z.enum(['rejection', 'application_confirmation', 'interview_invitation', 'assessment', 'decision_delayed', 'offer', 'other']);
export type EmailCategory = z.infer<typeof EmailCategorySchema>;
const AiAppointmentDateSchema = z.string().trim().max(100).nullable().optional().transform(value => {
  if (!value || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const timestamp = Date.parse(value); return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
});
const AiMeetingUrlSchema = z.string().trim().max(2_048).nullable().optional().transform(value => {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null; }
  catch { return null; }
});
const AiAppointmentFormatSchema = z.string().trim().nullable().optional().transform(value => value === 'video' || value === 'phone' || value === 'in_person' || value === 'other' ? value : null);
const AiAppointmentTextSchema = z.string().trim().max(1_000).nullable().optional().transform(value => value || null);
export const EmailClassificationSchema = z.object({
  category: EmailCategorySchema,
  company: z.string().trim().min(1).max(300).nullable(),
  jobTitle: z.string().trim().min(1).max(500).nullable(),
  applicationId: z.string().trim().min(1).max(300).nullable(),
  evidenceQuote: z.string().trim().min(1).max(1_000).nullable(),
  explanation: z.string().trim().min(1).max(1_500),
  interviewAppointment: z.object({
    startsAt: AiAppointmentDateSchema,
    timeZone: z.string().trim().max(100).nullable().optional().transform(value => value || null),
    format: AiAppointmentFormatSchema,
    meetingUrl: AiMeetingUrlSchema,
    note: AiAppointmentTextSchema
  }).nullable().default(null)
});
export type EmailClassification = z.infer<typeof EmailClassificationSchema>;

export const ImapSettingsSchema = z.object({
  enabled: z.boolean().optional().default(false),
  host: z.string().trim().max(255).optional().default(''),
  port: z.number().int().min(1).max(65_535).optional().default(993),
  tls_mode: z.enum(['tls', 'starttls']).optional().default('tls'),
  username: z.string().trim().max(500).optional().default(''),
  password: z.string().max(2_000).optional().default(''),
  interview_mailbox: z.string().trim().max(500).optional().default(''),
  rejection_mailbox: z.string().trim().max(500).optional().default(''),
  mailbox: z.string().trim().min(1).max(500).optional().default('INBOX'),
  sync_interval_minutes: z.number().int().min(5).max(24 * 60).optional().default(15),
  initial_sync_days: z.number().int().min(1).max(365).optional().default(30),
  rejection_handling: z.enum(['manual_review', 'auto_exact', 'notifications_only']).optional().default('manual_review'),
  allow_ai_email_text: z.boolean().optional().default(false)
});
export type ImapSettingsInput = z.infer<typeof ImapSettingsSchema>;

export const EmailReviewConfirmSchema = z.object({ job_id: z.string().uuid().optional() });
