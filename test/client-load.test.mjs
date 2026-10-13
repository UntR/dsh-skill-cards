/**
 * Regression test for the client-half loading contract.
 *
 * DSH's `window.__ModuleLoader__.load({ id, factory })` calls `factory(require)`
 * with ONE argument — it does not pass a CommonJS `module`/`exports`.
 * An earlier version declared `factory: (require, module) => …` and crashed the
 * whole web boot with:
 *   dsh-skill-cards: import failed: Cannot read properties of undefined (reading 'exports')
 * which then made DSH reset the profile config.
 *
 * Run: node --test test/client-load.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'client', 'client.js')

/** Minimal React stand-in: enough for the module body to evaluate. */
function fakeReact() {
  const h = (type, props, ...children) => ({ type, props, children })
  // The panel error boundary is a class component extending React.Component,
  // so the stand-in must provide a constructible base class.
  class Component {
    constructor(props) { this.props = props; this.state = {} }
    setState() {}
  }
  return {
    createElement: h,
    Component,
    // Card is wrapped in React.memo so a panel re-render (every search
    // keystroke) does not re-render all ~95 cards. The stand-in must provide
    // it, exactly as the real react module does, or the factory throws.
    memo: (fn) => fn,
    Fragment: Symbol('Fragment'),
    useState: (v) => [v, () => {}],
    useEffect: (fn) => { fn() },
    useMemo: (fn) => fn(),
    useRef: (v) => ({ current: v }),
    useCallback: (fn) => fn,
    useSyncExternalStore: () => null,
  }
}

/** Evaluate client.js in a sandbox and return the captured load spec. */
function captureLoadSpec() {
  return captureLoadSpecWithDocument(null, null)
}

/**
 * Same as captureLoadSpec but lets a test supply its own `document` and `fetch`,
 * so the composer watcher (keydown listener + POST /revoke) can be driven.
 */
function captureLoadSpecWithDocument(doc, fetchImpl) {
  const source = readFileSync(clientPath, 'utf8')
  let spec = null
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (s) => { spec = s } },
      addEventListener() {},
      removeEventListener() {},
    },
    require: (name) => {
      if (name === 'react') return fakeReact()
      throw new Error(`unexpected require(${JSON.stringify(name)})`)
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: doc ?? {
      createElement: () => ({
        style: {}, setAttribute() {}, appendChild() {}, addEventListener() {},
        remove() {}, classList: { add() {}, remove() {} },
      }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
    },
    fetch: fetchImpl ?? (async () => ({ ok: true, json: async () => ({}) })),
    Promise,
  }
  sandbox.globalThis = sandbox
  createContext(sandbox)
  runInContext(source, sandbox)
  return spec
}

test('client.js registers with ModuleLoader under the package name', () => {
  const spec = captureLoadSpec()
  assert.ok(spec, 'window.__ModuleLoader__.load was never called')
  assert.equal(spec.id, 'dsh-skill-cards')
  assert.equal(typeof spec.factory, 'function')
})

test('factory arity is 1 — DSH passes only require, never module', () => {
  const spec = captureLoadSpec()
  assert.equal(
    spec.factory.length,
    1,
    'factory must declare exactly one parameter (require); declaring a second ' +
      '`module` parameter makes it undefined and crashes web boot',
  )
})

