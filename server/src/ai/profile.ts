import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const EvidenceSchema = z.object({ id: z.string().min(1), statement: z.string().min(1), verification_status: z.string().optional(), skill_ids: z.array(z.string()).optional() }).passthrough();
const ProfileSchema = z.object({ profile_id: z.string().min(1), summary: z.object({ text: z.string(), specializations: z.array(z.string()).optional() }).passthrough(), identity: z.object({ professional_titles: z.array(z.string()).optional(), languages: z.array(z.unknown()).optional() }).passthrough(), career_preferences: z.unknown().optional(), education: z.array(z.unknown()).optional(), experience: z.array(z.unknown()).optional(), projects: z.array(z.unknown()).optional(), evidence: z.array(EvidenceSchema), skills: z.unknown().optional(), methods_equipment: z.unknown().optional(), standards_and_compliance: z.unknown().optional() }).passthrough();
export type CandidateProfile = z.infer<typeof ProfileSchema>;
export type LoadedProfile = { profile: CandidateProfile; hash: string; compact: Record<string, unknown>; evidenceIds: Set<string> };
export type ProfileSummary = { configured: true; source: 'uploaded' | 'file'; profile_id: string; evidence_count: number; hash: string } | { configured: false };

export class ProfileLoader {
  constructor(private readonly fallbackPath: string, private readonly uploadedPath?: string) {}
  private async activeFile() {
    if (this.uploadedPath) {
      try { return { raw: await readFile(this.uploadedPath, 'utf8'), source: 'uploaded' as const }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return { raw: await readFile(this.fallbackPath, 'utf8'), source: 'file' as const };
  }
  private parse(raw: string): LoadedProfile {
    const profile = ProfileSchema.parse(JSON.parse(raw));
    const compact = { profile_id: profile.profile_id, summary: profile.summary, identity: profile.identity, career_preferences: profile.career_preferences, education: profile.education, experience: profile.experience, projects: profile.projects, skills: profile.skills, methods_equipment: profile.methods_equipment, standards_and_compliance: profile.standards_and_compliance, evidence: profile.evidence.map(item => ({ statement: item.statement, verification_status: item.verification_status, skill_ids: item.skill_ids })) };
    return { profile, hash: createHash('sha256').update(raw).digest('hex'), compact, evidenceIds: new Set(profile.evidence.map(item => item.id)) };
  }
  async load(): Promise<LoadedProfile> {
    return this.parse((await this.activeFile()).raw);
  }
  async summary(): Promise<ProfileSummary> { try { const active = await this.activeFile(); const loaded = this.parse(active.raw); return { configured: true, source: active.source, profile_id: loaded.profile.profile_id, evidence_count: loaded.evidenceIds.size, hash: loaded.hash }; } catch { return { configured: false }; } }
  validate(input: unknown) { return ProfileSchema.parse(input); }
  async replace(input: unknown): Promise<ProfileSummary> {
    if (!this.uploadedPath) throw new Error('Profile upload is unavailable with an in-memory database.');
    const profile = ProfileSchema.parse(input); const serialized = `${JSON.stringify(profile, null, 2)}\n`;
    await mkdir(path.dirname(this.uploadedPath), { recursive: true });
    const temporary = `${this.uploadedPath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, serialized, { mode: 0o600 }); await rename(temporary, this.uploadedPath);
    const loaded = this.parse(serialized); return { configured: true, source: 'uploaded', profile_id: loaded.profile.profile_id, evidence_count: loaded.evidenceIds.size, hash: loaded.hash };
  }
}
