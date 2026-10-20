import type { MatchClassification, MatchMatrix } from './schemas.js';

export function classify(matrix: MatchMatrix): MatchClassification {
  const required = matrix.requirements.filter(item => item.importance === 'required');
  const basis = required.length ? required : matrix.requirements.filter(item => item.importance !== 'unspecified');
  if (!basis.length) return 'insufficient_data';
  if (basis.some(item => item.status === 'contradicted')) return 'weak';
  const confirmed = basis.filter(item => item.status === 'confirmed').length;
  const partial = basis.filter(item => item.status === 'partial').length;
  if (confirmed / basis.length >= 0.8 && !basis.some(item => item.status === 'not_evidenced')) return 'strong';
  if (confirmed + partial > 0) return 'potential';
  return 'insufficient_data';
}
