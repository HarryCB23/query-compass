/**
 * Fixture-based tests for parseSerpPostback and computeSummaryFields.
 *
 * Pure functions only — no Deno APIs, safe in vitest/Node context.
 * Fixtures captured from live DataforSEO API on 2026-05-26.
 *
 * Run: pnpm test (vitest run)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  parseSerpPostback,
  computeSummaryFields,
} from '../../supabase/functions/_shared/dataforseoClient'

function loadFixture(name: string): unknown {
  const p = join(__dirname, 'fixtures/serp', `${name}.json`)
  return JSON.parse(readFileSync(p, 'utf-8'))
}

// ── parseSerpPostback ─────────────────────────────────────────────────────────

describe('parseSerpPostback', () => {
  it('extracts queryId, importId, locationCode from tag and data', () => {
    const body = loadFixture('product_organic')
    const [result] = parseSerpPostback(body)
    // tag is 'fixture:product_organic'
    expect(result.importId).toBe('fixture')
    expect(result.queryId).toBe('product_organic')
    expect(result.locationCode).toBe(2826)
    expect(result.error).toBeNull()
    expect(result.items).not.toBeNull()
  })

  it('returns items array for 20000 success (product_organic)', () => {
    const body = loadFixture('product_organic')
    const [result] = parseSerpPostback(body)
    expect(result.error).toBeNull()
    expect(Array.isArray(result.items)).toBe(true)
    expect(result.items!.length).toBeGreaterThan(0)
  })

  it('returns items array for 20000 success with AIO (commercial_shopping)', () => {
    const body = loadFixture('commercial_shopping')
    const [result] = parseSerpPostback(body)
    expect(result.error).toBeNull()
    expect(result.items!.some(i => i.type === 'ai_overview')).toBe(true)
  })

  it('40102 → items=[], error=null, importId+locationCode extracted (no_result)', () => {
    const body = loadFixture('no_result')
    const [result] = parseSerpPostback(body)
    expect(result.error).toBeNull()
    expect(result.items).toEqual([])
    expect(result.queryId).toBe('no_result')
    expect(result.importId).toBe('fixture')
    expect(result.locationCode).toBe(2826)
  })

  it('returns [] for non-object input', () => {
    expect(parseSerpPostback(null)).toEqual([])
    expect(parseSerpPostback('bad')).toEqual([])
    expect(parseSerpPostback({ tasks: 'not-array' })).toEqual([])
  })

  it('returns error for non-20000/non-40102 status_code', () => {
    const body = { tasks: [{ id: 'x', status_code: 40202, status_message: 'bad', data: { tag: 'a:b' }, result: null }] }
    const [result] = parseSerpPostback(body)
    expect(result.error).toContain('40202')
    expect(result.items).toBeNull()
  })
})

// ── computeSummaryFields — feature presence ───────────────────────────────────

describe('computeSummaryFields — feature presence', () => {
  it('detects top_stories, video; no AIO (aio_ts)', () => {
    const body = loadFixture('aio_ts')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, [])

    expect(fields.has_top_stories).toBe(true)
    expect(fields.has_video).toBe(true)
    expect(fields.has_ai_overview).toBe(false)
    expect(fields.has_featured_snippet).toBe(false)
    expect(fields.has_shopping).toBe(false)
    expect(fields.has_local_pack).toBe(false)
  })

  it('detects ai_overview; no top_stories (commercial_shopping)', () => {
    const body = loadFixture('commercial_shopping')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, [])

    expect(fields.has_ai_overview).toBe(true)
    expect(fields.has_top_stories).toBe(false)
  })

  it('no features for pure organic result (product_organic)', () => {
    const body = loadFixture('product_organic')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, [])

    expect(fields.has_ai_overview).toBe(false)
    expect(fields.has_top_stories).toBe(false)
    expect(fields.has_featured_snippet).toBe(false)
    expect(fields.has_shopping).toBe(false)
  })

  it('all-false booleans for empty items (40102 path)', () => {
    const fields = computeSummaryFields([], [])

    expect(fields.has_ai_overview).toBe(false)
    expect(fields.has_top_stories).toBe(false)
    expect(fields.has_featured_snippet).toBe(false)
    expect(fields.has_video).toBe(false)
    expect(fields.has_local_pack).toBe(false)
    expect(fields.has_shopping).toBe(false)
    expect(fields.publisher_in_ai_overview).toBe(false)
    expect(fields.publisher_in_top_stories).toBe(false)
    expect(fields.publisher_in_featured_snippet).toBe(false)
    expect(fields.publisher_organic_position).toBeNull()
    expect(fields.publisher_in_organic_top_3).toBe(false)
    expect(fields.aio_citation_count).toBe(0)
    expect(fields.aio_word_count).toBeNull()
    expect(fields.top_organic_domains).toEqual([])
    expect(fields.top_stories_domains).toEqual([])
    expect(fields.pixels_above_first_organic).toBeNull()
    expect(fields.publisher_pixel_height).toBeNull()
  })
})

// ── computeSummaryFields — publisher presence ─────────────────────────────────

describe('computeSummaryFields — publisher presence', () => {
  it('publisher found in organic (bbc.co.uk, aio_ts)', () => {
    const body = loadFixture('aio_ts')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, ['bbc.co.uk'])

    expect(fields.publisher_organic_position).toBe(2)
    expect(fields.publisher_in_organic_top_3).toBe(true)
  })

  it('publisher not in organic when not present (aio_ts, unknown publisher)', () => {
    const body = loadFixture('aio_ts')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, ['telegraph.co.uk'])

    expect(fields.publisher_organic_position).toBeNull()
    expect(fields.publisher_in_organic_top_3).toBe(false)
  })

  it('publisher found in top_stories (bbc.co.uk, aio_ts)', () => {
    const body = loadFixture('aio_ts')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, ['bbc.co.uk'])

    expect(fields.publisher_in_top_stories).toBe(true)
  })

  it('publisher NOT in top_stories when domain absent (aio_ts, unknown publisher)', () => {
    const body = loadFixture('aio_ts')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, ['telegraph.co.uk'])

    expect(fields.publisher_in_top_stories).toBe(false)
  })

  it('publisher found in AIO references (zapier.com, commercial_shopping)', () => {
    const body = loadFixture('commercial_shopping')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, ['zapier.com'])

    expect(fields.publisher_in_ai_overview).toBe(true)
  })

  it('publisher NOT in AIO references (telegraph.co.uk, commercial_shopping)', () => {
    const body = loadFixture('commercial_shopping')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, ['telegraph.co.uk'])

    expect(fields.publisher_in_ai_overview).toBe(false)
  })

  it('eTLD+1 matching: www.bbc.co.uk matches bbc.co.uk', () => {
    const body = loadFixture('aio_ts')
    const [parsed] = parseSerpPostback(body)
    // organic[0].domain is 'www.bbc.co.uk' — publisherDomains is bare 'bbc.co.uk'
    const fields = computeSummaryFields(parsed.items!, ['bbc.co.uk'])
    expect(fields.publisher_organic_position).toBe(2)
  })

  it('no publisher presence for 40102 empty items', () => {
    const fields = computeSummaryFields([], ['telegraph.co.uk'])
    expect(fields.publisher_in_ai_overview).toBe(false)
    expect(fields.publisher_in_top_stories).toBe(false)
    expect(fields.publisher_in_featured_snippet).toBe(false)
    expect(fields.publisher_organic_position).toBeNull()
    expect(fields.publisher_in_organic_top_3).toBe(false)
  })
})

// ── computeSummaryFields — competitive landscape ──────────────────────────────

describe('computeSummaryFields — competitive landscape', () => {
  it('AIO citation count = 5 (commercial_shopping)', () => {
    const body = loadFixture('commercial_shopping')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, [])

    expect(fields.aio_citation_count).toBe(5)
  })

  it('AIO word count from markdown field = 615 (commercial_shopping)', () => {
    const body = loadFixture('commercial_shopping')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, [])

    expect(fields.aio_word_count).toBe(615)
  })

  it('aio_citation_count = 0 when no AIO (product_organic)', () => {
    const body = loadFixture('product_organic')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, [])

    expect(fields.aio_citation_count).toBe(0)
    expect(fields.aio_word_count).toBeNull()
  })

  it('top_organic_domains: first 5 organic domains (product_organic)', () => {
    const body = loadFixture('product_organic')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, [])

    expect(fields.top_organic_domains[0]).toBe('www.semrush.com')
    expect(fields.top_organic_domains.length).toBe(5)
  })

  it('top_stories_domains includes sky/independent/guardian (news_ts)', () => {
    const body = loadFixture('news_ts')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, [])

    expect(fields.top_stories_domains).toContain('news.sky.com')
    expect(fields.top_stories_domains).toContain('www.independent.co.uk')
    expect(fields.top_stories_domains).toContain('www.theguardian.com')
  })

  it('pixel geometry always null (Phase 4 deferred)', () => {
    const body = loadFixture('commercial_shopping')
    const [parsed] = parseSerpPostback(body)
    const fields = computeSummaryFields(parsed.items!, [])

    expect(fields.pixels_above_first_organic).toBeNull()
    expect(fields.publisher_pixel_height).toBeNull()
  })
})

// ── computeSummaryFields — reserved domain filtering ──────────────────────────
// Regression anchor: DataforSEO sandbox returns example.com as the organic
// domain. These must never reach top_organic_domains / top_stories_domains.

describe('computeSummaryFields — reserved domain filtering', () => {
  it('excludes example.com from top_organic_domains', () => {
    const items = [
      { type: 'organic', domain: 'example.com', rank_absolute: 1 },
      { type: 'organic', domain: 'www.bbc.co.uk', rank_absolute: 2 },
    ]
    const fields = computeSummaryFields(items as import('../../supabase/functions/_shared/dataforseoClient').DataForSeoItem[], [])
    expect(fields.top_organic_domains).not.toContain('example.com')
    expect(fields.top_organic_domains).toContain('www.bbc.co.uk')
  })

  it('excludes example.com sub-variants (example.net, sub.example.com)', () => {
    const items = [
      { type: 'organic', domain: 'example.net', rank_absolute: 1 },
      { type: 'organic', domain: 'sub.example.com', rank_absolute: 2 },
      { type: 'organic', domain: 'www.theguardian.com', rank_absolute: 3 },
    ]
    const fields = computeSummaryFields(items as import('../../supabase/functions/_shared/dataforseoClient').DataForSeoItem[], [])
    expect(fields.top_organic_domains).toEqual(['www.theguardian.com'])
  })

  it('excludes localhost from top_organic_domains', () => {
    const items = [{ type: 'organic', domain: 'localhost', rank_absolute: 1 }]
    const fields = computeSummaryFields(items as import('../../supabase/functions/_shared/dataforseoClient').DataForSeoItem[], [])
    expect(fields.top_organic_domains).toEqual([])
  })

  it('excludes .test and .invalid TLD domains', () => {
    const items = [
      { type: 'organic', domain: 'site.test', rank_absolute: 1 },
      { type: 'organic', domain: 'site.invalid', rank_absolute: 2 },
      { type: 'organic', domain: 'www.independent.co.uk', rank_absolute: 3 },
    ]
    const fields = computeSummaryFields(items as import('../../supabase/functions/_shared/dataforseoClient').DataForSeoItem[], [])
    expect(fields.top_organic_domains).toEqual(['www.independent.co.uk'])
  })

  it('excludes example.com from top_stories_domains', () => {
    const storyItem = {
      type: 'top_stories',
      items: [
        { type: 'top_stories_element', domain: 'example.com' },
        { type: 'top_stories_element', domain: 'news.sky.com' },
      ],
    }
    const fields = computeSummaryFields([storyItem] as import('../../supabase/functions/_shared/dataforseoClient').DataForSeoItem[], [])
    expect(fields.top_stories_domains).not.toContain('example.com')
    expect(fields.top_stories_domains).toContain('news.sky.com')
  })
})
