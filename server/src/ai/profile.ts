import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const EvidenceSchema = z.object({ id: z.string().min(1), statement: z.string().min(1), verification_status: z.string().optional(), skill_ids: z.array(z.string()).optional() }).passthrough();
const ProfileSchema = z.object({ profile_id: z.string().min(1), summary: z.object({ text: z.string(), specializations: z.array(z.string()).optional() }).passthrough(), identity: z.object({ professional_titles: z.array(z.string()).optional(), languages: z.array(z.unknown()).optional() }).passthrough(), career_preferences: z.unknown().optional(), education: z.array(z.unknown()).optional(), experience: z.array(z.unknown()).optional(), projects: z.array(z.unknown()).optional(), evidence: z.array(EvidenceSchema), skills: z.unknown().optional(), methods_equipment: z.unknown().optional(), standards_and_compliance: z.unknown().optional() }).passthrough();
export type CandidateProfile = z.infer<typeof ProfileSchema>;
export type LoadedProfile = { profile: CandidateProfile; hash: string; compact: Record<string, unknown>; evidenceIds: Set<string> };

export class ProfileLoader {
  constructor(private readonly path: string) {}
  async load(): Promise<LoadedProfile> {
    const raw = await readFile(this.path, 'utf8'); const profile = ProfileSchema.parse(JSON.parse(raw));
    const compact = { profile_id: profile.profile_id, summary: profile.summary, identity: profile.identity, career_preferences: profile.career_preferences, education: profile.education, experience: profile.experience, projects: profile.projects, skills: profile.skills, methods_equipment: profile.methods_equipment, standards_and_compliance: profile.standards_and_compliance, evidence: profile.evidence.map(item => ({ id: item.id, statement: item.statement, verification_status: item.verification_status, skill_ids: item.skill_ids })) };
    return { profile, hash: createHash('sha256').update(raw).digest('hex'), compact, evidenceIds: new Set(profile.evidence.map(item => item.id)) };
  }
}
