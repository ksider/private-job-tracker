import { z } from 'zod';
import { InterviewStageSchema } from '@job-tracker/shared';

const MeetingUrlSchema = z.union([z.string().trim().url().max(2_048).refine(value => { try { const protocol = new URL(value).protocol; return protocol === 'https:' || protocol === 'http:'; } catch { return false; } }, 'Meeting URL must use HTTP or HTTPS.'), z.literal('')]).transform(value => value || null).optional();
const TimeZoneSchema = z.union([z.string().trim().min(1).max(100), z.literal('')]).transform(value => value || null).optional();
const MeetingFormatSchema = z.enum(['video', 'phone', 'in_person', 'other']);
const AppointmentStatusSchema = z.enum(['proposed', 'confirmed', 'cancelled']);

export const InterviewAppointmentCreateSchema = z.object({
  stage: InterviewStageSchema.default('interview'),
  starts_at: z.string().datetime(),
  time_zone: TimeZoneSchema,
  format: MeetingFormatSchema.default('video'),
  meeting_url: MeetingUrlSchema,
  note: z.string().trim().max(2_000).optional().default('')
});

export const InterviewAppointmentPatchSchema = InterviewAppointmentCreateSchema.partial().extend({
  status: AppointmentStatusSchema.optional()
}).refine(value => Object.keys(value).length > 0, 'At least one field is required');
