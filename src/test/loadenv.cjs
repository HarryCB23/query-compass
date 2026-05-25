// Temporary helper: parse .env (handles wrapped JWT values) and spawn tsx
const fs = require('fs')
const { spawnSync } = require('child_process')

const raw = fs.readFileSync('.env', 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
const vars = {}
let key = null
for (const line of raw.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) { key = null; continue }
  if (trimmed.includes('=')) {
    const idx = trimmed.indexOf('=')
    key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim()
    vars[key] = val.replace(/^["']|["']$/g, '')  // strip surrounding quotes
  } else if (key) {
    vars[key] += trimmed  // continuation line (e.g. wrapped JWT)
  }
}

// If EVAL_AUTH_TOKEN has 5 JWT parts, it's a double-paste artefact:
// line 1 = full token, line 2 = .payload.signature of a second paste (no header).
// Reconstruct as header.payload.latest_signature.
if (vars['EVAL_AUTH_TOKEN']) {
  const parts = vars['EVAL_AUTH_TOKEN'].split('.')
  if (parts.length === 5 && parts[1] === parts[3]) {
    vars['EVAL_AUTH_TOKEN'] = [parts[0], parts[1], parts[4]].join('.')
  }
}

const args = process.argv.slice(2)
const r = spawnSync('npx', ['tsx', ...args], {
  env: { ...process.env, ...vars },
  stdio: 'inherit',
  shell: true,
})
process.exit(r.status ?? 1)
