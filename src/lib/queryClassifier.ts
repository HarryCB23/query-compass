/**
 * queryClassifier — branded-only detection.
 *
 * Claude handles all category classification (news, informational, commercial,
 * transactional, product, other) via the classify-queries edge function.
 * This module's only job is the branded check: exact substring match against
 * the project's branded_terms list, which is free, instant, and needs no LLM.
 *
 * Returns 'branded' if any term matches, 'other' otherwise.
 * ImportView merges this with DB classifications from the classifications table.
 */

import type { QueryCategory } from '@/types/query'

export function classifyQuery(
  query: string,
  config: { brandedTerms: string[] },
): QueryCategory {
  const q = query.toLowerCase().trim()
  for (const term of config.brandedTerms) {
    if (q.includes(term.toLowerCase())) return 'branded'
  }
  return 'other'
}
