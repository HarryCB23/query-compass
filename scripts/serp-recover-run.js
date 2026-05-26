/**
 * serp-recover batch runner
 *
 * Paste this into your browser DevTools console while logged into the app,
 * OR run it in Node.js if you supply a valid bearer token manually.
 *
 * Strategy: always query offset=0 against the shrinking pool of 'submitted'
 * jobs so recovered jobs fall out of the window automatically.
 * Stops when remaining===0 OR when a full batch makes zero progress
 * (all remaining jobs are stuck / task_get cache-miss).
 */
;(async () => {
  const IMPORT_ID   = '09603f12-01dd-4c64-a39f-985b52f80ff7'
  const SUPABASE_URL = 'https://vgascqdmcgffopilfktu.supabase.co'
  const CHUNK_LIMIT  = 50          // max the function allows
  const BATCH_DELAY_MS = 300       // politeness delay between batches

  // ── Get JWT from Supabase localStorage ──────────────────────────────────
  const storageKey = 'sb-vgascqdmcgffopilfktu-auth-token'
  const stored = typeof localStorage !== 'undefined'
    ? localStorage.getItem(storageKey)
    : null

  if (!stored) {
    console.error(
      '❌ Not logged in or not in a browser context.\n' +
      '   Open the app in your browser, log in, then paste this script in DevTools console.'
    )
    return
  }

  let jwt
  try {
    jwt = JSON.parse(stored).access_token
  } catch {
    console.error('❌ Could not parse Supabase session from localStorage.')
    return
  }
  if (!jwt) {
    console.error('❌ No access_token found in Supabase session.')
    return
  }

  console.log('✓ JWT found. Starting serp-recover backfill...')
  console.log(`  Import: ${IMPORT_ID}`)
  console.log(`  Chunk:  ${CHUNK_LIMIT} jobs/batch\n`)

  let totalRecovered = 0
  let totalErrors    = 0
  let totalSkipped   = 0
  let batchNum       = 0
  let stuckBatches   = 0          // consecutive batches with zero recovered

  while (true) {
    batchNum++

    let data
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/serp-recover`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          importId:    IMPORT_ID,
          chunkOffset: 0,          // always 0 — pool shrinks as jobs complete
          chunkLimit:  CHUNK_LIMIT,
        }),
      })

      if (resp.status === 401) {
        console.error('❌ 401 Unauthorized — session may have expired. Re-login and retry.')
        break
      }
      if (!resp.ok) {
        const text = await resp.text()
        console.error(`❌ HTTP ${resp.status} on batch ${batchNum}: ${text}`)
        break
      }

      data = await resp.json()
    } catch (err) {
      console.error(`❌ Network error on batch ${batchNum}:`, err)
      break
    }

    const { recovered = 0, errors = 0, skipped = 0, processed = 0, remaining = 0 } = data

    totalRecovered += recovered
    totalErrors    += errors
    totalSkipped   += skipped

    const progressLine = [
      `Batch ${String(batchNum).padStart(3)}: `,
      `processed=${String(processed).padStart(3)}  `,
      `recovered=${String(recovered).padStart(3)}  `,
      `errors=${String(errors).padStart(2)}  `,
      `skipped=${String(skipped).padStart(2)}  `,
      `remaining=${String(remaining).padStart(4)}`,
      `  [total recovered: ${totalRecovered}]`,
    ].join('')
    console.log(progressLine)

    // ── Termination conditions ─────────────────────────────────────────────
    if (remaining === 0) {
      console.log(`\n✅ Recovery complete.`)
      break
    }

    if (recovered === 0) {
      stuckBatches++
      if (stuckBatches >= 3) {
        console.warn(
          `\n⚠️  3 consecutive batches with 0 recovered — remaining ${remaining} jobs ` +
          `are stuck (task_get cache miss or persistent error). Stopping.`
        )
        break
      }
    } else {
      stuckBatches = 0
    }

    await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
  }

  console.log('\n── Final totals ──────────────────────────────────────────')
  console.log(`  recovered : ${totalRecovered}`)
  console.log(`  errors    : ${totalErrors}`)
  console.log(`  skipped   : ${totalSkipped}`)
  console.log(`  batches   : ${batchNum}`)
  console.log('\nNow run the status-check SQL to confirm final counts.')
})()