test('factory(require) activates and exposes name/inject/apply', () => {
  const spec = captureLoadSpec()
  const react = fakeReact()
  // Exactly how DSH invokes it: a single argument.
  const mod = spec.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require(${JSON.stringify(name)})`)
  })
  assert.ok(mod, 'factory returned nothing')
  assert.equal(mod.name, 'dsh-skill-cards')
  // Spread into a host-realm array: the module lives in a vm context, so its
  // Array.prototype differs from ours and strict deep-equal would fail on that.
  assert.deepEqual([...mod.inject], ['slots', 'locale'])
  assert.equal(typeof mod.apply, 'function')
})

test('factory survives a bare require-only call (the exact DSH contract)', () => {
  const spec = captureLoadSpec()
  const react = fakeReact()
  // Reflect.apply with a single arg mimics a loader that ignores extra params.
  assert.doesNotThrow(() => Reflect.apply(spec.factory, undefined, [(n) => {
    if (n === 'react') return react
    throw new Error(`unexpected require(${JSON.stringify(n)})`)
  }]))
})

test('settings.section calls the useSessions hook at render time, not inside an effect', () => {
  const spec = captureLoadSpec()
  const react = fakeReact()
  const mod = spec.factory((n) => {
    if (n === 'react') return react
    throw new Error(`unexpected require(${JSON.stringify(n)})`)
  })

  // Fake slots + locale faces: enough for apply() to register and later render
  // the settings.section component once.
  const registrations = []
  const slots = {
    register: (meta, component) => {
      registrations.push({ meta, component })
      return () => {}
    },
    inject: (key, factory) => { factory() },
  }
  const locale = {
    register: () => {},
    bind: () => (key) => key,
  }

  let hookCallsDuringRender = 0
  const useSessions = (selector) => {
    hookCallsDuringRender += 1
    return selector({ byId: { 'session-a': { retainedBy: { mainView: 1 } } }, phase: 'ready' })
  }

  mod.apply({ slots, locale, effect: (fn) => { fn(); return () => {} } })

  // The store lives inside apply(); reach the real one through the shell
  // overlay entry's injected face (same object the settings.section seeds).
  const overlayEntry = registrations.find((r) => r.meta.name === 'shell.overlay')
  assert.ok(overlayEntry, 'shell overlay entry should be registered')
  const injected = overlayEntry.meta.inject()
  const realStore = injected.store
  assert.ok(realStore && typeof realStore.subscribe === 'function',
    'overlay inject() should expose the shared store')
  let seeded = null
  realStore.subscribe(() => { if (realStore.get().sessionId) seeded = realStore.get().sessionId })

  const settingsEntry = registrations.find((r) => r.meta.order === 30 && r.meta.id === 'dsh-skill-cards')
  assert.ok(settingsEntry, 'settings.section entry should be registered')
  const out = settingsEntry.component({ useSessions })
  assert.ok(out, 'settings.section component renders a tree')
  assert.equal(out.type, 'div')
  assert.ok(hookCallsDuringRender > 0,
    'useSessions must be invoked during the component render (top level), never inside an effect')
  assert.equal(seeded, 'session-a',
    'the retained mainView session should seed the store session id')
})

test('sidebar.footer.action is no longer registered (left-sidebar entry removed)', () => {
  const spec = captureLoadSpec()
  const react = fakeReact()
  const mod = spec.factory((n) => {
    if (n === 'react') return react
    throw new Error(`unexpected require(${JSON.stringify(n)})`)
  })
  const registrations = []
  const slots = {
    register: (meta, component) => { registrations.push({ meta, component }); return () => {} },
    inject: (key, factory) => { factory() },
  }
  const locale = { register: () => {}, bind: () => (key) => key }
  mod.apply({ slots, locale, effect: (fn) => { fn(); return () => {} } })
  assert.ok(!registrations.some((r) => r.meta.name === 'sidebar.footer.action'),
    'the sidebar footer action should not be registered')
})

test('conversation.input.right composer slot is registered', () => {
  const spec = captureLoadSpec()
  const react = fakeReact()
  const mod = spec.factory((n) => {
    if (n === 'react') return react
    throw new Error(`unexpected require(${JSON.stringify(n)})`)
  })
  const registrations = []
  const slots = {
    register: (meta, component) => { registrations.push({ meta, component }); return () => {} },
    inject: (key, factory) => { factory() },
  }
  const locale = { register: () => {}, bind: () => (key) => key }
  mod.apply({ slots, locale, effect: (fn) => { fn(); return () => {} } })
  const entry = registrations.find((r) => r.meta.name === 'conversation.input.right')
  assert.ok(entry, 'conversation.input.right entry should be registered')
  const out = entry.component({})
  assert.ok(out, 'composer entry renders a tree')
  // The element is created with createElement(AppliedSynced(ComposerButton), …):
  // the wrapper syncs `store.applied` (GET /applied) so the composer can render
  // revocable chips; unwrap it to reach the host-parity shape beneath.
  assert.equal(out.type.name, 'AppliedSynced', 'composer entry wraps ComposerButton with the applied-sync wrapper')
  // The wrapper also installs the one-shot composer watcher. It must tolerate a
  // DOM-less environment (no MutationObserver / no document) instead of throwing
  // during mount — mounting the wrapper is enough to exercise that.
  const inner = out.type(out.props)
  assert.equal(inner.type.name, 'ComposerButton', 'wrapper renders ComposerButton')
  const bare = inner.type(inner.props)
  // Idle composer entry is a `dsh-sc-composer` span holding the open button —
  // a span (not a bare button) so the applied chips can sit next to it.
  assert.equal(bare.type, 'span', 'idle composer entry is the composer span')
  assert.equal(bare.props.className, 'dsh-sc-composer')
  const btn = (Array.isArray(bare.children) ? bare.children : [bare.children]).filter(Boolean)[0]
  assert.equal(btn.type, 'button', 'the open button is the first child')
  assert.equal(btn.props.className, 'dsh-sc-composer-btn')
  assert.equal(btn.props.type, 'button')
})

test('settings.section renders the skills panel inline (not a modal button)', () => {
  const spec = captureLoadSpec()
  const react = fakeReact()
  const mod = spec.factory((n) => {
    if (n === 'react') return react
    throw new Error(`unexpected require(${JSON.stringify(n)})`)
  })
  const registrations = []
  const slots = {
    register: (meta, component) => { registrations.push({ meta, component }); return () => {} },
    inject: (key, factory) => { factory() },
  }
  const locale = { register: () => {}, bind: () => (key) => key }
  mod.apply({ slots, locale, effect: (fn) => { fn(); return () => {} } })

  const settingsEntry = registrations.find((r) => r.meta.order === 30 && r.meta.id === 'dsh-skill-cards')
  assert.ok(settingsEntry, 'settings.section entry should be registered')
  const out = settingsEntry.component({})
  assert.ok(out, 'settings.section renders a tree')
  // The inline panel renders a div.dsh-sc-root containing the SkillsPanel
  // component — not the old single-button modal opener.
  assert.equal(out.type, 'div', 'settings root should be a div')
  assert.equal(out.props.className, 'dsh-sc-root')
  assert.equal(out.children.length, 1, 'settings root should render the panel (the gacha reveal lives inside it)')
  const boundary = out.children[0]
  // The panel is wrapped in PanelBoundary so a render crash shows the message
  // inside the plugin instead of being swallowed by DSH's slot error boundary.
  assert.equal(boundary.type.name, 'PanelBoundary', 'settings panel is wrapped in the error boundary')
  const panelKids = (Array.isArray(boundary.children) ? boundary.children : [boundary.children]).filter(Boolean)
  const panel = panelKids[0]
  assert.equal(panel.type.name, 'SkillsPanel', 'settings should render the SkillsPanel')
  const panelDom = panel.type(panel.props)
  assert.equal(panelDom.type, 'div')
  assert.equal(panelDom.props.className, 'dsh-sc-panel')
})

test('3D card wall: client loads three.js from the plugin vendor route (no CDN)', () => {
  const source = readFileSync(clientPath, 'utf8')
  assert.match(source, /vendor\/three\.min\.js/, 'client must load three.js via the plugin vendor URL')
  assert.ok(
    !/https?:\/\/(unpkg|cdnjs|jsdelivr|cdn)\./.test(source),
    'three.js must be self-hosted by the plugin, never fetched from a third-party CDN',
  )
  assert.match(source, /ensureThree\(\)/, 'ensureThree loader helper must exist')
  assert.match(source, /window\.THREE/, 'ensureThree must read the THREE global from the script')
})

test('3D card wall: deterministic per-card jitter from the skill name', () => {
  const source = readFileSync(clientPath, 'utf8')
  assert.match(source, /function card3DJitter\(name\)/, 'card3DJitter helper must exist')
  // Same name → same pose across renders (no jump on re-open).
  const m = source.match(/function card3DJitter\(name\) \{([\s\S]*?)\n    \}/)
  assert.ok(m, 'card3DJitter body not found')
  assert.match(source, /2166136261/, 'jitter must hash deterministically (FNV-1a seed present)')
})

test('3D card wall: failure path keeps the flat grid usable', () => {
  const source = readFileSync(clientPath, 'utf8')
  // every failure must degrade to the default flat grid, never crash the panel
  assert.match(source, /\.catch\(\(\) =>/, 'ensureThree rejection must be caught')
  assert.match(source, /createParticleScene/, 'particle scene helper must exist')
  assert.match(source, /try\s*\{\s*scene = createParticleScene/, 'scene creation must be guarded')
  assert.match(source, /prefers-reduced-motion/, 'reduced-motion preference must be honoured')
  assert.match(source, /\.dispose\(\)/, '3D resources must be disposed on unmount')
})

/* ------------------------------------------------------------------ *
 * Performance regressions
 *
 * Each of these locks in a specific fix for a specific stall measured on a
 * ~95-card wall. They are cheap source assertions (this file already asserts on
 * source shape for the 3D wall), and they exist so a later edit cannot quietly
 * reintroduce the cost — e.g. by "simplifying" the rAF coalescing away.
 * ------------------------------------------------------------------ */

test('perf: card layers are promoted only while a card is moving', () => {
  const css = cssBlock()
  // A blanket will-change on the card keeps ~95 compositor texture layers alive
  // for the whole time the panel is open.
  assert.ok(
    !/\.dsh-sc-card\s*\{[^}]*will-change/.test(css),
    'cards must not be permanently promoted with will-change',
  )
  // Promotion must be scoped to the transient motion classes initCard3D toggles.
  assert.match(css, /\.dsh-sc-card\.tilting/, 'tilting cards should be layer-promoted')
  assert.match(css, /\.dsh-sc-card\.settling/, 'settling cards should be layer-promoted')
})

test('perf: hover tilt does not force layout per pointer event', () => {
  const source = readFileSync(clientPath, 'utf8')
  const body = source.slice(source.indexOf('function initCard3D'))
  const tiltBody = body.slice(body.indexOf('const tilt ='), body.indexOf('const leaveCard ='))
  // The rect must be measured ONCE, when the pointer enters a card — not on
  // every move. Reading it per event is a forced synchronous layout, the
  // classic tilt/scroll jank source.
  const enterGuard = tiltBody.slice(tiltBody.indexOf('if (card !== active)'))
  assert.match(
    enterGuard, /activeRect = card\.getBoundingClientRect\(\)/,
    'the card box should be measured once when the pointer enters that card',
  )
  // The per-frame write path must never measure.
  const applyBody = body.slice(body.indexOf('const applyTilt ='), body.indexOf('const tilt ='))
  assert.ok(
    !applyBody.includes('getBoundingClientRect'),
    'the rAF write path must not measure the rect (forced layout every frame)',
  )
  // Events must be coalesced into ONE rAF write per frame. Assert the guard, not
  // just the call: `raf = requestAnimationFrame(...)` without the `if (!raf)`
  // still contains the substring but coalesces nothing (it queues a new frame per
  // event, which is worse than the original).
  assert.match(
    tiltBody, /if \(!raf\) raf = requestAnimationFrame\(applyTilt\)/,
    'tilt writes must be guarded by if (!raf) so they coalesce into one write per frame',
  )
  // applyTilt must clear the handle, or the guard would never let a new frame in.
  const applyBody0 = body.slice(body.indexOf('const applyTilt ='), body.indexOf('const tilt ='))
  assert.match(applyBody0, /raf = 0/, 'applyTilt must release the rAF handle')
  // Membership test must not be a linear scan over every card.
  assert.ok(!tiltBody.includes('cards.includes'), 'use the Set, not a linear array scan')
  assert.match(source, /const cardSet = new Set\(cards\)/, 'a Set of cards should exist')
})

test('perf: hover settle timers are tracked and cleared on teardown', () => {
  const source = readFileSync(clientPath, 'utf8')
  const body = source.slice(source.indexOf('function initCard3D'))
  // A card re-entered mid-settle would have its live transition stripped by a
  // stale timer; an untracked timer also survives teardown.
  assert.match(body, /settleTimers/, 'settle timers must be tracked per card')
  assert.match(body, /for \(const id of settleTimers\.values\(\)\) clearTimeout\(id\)/,
    'every settle timer must be cleared on cleanup')
})

test('perf: the entrance is one CSS keyframe, not per-card inline transitions', () => {
  const css = cssBlock()
  assert.match(css, /\.dsh-sc-grid\.enter \.dsh-sc-card/, 'entrance should key off the grid container')
  assert.match(css, /@keyframes dshScCardIn/, 'entrance keyframes must exist')
  // Stagger via nth-child keeps the wave without a per-card animation-delay prop.
  assert.match(css, /nth-child\(n\+21\)/, 'the stagger should be quantised via nth-child')
})

test('perf: the foil sweep is paused at rest', () => {
  const css = cssBlock()
  // ~95 infinite CSS animations all running behind opacity:0.
  assert.match(css, /animation-play-state:paused/, 'the foil sweep must pause at rest')
  assert.match(css, /\.dsh-sc-gcard:hover \.gc-foil::before\s*\{\s*animation-play-state:running/, 'only the hovered card animates')
})

test('perf: the nebula throttles and suspends when it cannot be seen', () => {
  const source = readFileSync(clientPath, 'utf8')
  // MSAA on a blurred particle field buys nothing and costs a multisampled
  // framebuffer + resolve every frame.
  assert.match(source, /antialias: false/, 'the decorative nebula must not request MSAA')
  assert.match(source, /NEBULA_FRAME_MS/, 'the nebula should be frame-rate capped')
  assert.match(source, /IntersectionObserver/, 'the nebula should suspend when off screen')
  assert.match(source, /visibilitychange/, 'the nebula should suspend in a hidden tab')
  // Pointer tracking must be scoped + use a cached rect, not measure per event.
  const scene = source.slice(source.indexOf('function createParticleScene'))
  assert.ok(!/const onMove = \(ev\) => \{\s*const rect = parent\?\.getBoundingClientRect\(\)/.test(scene),
    'the nebula pointer handler must not measure the rect on every event')
})

test('perf: card theme props are memoised per category', () => {
  const source = readFileSync(clientPath, 'utf8')
  // ~12 colour mixes per card per render, ~95 cards.
  assert.match(source, /GC_STYLE_CACHE/, 'gcStyleProps must be memoised per category')
  const fn = source.slice(source.indexOf('function gcStyleProps'), source.indexOf('function buildGcStyleProps'))
  assert.match(fn, /GC_STYLE_CACHE\.get/, 'gcStyleProps must read from the cache')
  assert.match(fn, /GC_STYLE_CACHE\.set/, 'gcStyleProps must populate the cache')
})

test('perf: cards are memoised and their props are referentially stable', () => {
  const source = readFileSync(clientPath, 'utf8')
  assert.match(source, /React\.memo\(function Card/, 'Card must be wrapped in React.memo')
  // React.memo compares props by identity, so an inline arrow per render would
  // defeat it entirely — every card would re-render anyway.
  const grid = source.slice(source.indexOf("filtered.map((s) => e(Card,"))
  assert.ok(!/onSetImage: \(sk\)/.test(grid), 'card handlers must not be inline arrows')
  assert.ok(!/onStar: \(name\)/.test(grid), 'card handlers must not be inline arrows')
  for (const cb of ['openImageForm', 'openTranslate', 'openArtPrompt', 'runResetI18n', 'toggleStar', 'setCardCategory']) {
    assert.match(source, new RegExp(`const ${cb} = useCallback\\(`), `${cb} must be a stable useCallback`)
  }
})

test('perf: filtering is debounced so typing does not re-render per keystroke', () => {
  const source = readFileSync(clientPath, 'utf8')
  assert.match(source, /SEARCH_DEBOUNCE_MS/, 'a debounce interval must be defined')
  assert.match(source, /const \[debouncedQuery, setDebouncedQuery\]/, 'a debounced query state must exist')
  // The filter must run on the debounced value, not the raw keystroke value.
  const filter = source.slice(source.indexOf('const filtered = useMemo'), source.indexOf('const catCounts'))
  assert.match(filter, /debouncedQuery\.trim\(\)/, 'the filter must use the debounced query')
  // The input must stay bound to the RAW value so typing still feels instant.
  assert.match(source, /className: 'dsh-sc-search', value: query/, 'the input must stay bound to the raw query')
})

/** The inlined stylesheet between `const CSS = \`` and ensureStyle. */
function cssBlock() {
  const source = readFileSync(clientPath, 'utf8')
  const start = source.indexOf('const CSS = `')
  assert.ok(start !== -1, 'CSS template literal not found')
  return source.slice(start + 'const CSS = `'.length, source.indexOf('function ensureStyle'))
}

test('applying skills is one-shot: Enter revokes them, other keys do not', async () => {
  // Behavioural test for the composer watcher. The host exposes no "message
  // sent" event (its submit state machine is internal to
  // dsh-client-ui-conversation), so the client listens for Enter on the host's
  // own textbox marker. The host only clears the editor AFTER the turn is
  // accepted, so "draft went empty" is both late and unreliable — Enter is the
  // real intent signal.
  const listeners = []
  let revoked = null
  const sandboxDocument = {
    createElement: () => ({
      style: {}, setAttribute() {}, appendChild() {}, addEventListener() {},
      remove() {}, classList: { add() {}, remove() {} },
    }),
    head: { appendChild() {} },
    body: { appendChild() {} },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn, capture) => { listeners.push({ type, fn, capture }) },
    removeEventListener: () => {},
  }
  const spec = captureLoadSpecWithDocument(sandboxDocument, async (url, init) => {
    if (url.endsWith('/revoke')) {
      revoked = JSON.parse(init.body)
      return { ok: true, json: async () => ({ ok: true, results: [] }) }
    }
    if (url.endsWith('/applied')) return { ok: true, json: async () => ({ ok: true, skills: [] }) }
    if (url.endsWith('/active-session')) return { ok: true, json: async () => ({ ok: true, sessionId: 's1' }) }
    return { ok: true, json: async () => ({}) }
  })

  const react = fakeReact()
  const mod = spec.factory((n) => {
    if (n === 'react') return react
    throw new Error(`unexpected require(${JSON.stringify(n)})`)
  })
  const registrations = []
  const slots = {
    register: (meta, component) => { registrations.push({ meta, component }); return () => {} },
    inject: (key, factory) => { factory() },
  }
  const locale = { register: () => {}, bind: () => (key) => key }
  mod.apply({ slots, locale, effect: (fn) => { fn(); return () => {} } })

  const entry = registrations.find((r) => r.meta.name === 'conversation.input.right')
  const wrapper = entry.component({})
  wrapper.type(wrapper.props) // mounts: installs the keydown watcher

  const watcher = listeners.find((l) => l.type === 'keydown')
  assert.ok(watcher, 'the composer watcher must install a keydown listener')
  // Capture phase: the host's keymap stops propagation on Enter, so a
  // bubble-phase listener on document would never fire.
  assert.equal(watcher.capture, true, 'the keydown listener must be capture-phase')

  const enterOn = (opts = {}) => watcher.fn({
    key: opts.key ?? 'Enter',
    shiftKey: !!opts.shiftKey,
    isComposing: !!opts.isComposing,
    keyCode: opts.keyCode ?? 13,
    target: { closest: () => (opts.inComposer === false ? null : {}) },
  })

  // Nothing applied yet: Enter must not call the host at all.
  enterOn()
  await Promise.resolve()
  assert.equal(revoked, null, 'Enter with no applied skills must not revoke')

  // Apply a set, then submit. The panel writes through store.setApplied.
  const panelEntry = registrations.find((r) => r.meta.name === 'shell.overlay')
  assert.ok(panelEntry, 'overlay registered')
  // Reach the store the slots were given (the same object the panel uses).
  const store = entry.component({}).props.store

  // Keys that insert a newline or pick an IME candidate are not sends.
  enterOn({ shiftKey: true })
  enterOn({ isComposing: true })
  enterOn({ keyCode: 229 })
  enterOn({ inComposer: false })
  await Promise.resolve()
  assert.equal(revoked, null, 'shift/composition/foreign-target Enter must not revoke')

  store.setApplied(['alpha', 'beta'])
  enterOn()
  await new Promise((r) => setTimeout(r, 0))
  assert.ok(revoked, 'Enter must revoke the applied skills')
  assert.deepEqual(revoked.names, ['alpha', 'beta'], 'every applied skill is revoked')
  assert.equal(store.get().applied.length, 0, 'the chips must be cleared after a successful revoke')

  // ---- the host's primary button takes the SAME submit path ----
  // It calls keyboard.submit(mode, 'click'), so clicking it must revoke too.
  const clicker = listeners.find((l) => l.type === 'click')
  assert.ok(clicker, 'the composer watcher must install a click listener')
  assert.equal(clicker.capture, true, 'the click listener must be capture-phase')

  revoked = null
  store.setApplied(['gamma'])
  // The send and stop buttons share the same `primary` class; the stop button
  // must never revoke, because cancelling a turn is not a submit.
  clicker.fn({ target: { closest: () => ({ disabled: false, className: 'primary', getAttribute: () => '停止生成' }) } })
  await Promise.resolve()
  assert.equal(revoked, null, 'the stop button must not revoke')

  // A disabled button cannot submit (the host disables it for an empty draft).
  clicker.fn({ target: { closest: () => ({ disabled: true, className: 'primary', getAttribute: () => '发送消息' }) } })
  await Promise.resolve()
  assert.equal(revoked, null, 'a disabled button must not revoke')

  // A non-primary button elsewhere (e.g. an attachment chip) must not revoke.
  clicker.fn({ target: { closest: () => ({ disabled: false, className: 'chip', getAttribute: () => '移除附件' }) } })
  await Promise.resolve()
  assert.equal(revoked, null, 'an unrelated button must not revoke')

  clicker.fn({ target: { closest: () => ({ disabled: false, className: 'primary', getAttribute: () => '发送消息' }) } })
  await new Promise((r) => setTimeout(r, 0))
  assert.ok(revoked, 'the primary send button must revoke the applied skills')
  assert.deepEqual(revoked.names, ['gamma'], 'the clicked submit revokes the applied set')
  assert.equal(store.get().applied.length, 0, 'the chips must clear after a button submit')
})

test('one-shot revocation reuses POST /revoke and keeps state on failure', () => {
  const source = readFileSync(clientPath, 'utf8')
  assert.match(source, /api\('\/revoke'/, 'one-shot must reuse POST /revoke')
  // A failed revoke must leave the chips alone: claiming the skills are gone
  // when the host still holds them would be a lie.
  assert.match(source, /keep state; the chips stay accurate/,
    'a failed revoke must not clear the chips')
  // There must be no opt-in toggle: applying is always one-shot.
  assert.ok(!/oneShot|dsh-sc-oneshot/.test(source),
    'the one-shot toggle must not exist — the behaviour is unconditional')
})
