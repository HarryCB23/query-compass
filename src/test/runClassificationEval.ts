/**
 * Classification eval runner.
 *
 * Usage:
 *   npm run eval:classify                   — run against pattern matcher (default)
 *   npm run eval:classify -- --mode=claude  — run against deployed edge function
 *                                             WARNING: incurs Anthropic API costs (~$0.002
 *                                             per 25 queries at Haiku rates). Do not run
 *                                             in CI without budget controls.
 *
 * TSV format: query<TAB>expected_category[<TAB>notes]
 * Lines starting with # are comments and are skipped.
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { classifyQuery } from '../lib/queryClassifier.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Types ──────────────────────────────────────────────────────────────────

type Category = 'branded' | 'news' | 'informational' | 'commercial' | 'transactional' | 'product' | 'other'

const ALL_CATEGORIES: Category[] = [
  'branded', 'news', 'informational', 'commercial', 'transactional', 'product', 'other',
]

interface EvalRow {
  query:    string
  expected: Category
  notes:    string
}

interface CategoryMetrics {
  tp: number  // true positive
  fp: number  // false positive (predicted this, was something else)
  fn: number  // false negative (was this, predicted something else)
}

// ── TSV loader ─────────────────────────────────────────────────────────────

function loadEvalSet(tsvPath: string): EvalRow[] {
  const lines = fs.readFileSync(tsvPath, 'utf-8').split('\n')
  const rows: EvalRow[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [query, expected, notes = ''] = line.split('\t')
    if (!query || !expected) continue
    const cat = expected.trim() as Category
    if (!ALL_CATEGORIES.includes(cat)) {
      console.warn(`  WARN: unknown category "${cat}" for query "${query}" — skipped`)
      continue
    }
    rows.push({ query: query.trim(), expected: cat, notes: notes.trim() })
  }
  return rows
}

// ── Pattern matcher runner (default mode) ─────────────────────────────────

// Branded terms used in the eval fixture. The eval set seeds branded examples
// using 'telegraph'/'the telegraph'. Extend this if your eval set uses other brands.
const EVAL_BRANDED_TERMS = ['telegraph', 'the telegraph']

function runPatternMatcher(rows: EvalRow[]): Map<string, Category> {
  const results = new Map<string, Category>()
  for (const row of rows) {
    results.set(row.query, classifyQuery(row.query, { brandedTerms: EVAL_BRANDED_TERMS }) as Category)
  }
  return results
}

// ── Claude edge function runner ────────────────────────────────────────────

async function runClaudeClassifier(rows: EvalRow[]): Promise<Map<string, Category>> {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  const AUTH_TOKEN = process.env.EVAL_AUTH_TOKEN

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('ERROR: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in .env')
    process.exit(1)
  }
  if (!AUTH_TOKEN) {
    console.error('ERROR: EVAL_AUTH_TOKEN must be set — a valid Supabase JWT for an authenticated user.')
    console.error('       Get it from: supabase.auth.getSession() in the browser console while logged in.')
    process.exit(1)
  }

  console.log(`\n  ⚠  Claude mode: sending ${rows.length} queries to the deployed edge function.`)
  console.log(`     Estimated cost: ~$${((rows.length / 25) * 0.002).toFixed(4)} (Haiku @ $0.002/25-query batch)`)
  console.log(`     Set EVAL_AUTH_TOKEN in .env to a valid session JWT.\n`)

  // This mode requires a project_id. Use EVAL_PROJECT_ID env var.
  const PROJECT_ID = process.env.EVAL_PROJECT_ID
  if (!PROJECT_ID) {
    console.error('ERROR: EVAL_PROJECT_ID must be set to a valid project UUID.')
    process.exit(1)
  }

  const queries = rows.map(r => r.query)
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/classify-queries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ import_id: 'eval', project_id: PROJECT_ID, eval_queries: queries }),
  })

  if (!resp.ok) {
    const body = await resp.text()
    console.error(`ERROR: edge function returned ${resp.status}: ${body}`)
    process.exit(1)
  }

  const data = await resp.json()
  const results = new Map<string, Category>()
  for (const r of (data.results ?? [])) {
    results.set(r.query, r.category as Category)
  }
  return results
}

// ── Metrics ────────────────────────────────────────────────────────────────

function computeMetrics(
  rows: EvalRow[],
  predictions: Map<string, Category>,
): {
  overall: number
  byCategory: Record<Category, CategoryMetrics>
  confusion: Record<Category, Record<Category, number>>
  disagreements: Array<{ query: string; expected: Category; actual: Category; notes: string }>
} {
  const byCategory = Object.fromEntries(
    ALL_CATEGORIES.map(c => [c, { tp: 0, fp: 0, fn: 0 }])
  ) as Record<Category, CategoryMetrics>

  const confusion = Object.fromEntries(
    ALL_CATEGORIES.map(c => [c, Object.fromEntries(ALL_CATEGORIES.map(d => [d, 0]))])
  ) as Record<Category, Record<Category, number>>

  const disagreements: Array<{ query: string; expected: Category; actual: Category; notes: string }> = []
  let correct = 0

  for (const row of rows) {
    const actual = predictions.get(row.query) ?? 'other'
    confusion[row.expected][actual]++

    if (actual === row.expected) {
      correct++
      byCategory[row.expected].tp++
    } else {
      byCategory[row.expected].fn++
      byCategory[actual].fp++
      disagreements.push({ query: row.query, expected: row.expected, actual, notes: row.notes })
    }
  }

  return { overall: correct / rows.length, byCategory, confusion, disagreements }
}

// ── Printing ───────────────────────────────────────────────────────────────

function pct(n: number) { return `${(n * 100).toFixed(1)}%` }
function pad(s: string, w: number) { return s.padEnd(w) }
function rpad(s: string, w: number) { return s.padStart(w) }

function printResults(
  mode: string,
  rows: EvalRow[],
  metrics: ReturnType<typeof computeMetrics>,
) {
  const { overall, byCategory, confusion, disagreements } = metrics

  console.log(`\n${'='.repeat(70)}`)
  console.log(`  Classification eval — mode: ${mode}`)
  console.log(`  Eval set: ${rows.length} queries`)
  console.log(`${'='.repeat(70)}`)

  // Per-category accuracy
  console.log('\n  Per-category (precision / recall / count):')
  console.log(`  ${'Category'.padEnd(16)} ${'Prec'.padStart(6)} ${'Recall'.padStart(7)} ${'F1'.padStart(6)}  ${'n'.padStart(4)}`)
  console.log(`  ${'-'.repeat(44)}`)
  for (const cat of ALL_CATEGORIES) {
    const m = byCategory[cat]
    const total = m.tp + m.fn
    if (total === 0) continue
    const prec   = m.tp + m.fp > 0 ? m.tp / (m.tp + m.fp) : 0
    const recall = m.tp / total
    const f1     = prec + recall > 0 ? 2 * prec * recall / (prec + recall) : 0
    console.log(`  ${pad(cat, 16)} ${rpad(pct(prec), 6)} ${rpad(pct(recall), 7)} ${rpad(pct(f1), 6)}  ${rpad(String(total), 4)}`)
  }
  console.log(`\n  Overall accuracy: ${pct(overall)} (${Math.round(overall * rows.length)}/${rows.length})`)

  // Confusion matrix
  console.log('\n  Confusion matrix (row = actual/expected, col = predicted):')
  const colW = 7
  console.log('  ' + pad('', 16) + ALL_CATEGORIES.map(c => rpad(c.slice(0, 6), colW)).join(''))
  console.log('  ' + '-'.repeat(16 + ALL_CATEGORIES.length * colW))
  for (const actual of ALL_CATEGORIES) {
    const row = ALL_CATEGORIES.map(pred => confusion[actual][pred])
    if (row.every(v => v === 0)) continue
    console.log('  ' + pad(actual, 16) + row.map(v => rpad(String(v || '.'), colW)).join(''))
  }

  // Disagreements
  if (disagreements.length === 0) {
    console.log('\n  ✓ No disagreements.')
  } else {
    console.log(`\n  Disagreements (${disagreements.length}):`)
    for (const d of disagreements) {
      const note = d.notes ? `  # ${d.notes}` : ''
      console.log(`  [${d.actual.padEnd(14)} predicted, ${d.expected.padEnd(14)} expected]  "${d.query}"${note}`)
    }
  }

  console.log(`\n${'='.repeat(70)}\n`)
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'pattern'

  const tsvPath = path.resolve(__dirname, 'classification.eval.tsv')
  if (!fs.existsSync(tsvPath)) {
    console.error(`ERROR: eval set not found at ${tsvPath}`)
    process.exit(1)
  }

  const rows = loadEvalSet(tsvPath)
  if (rows.length === 0) {
    console.error('ERROR: no valid rows found in eval set')
    process.exit(1)
  }

  let predictions: Map<string, Category>

  if (mode === 'claude') {
    predictions = await runClaudeClassifier(rows)
  } else {
    predictions = runPatternMatcher(rows)
  }

  const metrics = computeMetrics(rows, predictions)
  printResults(mode, rows, metrics)
}

main().catch(err => { console.error(err); process.exit(1) })
