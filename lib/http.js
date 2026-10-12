/**
 * HTTP helpers for the skill-cards host-side routes.
 *
 * Shapes mirror the DSH plugin ecosystem (dsh-skill-center) so routes behave the
 * same behind a reverse proxy, on a LAN hostname, or inside the desktop shell.
 * @module dsh-skill-cards/http
 */

/** Largest JSON body any route in this plugin accepts. */
export const MAX_BODY_BYTES = 256 * 1024
/** Largest raw (image) body an upload route accepts. */
export const MAX_RAW_BYTES = 6 * 1024 * 1024

/** Send a JSON response with caching disabled. */
export function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/** Send a small error envelope. */
export function sendError(response, status, message, extra = {}) {
  sendJson(response, status, { ok: false, error: message, ...extra })
}

/** Send a binary file (image) with a short public cache. */
export function sendFile(response, status, contentType, buffer) {
  response.writeHead(status, {
    'cache-control': 'public, max-age=60',
    'content-type': contentType,
    'content-length': buffer.length,
  })
  response.end(buffer)
}

/** Read and parse a JSON request body. */
export async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (raw === '') return {}
  return JSON.parse(raw)
}

/** Read a raw binary request body, capped at `maxBytes`. */
export async function readRawBody(request, maxBytes = MAX_RAW_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** Decide whether a hostname refers to this machine. */
export function loopbackAuthority(host) {
  if (typeof host !== 'string' || host === '') return false
  let hostname = host
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end !== -1) hostname = host.slice(1, end)
  } else {
    const colon = host.lastIndexOf(':')
    if (colon !== -1) hostname = host.slice(0, colon)
  }
  hostname = hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  if (hostname === '::1') return true
  return /^127\./.test(hostname)
}

/**
 * Guard a mutating route against cross-site callers.
 *
 * Kept deliberately permissive for loopback hosts: the DSH desktop shell serves
 * the UI from its own `dsh-app://` scheme, so a renderer fetch to
 * `http://127.0.0.1:<port>` is cross-origin and may carry `Origin: null` or
 * `sec-fetch-site: cross-site`. Rejecting those would break the desktop app
 * outright (the sibling plugins ship with no fence at all). We therefore only
 * reject when the request is addressed to a non-loopback host *and* the origin
 * cannot be reconciled with it — that is the case worth defending.
 */
export function sameOrigin(request, trustedHosts = []) {
  const host = request.headers.host
  if (typeof host !== 'string' || host === '') return null

  // Loopback is this machine talking to itself: always admit.
  if (loopbackAuthority(host)) return null
  if (Array.isArray(trustedHosts) && trustedHosts.some((h) => h === host)) return null

  const origin = request.headers.origin
  if (typeof request.headers['sec-fetch-site'] === 'string' && request.headers['sec-fetch-site'].toLowerCase() === 'cross-site') {
    return 'cross-site request rejected'
  }
  if (typeof origin !== 'string' || origin === '') return 'untrusted host'
  if (origin === 'null') return 'opaque origin rejected'
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    return 'malformed origin rejected'
  }
  if (parsed.host !== host) return 'origin does not match host'
  return null
}

/** Build a small namespaced logger that never throws on partial services. */
export function createLogger(logger, namespace) {
  const prefix = `[${namespace}]`
  return {
    info(message, ...rest) {
      logger?.info?.(`${prefix} ${message}`, ...rest)
    },
    warn(message, ...rest) {
      logger?.warn?.(`${prefix} ${message}`, ...rest)
    },
    error(message, ...rest) {
      const sink = logger?.error ?? logger?.warn
      sink?.(`${prefix} ${message}`, ...rest)
    },
  }
}
