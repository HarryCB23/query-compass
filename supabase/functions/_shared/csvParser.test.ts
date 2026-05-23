/**
 * Deno test suite for csvParser.ts
 * Run: deno test supabase/functions/_shared/csvParser.test.ts
 */

import { assertEquals, assertAlmostEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  mapGSCHeaders,
  parseLocaleNumber,
  parseLocalePercentage,
  parseGSCCSV,
} from './csvParser.ts'

// ---------------------------------------------------------------------------
// mapGSCHeaders
// ---------------------------------------------------------------------------

Deno.test('mapGSCHeaders: maps standard GSC columns', () => {
  const result = mapGSCHeaders(['Query', 'Clicks', 'Impressions', 'CTR', 'Position'])
  assertEquals(result['query'],               0)
  assertEquals(result['clicks_current'],      1)
  assertEquals(result['impressions_current'], 2)
  assertEquals(result['ctr_current'],         3)
  assertEquals(result['position_current'],    4)
})

Deno.test('mapGSCHeaders: case-insensitive matching', () => {
  const result = mapGSCHeaders(['TOP QUERIES', 'CLICKS', 'IMPRESSIONS', 'CTR', 'AVERAGE POSITION'])
  assertEquals(result['query'],            0)
  assertEquals(result['clicks_current'],   1)
  assertEquals(result['position_current'], 4)
})

Deno.test('mapGSCHeaders: ignores unknown columns', () => {
  const result = mapGSCHeaders(['Query', 'Unknown Column', 'Clicks'])
  assertEquals(Object.keys(result).length, 2)
  assertEquals(result['query'],           0)
  assertEquals(result['clicks_current'],  2)
})

// ---------------------------------------------------------------------------
// parseLocaleNumber
// ---------------------------------------------------------------------------

Deno.test('parseLocaleNumber: US format with thousands separator', () => {
  assertEquals(parseLocaleNumber('1,234.56'), 1234.56)
})

Deno.test('parseLocaleNumber: European format with comma decimal', () => {
  assertEquals(parseLocaleNumber('1.234,56'), 1234.56)
})

Deno.test('parseLocaleNumber: plain integer', () => {
  assertEquals(parseLocaleNumber('42'), 42)
})

Deno.test('parseLocaleNumber: empty string returns null', () => {
  assertEquals(parseLocaleNumber(''), null)
})

Deno.test('parseLocaleNumber: dash returns null', () => {
  assertEquals(parseLocaleNumber('-'), null)
})

Deno.test('parseLocaleNumber: non-numeric string returns null', () => {
  assertEquals(parseLocaleNumber('N/A'), null)
})

// ---------------------------------------------------------------------------
// parseLocalePercentage
// ---------------------------------------------------------------------------

Deno.test('parseLocalePercentage: US percentage to fraction', () => {
  assertAlmostEquals(parseLocalePercentage('2.50%')!, 0.025, 1e-6)
})

Deno.test('parseLocalePercentage: European percentage to fraction', () => {
  assertAlmostEquals(parseLocalePercentage('2,50%')!, 0.025, 1e-6)
})

Deno.test('parseLocalePercentage: empty string returns null', () => {
  assertEquals(parseLocalePercentage(''), null)
})

// ---------------------------------------------------------------------------
// parseGSCCSV
// ---------------------------------------------------------------------------

Deno.test('parseGSCCSV: parses standard 5-column CSV', () => {
  const csv = `Query,Clicks,Impressions,CTR,Position
best seo tool,100,1000,10.00%,3.5
keyword research,50,500,10.00%,5.1`

  const { rows, errors } = parseGSCCSV(csv)
  assertEquals(errors.length, 0)
  assertEquals(rows.length, 2)
  assertEquals(rows[0].query_text, 'best seo tool')
  assertEquals(rows[0].clicks_current, 100)
  assertEquals(rows[0].impressions_current, 1000)
  assertAlmostEquals(rows[0].ctr_current!, 0.1, 1e-6)
  assertAlmostEquals(rows[0].position_current!, 3.5, 1e-6)
  assertEquals(rows[0].clicks_previous, null)
})

Deno.test('parseGSCCSV: parses comparison columns', () => {
  const csv = [
    'Query,Clicks,Impressions,CTR,Position,Clicks (previous period),Impressions (previous period),CTR (previous period),Position (previous period)',
    'site:example.com,200,2000,10.00%,2.0,150,1800,8.33%,2.5',
  ].join('\n')

  const { rows, errors } = parseGSCCSV(csv)
  assertEquals(errors.length, 0)
  assertEquals(rows.length, 1)
  assertEquals(rows[0].clicks_previous, 150)
  assertAlmostEquals(rows[0].ctr_previous!, 0.0833, 1e-4)
  assertAlmostEquals(rows[0].position_previous!, 2.5, 1e-6)
})

Deno.test('parseGSCCSV: skips empty lines, collects error for empty query', () => {
  const csv = `Query,Clicks,Impressions,CTR,Position
good query,10,100,10%,1.0

,0,0,0%,0`

  const { rows, errors } = parseGSCCSV(csv)
  assertEquals(rows.length, 1)
  assertEquals(errors.length, 1)
  assertEquals(errors[0].message.includes('Empty query'), true)
})

Deno.test('parseGSCCSV: returns error when no header row found', () => {
  const { rows, errors } = parseGSCCSV('col1,col2\nval1,val2')
  assertEquals(rows.length, 0)
  assertEquals(errors.length, 1)
})

Deno.test('parseGSCCSV: handles Windows CRLF line endings', () => {
  const csv = 'Query,Clicks,Impressions,CTR,Position\r\ntest query,5,50,10%,2.0\r\n'
  const { rows, errors } = parseGSCCSV(csv)
  assertEquals(errors.length, 0)
  assertEquals(rows.length, 1)
  assertEquals(rows[0].query_text, 'test query')
})
