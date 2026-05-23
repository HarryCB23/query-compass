/**
 * GSC CSV parser — Deno-native, single source of truth.
 *
 * The browser never parses CSV; it sends raw text to the ingest-csv edge
 * function, which calls parseGSCCSV() here.
 *
 * Header mapping is case-insensitive and tolerates minor GSC export
 * variations (e.g. "Top queries" vs "Query").
 *
 * Number parsing handles both US (1,234.56) and European (1.234,56) locales.
 * CTR is returned as a decimal fraction (0.025 = 2.5 %).
 */

// ---------------------------------------------------------------------------
// Header mapping
// ---------------------------------------------------------------------------

/**
 * Detect the canonical field name for a single GSC header string.
 * Handles both simple exports ("Clicks") and date-range exports
 * ("Last 28 days Clicks", "Same period last year Clicks", etc.).
 * Returns null for unrecognised columns.
 */
function detectColumn(header: string): string | null {
  const h = header.trim().toLowerCase()

  // Query column
  if (h.includes('top queries') || h === 'query' || h === 'queries') {
    return 'query'
  }

  // Determine metric type
  let metric: 'clicks' | 'impressions' | 'ctr' | 'position' | null = null
  if (h.includes('clicks')) metric = 'clicks'
  else if (h.includes('impressions')) metric = 'impressions'
  else if (h.includes('ctr')) metric = 'ctr'
  else if (h.includes('position')) metric = 'position'
  if (!metric) return null

  // Determine period — previous if any of these markers present,
  // otherwise current
  const isPrevious =
    h.includes('previous') ||
    h.includes('same period') ||
    h.includes('last year') ||
    h.includes('year-over-year') ||
    h.includes('y/y') ||
    h.includes('yoy') ||
    h.includes('comparison')

  return `${metric}_${isPrevious ? 'previous' : 'current'}`
}

/**
 * Build a column-index → canonical-field-name map from a header row.
 * Unknown columns are silently ignored.
 */
export function mapGSCHeaders(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (let i = 0; i < headers.length; i++) {
    const canonical = detectColumn(headers[i])
    if (canonical) map[canonical] = i
  }
  return map
}

// ---------------------------------------------------------------------------
// Number parsing — handles US and European decimal separators
// ---------------------------------------------------------------------------

/**
 * Parse a locale-formatted number string to a JS number.
 * Supports:
 *   US:       "1,234.56"  → 1234.56
 *   European: "1.234,56"  → 1234.56
 *   Plain:    "1234.56"   → 1234.56
 * Returns null for empty strings or unparseable values.
 */
export function parseLocaleNumber(value: string): number | null {
  const s = value.trim()
  if (s === '' || s === '-') return null

  // Detect locale: if last separator is a comma → European style
  const lastComma = s.lastIndexOf(',')
  const lastDot   = s.lastIndexOf('.')

  let normalised: string
  if (lastComma > lastDot) {
    // European: strip dots (thousands), replace comma with dot (decimal)
    normalised = s.replace(/\./g, '').replace(',', '.')
  } else {
    // US or plain: strip commas (thousands)
    normalised = s.replace(/,/g, '')
  }

  const n = parseFloat(normalised)
  return isNaN(n) ? null : n
}

/**
 * Parse a locale-formatted percentage string to a decimal fraction.
 * "2.50%"  → 0.025
 * "2,50%"  → 0.025 (European)
 * Returns null for empty / unparseable values.
 */
export function parseLocalePercentage(value: string): number | null {
  const s = value.trim().replace('%', '')
  const n = parseLocaleNumber(s)
  return n === null ? null : n / 100
}

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

export interface ParsedQueryRow {
  query_text:           string
  clicks_current:       number | null
  impressions_current:  number | null
  ctr_current:          number | null  // fraction
  position_current:     number | null
  clicks_previous:      number | null
  impressions_previous: number | null
  ctr_previous:         number | null  // fraction
  position_previous:    number | null
}

export interface ParseCSVResult {
  rows:   ParsedQueryRow[]
  errors: Array<{ line: number; message: string }>
}

// ---------------------------------------------------------------------------
// CSV tokeniser (handles quoted fields with embedded commas/newlines)
// ---------------------------------------------------------------------------

function tokeniseLine(line: string): string[] {
  const fields: string[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] === '"') {
      // Quoted field
      let field = ''
      i++ // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"'; i += 2
        } else if (line[i] === '"') {
          i++; break
        } else {
          field += line[i++]
        }
      }
      fields.push(field)
      if (line[i] === ',') i++
    } else {
      // Unquoted field — read until next comma or end
      const start = i
      while (i < line.length && line[i] !== ',') i++
      fields.push(line.slice(start, i))
      if (line[i] === ',') i++
    }
  }
  return fields
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a Google Search Console CSV export.
 *
 * Expected columns (order-independent, case-insensitive):
 *   Query, Clicks, Impressions, CTR, Position
 * Optional comparison columns:
 *   Clicks (previous period), Impressions (previous period),
 *   CTR (previous period), Position (previous period)
 *
 * Lines that cannot be parsed are skipped; errors are collected in the
 * returned `errors` array so the caller can surface them to the user.
 */
export function parseGSCCSV(csvText: string): ParseCSVResult {
  const lines  = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const rows: ParsedQueryRow[] = []
  const errors: Array<{ line: number; message: string }> = []

  // Find the header row (first non-empty line)
  let headerIdx = -1
  let colMap: Record<string, number> = {}
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    const headers = tokeniseLine(trimmed)
    colMap = mapGSCHeaders(headers)
    if (colMap['query'] !== undefined) {
      headerIdx = i
      break
    }
  }

  if (headerIdx === -1) {
    errors.push({ line: 0, message: 'No recognisable header row found (expected a "Query" column)' })
    return { rows, errors }
  }

  // Parse data rows
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue

    const fields = tokeniseLine(trimmed)
    const lineNum = i + 1  // 1-based for user-facing errors

    const queryText = fields[colMap['query']]?.trim() ?? ''
    if (!queryText) {
      errors.push({ line: lineNum, message: 'Empty query text — skipped' })
      continue
    }

    try {
      const isCtrCol = (col: string) => col === 'ctr_current' || col === 'ctr_previous'
      const get = (col: string): number | null => {
        const idx = colMap[col]
        if (idx === undefined) return null
        const raw = fields[idx] ?? ''
        return isCtrCol(col) ? parseLocalePercentage(raw) : parseLocaleNumber(raw)
      }

      rows.push({
        query_text:           queryText,
        clicks_current:       get('clicks_current'),
        impressions_current:  get('impressions_current'),
        ctr_current:          get('ctr_current'),
        position_current:     get('position_current'),
        clicks_previous:      get('clicks_previous'),
        impressions_previous: get('impressions_previous'),
        ctr_previous:         get('ctr_previous'),
        position_previous:    get('position_previous'),
      })
    } catch (err) {
      errors.push({ line: lineNum, message: String(err) })
    }
  }

  return { rows, errors }
}
