/**
 * Regression test for the locale translation contract.
 *
 * `ctx.locale.bind(ns)` returns a FUNCTION:
 *     t = (key, params) => translate(ns, key, params)      // dsh-client-locale
 * so the only correct call form is `t('key')`.
 *
 * An earlier version used property access (`t.title`, `t.search`, …) in 22
 * places. Every one of those evaluated to `undefined`, so the panel rendered
 * literal "undefined" and the card grid came out blank.
 *
 * Run: node --test test/locale.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(here, '..', 'client', 'client.js'), 'utf8')

/** Keys declared in a dictionary block. */
function keysOf(block, locale) {
  const body = block.match(new RegExp(`${locale}: \\{([\\s\\S]*?)\\n      \\}`))
  assert.ok(body, `${locale} dictionary not found`)
  // Drop string literals first so a colon inside a value (e.g. "Apply failed: ")
  // is never mistaken for a key; entries are then plain `key: value` pairs.
  const withoutStrings = body[1].replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""')
  return [...withoutStrings.matchAll(/(?:^|[,{\s])([a-zA-Z][a-zA-Z0-9]*)\s*:/g)].map((m) => m[1])
}

/** Keys declared in the client's own zh dictionary. */
function declaredKeys() {
  const block = clientSrc.match(/const STRINGS = \{([\s\S]*?)\n    \}\n/)
  assert.ok(block, 'STRINGS dictionary not found')
  return keysOf(block[1], 'zh')
}

test('every declared key has both a zh and an en entry', () => {
  const block = clientSrc.match(/const STRINGS = \{([\s\S]*?)\n    \}\n/)[1]
  const zh = keysOf(block, 'zh')
  const en = keysOf(block, 'en')
  for (const k of zh) assert.ok(en.includes(k), `key "${k}" is missing from the en dictionary`)
  for (const k of en) assert.ok(zh.includes(k), `key "${k}" is missing from the zh dictionary`)
})

test('no property-style t.key access (would render undefined)', () => {
  // Property access on the bound translate function always yields undefined.
  const offenders = [...clientSrc.matchAll(/\bt\.([a-zA-Z][a-zA-Z0-9]*)\b/g)]
    .filter((m) => !['length', 'name', 'call', 'apply', 'bind', 'toString'].includes(m[1]))
  assert.deepEqual(
    offenders.map((m) => m[0]),
    [],
    'use t(\'key\') — ctx.locale.bind() returns a function, so t.key is undefined',
  )
})

test('every t(\'key\') call refers to a declared key', () => {
  const declared = new Set(declaredKeys())
  const used = [...clientSrc.matchAll(/\bt\('([a-zA-Z][a-zA-Z0-9]*)'\)/g)].map((m) => m[1])
  assert.ok(used.length > 0, 'no t(\'key\') calls found — did the call convention change?')
  for (const k of used) {
    assert.ok(declared.has(k), `t('${k}') has no entry in STRINGS, so it renders as the raw key`)
  }
})

test('the bound t is actually used as a function in the card path', () => {
  // Guards the specific bug: the set-image affordance used a hardcoded literal
  // and Card had no access to t at all.
  // The handler is now a named useCallback (openImageForm) rather than an inline
  // arrow, so React.memo on Card can actually bail out on unrelated re-renders.
  // What matters is only that it stays wired to setEditing.
  assert.match(clientSrc, /onSetImage: openImageForm/, 'card onSetImage wiring changed')
  assert.match(clientSrc, /const openImageForm = useCallback\(\(sk\) => \{\s*setEditing\(\{ skill: sk/, 'openImageForm must open the image form for the card')
  assert.match(clientSrc, /function Card\(\{[^}]*\bt\b[^}]*\}\)/, 'Card must receive t as a prop')
  assert.match(clientSrc, /t\('setImage'\)/, 'the set-image label must come from the dictionary')
})

test('the CSS template literal contains no stray backticks', () => {
  // The stylesheet is a template literal; a backtick inside it (e.g. when
  // quoting a property name) terminates the literal early and silently drops
  // or corrupts every rule after it.
  const start = clientSrc.indexOf('const CSS = `')
  assert.ok(start !== -1, 'CSS template literal not found')
  const end = clientSrc.indexOf('`', start + 'const CSS = `'.length)
  assert.ok(end !== -1, 'CSS template literal is unterminated')
  const body = clientSrc.slice(start + 'const CSS = `'.length, end)
  assert.ok(!body.includes('`'), 'a stray backtick would truncate the stylesheet')
  // The layout rules that keep the card grid usable must survive in the literal.
  // `height:100%` on the card is what equalises card heights per row; the grid
  // uses `grid-auto-rows:1fr` with fixed 4-across columns since the game-card skin.
  for (const rule of ['grid-auto-rows:1fr', 'min-height:0', 'height:100%']) {
    assert.ok(body.includes(rule), `CSS is missing the required rule: ${rule}`)
  }
})

test('every card tint class declared in CSS exists, and TINTS matches', () => {
  const start = clientSrc.indexOf('const CSS = `')
  const body = clientSrc.slice(start + 'const CSS = `'.length, clientSrc.indexOf('`', start + 'const CSS = `'.length))
  const declared = new Set([...body.matchAll(/\.dsh-sc-t(\d+)\s*\{/g)].map((m) => Number(m[1])))
  const count = Number(clientSrc.match(/const TINTS = (\d+)/)[1])
  assert.ok(count > 0, 'TINTS must be positive')
  for (let i = 0; i < count; i++) {
    assert.ok(declared.has(i), `TINTS is ${count} but .dsh-sc-t${i} has no CSS rule`)
  }
  for (const i of declared) {
    assert.ok(i < count, `.dsh-sc-t${i} exists in CSS but TINTS is only ${count}`)
  }
})
