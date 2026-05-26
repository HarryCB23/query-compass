export interface SerpLocation {
  code: number
  label: string
}

/**
 * Curated city-level DataforSEO location codes.
 * Codes verified via /v3/serp/google/locations/{country} on 2026-05-26.
 * Add more cities as needed — keep sorted alphabetically by label.
 */
export const SERP_LOCATIONS: SerpLocation[] = [
  { code: 1006886, label: 'London, UK' },
  { code: 1023191, label: 'New York, US' },
]

export function locationLabel(code: number): string {
  return SERP_LOCATIONS.find(l => l.code === code)?.label ?? String(code)
}
