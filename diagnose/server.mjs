/**
 * Static server for the skill-cards diagnostic page.
 *
 * The diagnostic loads `client/client.js` with real React in a plain browser,
 * bypassing DSH, to prove whether the plugin's own rendering is healthy. React
 * must be served same-origin over HTTP (a bare `file://` page blocks cross-file
 * scripts), so this tiny server exposes everything under one origin.
 *
 * Run:  node diagnose/server.mjs        →  http://127.0.0.1:8940
 * Then open that URL in any browser.
 */
import { createServer } from 'node:http'
import { readFileSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const PORT = process.env.PORT ? Number(process.env.PORT) : 8940

/**
 * React / ReactDOM are needed same-origin (a `file://` page blocks cross-file
 * scripts). They are NOT committed (they are third-party bundles); instead we
 * stage them from the local `node_modules` on first run, and fall back to the
 * CDN URLs when they cannot be found. This keeps the repo small without making
 * the diagnostic depend on a checked-in 1 MB blob.
 */
const REACT_SOURCES = [
  ['react.js', [
    join(root, 'node_modules/react/umd/react.development.js'),
    join(root, 'node_modules/react/umd/react.production.min.js'),
    // React often lives in a global/hoisted install rather than this repo.
    join(homedir(), 'node_modules/react/umd/react.development.js'),
    join(homedir(), 'node_modules/react/umd/react.production.min.js'),
  ]],
  ['react-dom.js', [
    join(root, 'node_modules/react-dom/umd/react-dom.development.js'),
    join(root, 'node_modules/react-dom/umd/react-dom.production.min.js'),
    join(homedir(), 'node_modules/react-dom/umd/react-dom.development.js'),
    join(homedir(), 'node_modules/react-dom/umd/react-dom.production.min.js'),
  ]],
]

function stageReact() {
  for (const [target, candidates] of REACT_SOURCES) {
    const dest = join(here, target)
    if (existsSync(dest)) continue
    const src = candidates.find((p) => existsSync(p))
    if (src) {
      try { copyFileSync(src, dest); continue } catch { /* fall through */ }
    }
    console.warn(`[diagnose] ${target} not found locally; falling back to CDN in index.html`)
  }
}
stageReact()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
}
for (const ext of ['svg', 'webp', 'jpg', 'jpeg']) MIME['.' + ext] = `image/${ext}`

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/' || pathname === '/diagnose' || pathname === '/diagnose/') pathname = '/diagnose/index.html'
  // Prevent traversal.
  const file = normalize(join(root, pathname))
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden'); return
  }
  try {
    const data = readFileSync(file)
    const ext = file.slice(file.lastIndexOf('.')) || '.html'
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404).end('not found: ' + pathname)
  }
})

server.listen(PORT, () => {
  console.log(`skill-cards 诊断页 → http://127.0.0.1:${PORT}/diagnose/`)
})