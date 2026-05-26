export interface SerpLocation {
  code: number
  label: string
}

export const SERP_LOCATIONS: SerpLocation[] = [
  { code: 2826, label: 'United Kingdom' },
  { code: 2840, label: 'United States' },
  { code: 2124, label: 'Canada' },
  { code: 2036, label: 'Australia' },
  { code: 2356, label: 'India' },
  { code: 2276, label: 'Germany' },
  { code: 2250, label: 'France' },
  { code: 2724, label: 'Spain' },
  { code: 2380, label: 'Italy' },
  { code: 2528, label: 'Netherlands' },
  { code: 2392, label: 'Japan' },
  { code: 2484, label: 'Mexico' },
]

export function locationLabel(code: number): string {
  return SERP_LOCATIONS.find(l => l.code === code)?.label ?? String(code)
}
