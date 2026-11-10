/**
 * Editorial rules adapted from .ai/human.md for user-visible AI writing.
 * Keep this in source rather than loading .ai at runtime: .ai is deliberately
 * ignored by Git and may not be present in a deployed container.
 */
export const HUMAN_WRITING_GUIDANCE = `Write as a knowledgeable person addressing a specific reader, not as a generic assistant or promotional template. Lead with the concrete connection between this role and the candidate. Use direct sentences, concrete nouns, and ordinary verbs. Preserve supported facts and necessary uncertainty; do not turn specific experience into vague claims of expertise. Every sentence must add a relevant fact, interpretation, or next action. Avoid corporate buzzwords, generic enthusiasm, stock claims of importance, neat but empty slogans, repetitive sentence openings, and a generic future-facing conclusion. Do not manufacture metrics, achievements, employers, qualifications, testimonials, or other facts. Use the conventions of the requested language and write naturally for a real hiring reader.`;
