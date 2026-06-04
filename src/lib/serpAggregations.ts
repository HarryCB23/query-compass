import type { SerpSnapshotData } from '@/components/QueryTable'

export interface DomainStats {
  domain: string
  organicCount: number
  topStoriesCount: number
  total: number
}

export function normalizeDomain(d: string): string {
  try {
    const url = new URL(d.startsWith('http') ? d : `https://${d}`)
    return url.hostname.replace(/^(www\.|amp\.|m\.|mobile\.)/i, '').toLowerCase()
  } catch {
    return d.replace(/^(www\.|amp\.|m\.|mobile\.)/i, '').toLowerCase()
  }
}

export function aggregateCompetitorDomains(
  snapshots: Map<string, SerpSnapshotData>,
  filter?: (snap: SerpSnapshotData) => boolean,
): DomainStats[] {
  const organic     = new Map<string, number>()
  const topStories  = new Map<string, number>()

  for (const snap of snapshots.values()) {
    if (filter && !filter(snap)) continue
    for (const d of snap.top_organic_domains ?? []) {
      const norm = normalizeDomain(d)
      organic.set(norm, (organic.get(norm) ?? 0) + 1)
    }
    for (const d of snap.top_stories_domains ?? []) {
      const norm = normalizeDomain(d)
      topStories.set(norm, (topStories.get(norm) ?? 0) + 1)
    }
  }

  const all = new Set([...organic.keys(), ...topStories.keys()])
  return Array.from(all)
    .map(domain => ({
      domain,
      organicCount:    organic.get(domain)    ?? 0,
      topStoriesCount: topStories.get(domain) ?? 0,
      total:           (organic.get(domain) ?? 0) + (topStories.get(domain) ?? 0),
    }))
    .sort((a, b) => b.total - a.total)
}
