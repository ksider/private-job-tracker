import { z } from 'zod';

export const JOB_STATUSES = ['saved', 'sent', 'interview', 'result', 'archived'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JobStatusSchema = z.enum(JOB_STATUSES);
export const JOB_EVENT_TYPES = ['saved', 'applied', 'hr_screening', 'interview', 'final_interview', 'follow_up', 'result'] as const;
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];
export const JobEventTypeSchema = z.enum(JOB_EVENT_TYPES);
export const INTERVIEW_STAGES = ['hr_screening', 'interview', 'final_interview', 'follow_up'] as const;
export type InterviewStage = (typeof INTERVIEW_STAGES)[number];
export const InterviewStageSchema = z.enum(INTERVIEW_STAGES);

export const SnapshotSchema = z.object({
  schema_version: z.literal(1),
  source: z.string().trim().min(1).max(80),
  content_type: z.literal('job'),
  url: z.string().url().max(4096),
  page_title: z.string().max(500).optional().default(''),
  captured_at: z.string().datetime(),
  snapshot: z.object({
    format: z.literal('html'),
    html: z.string().max(1_000_000),
    text: z.string().max(500_000).nullable().optional()
  }),
  metadata: z.object({ collector_version: z.string().max(40) }).passthrough().default({ collector_version: 'unknown' })
});
export type PageSnapshot = z.infer<typeof SnapshotSchema>;
const JobTextField = z.string().trim().max(500).transform(value => value || null).nullable().optional();
export const JobPatchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  company: JobTextField,
  location: JobTextField,
  employment_type: JobTextField,
  workplace_type: JobTextField,
  source_url: z.string().url().max(4096).optional(),
  status: JobStatusSchema.optional(),
  interview_stage: InterviewStageSchema.optional(),
  notes: z.string().max(20_000).optional()
}).refine(value => Object.values(value).some(value => value !== undefined), 'At least one field is required');
export type JobPatch = z.infer<typeof JobPatchSchema>;
export const JobEventCreateSchema = z.object({
  type: JobEventTypeSchema,
  occurred_at: z.string().datetime(),
  note: z.string().trim().max(2_000).optional().default('')
});
export type JobEventCreate = z.infer<typeof JobEventCreateSchema>;
