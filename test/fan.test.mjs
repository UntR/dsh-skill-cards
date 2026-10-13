import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

// The client is a classic script, so exercise its real functions without
// introducing a browser or a second implementation of the layout algorithm.
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} must exist`)
  const end = source.indexOf('\n    }', start)
  return source.slice(start, end + '\n    }'.length)
}

const { fanMetrics, fanPose, captureCardRects } = runInNewContext(`
  ${functionSource('fanMetrics')}
  ${functionSource('fanPose')}
  ${functionSource('captureCardRects')}
  ({ fanMetrics, fanPose, captureCardRects })
`)

function transformParts(pose) {
  const numbers = pose.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) rotate\(([-\d.]+)deg\) scale\(([-\d.]+)\)/)
  assert.ok(numbers, 'the pose must use a composited translation, rotation and scale')
  return { x: Number(numbers[1]), y: Number(numbers[2]), angle: Number(numbers[3]), scale: Number(numbers[4]) }
}

// Transform the rectangle's four corners using the actual CSS origin and top
// inset. This independently catches bounds errors in the sizing helper.
function cardCorners(width, metrics, pose) {
  const slotRule = source.match(/\.dsh-sc-fan-slot \{([^}]+)\}/)[1]
  const top = Number(slotRule.match(/top:([\d.]+)px/)[1])
  assert.match(slotRule, /transform-origin:50% 100%/)
  const { x, y, angle, scale } = transformParts(pose)
  const radians = angle * Math.PI / 180
  return [-metrics.cardWidth / 2, metrics.cardWidth / 2].flatMap((cx) =>
    [-metrics.cardHeight, 0].map((cy) => ({
      x: width / 2 + x + scale * (cx * Math.cos(radians) - cy * Math.sin(radians)),
      y: top + metrics.cardHeight + y + scale * (cx * Math.sin(radians) + cy * Math.cos(radians)),
    })))
}

test('fan poses keep the current card largest and above symmetric neighbours', () => {
  for (const width of [280, 560, 1024]) {
    const metrics = fanMetrics(width, 900)
    const center = fanPose(0, metrics)
    const centerTransform = transformParts(center)
    assert.equal(centerTransform.x, 0)
    assert.equal(centerTransform.angle, 0)
    assert.equal(centerTransform.scale, 1)
    let previousScale = centerTransform.scale
    let previousLayer = center.zIndex
    for (let distance = 1; distance <= metrics.radius; distance++) {
      const left = fanPose(-distance, metrics)
      const right = fanPose(distance, metrics)
      const l = transformParts(left)
      const r = transformParts(right)
      assert.equal(l.x, -r.x)
      assert.equal(l.y, r.y)
      assert.equal(l.angle, -r.angle)
      assert.equal(l.scale, r.scale)
      assert.equal(left.zIndex, right.zIndex)
      assert.ok(r.scale < previousScale, 'each further card must be smaller')
      assert.ok(right.zIndex < previousLayer, 'each further card must be behind its neighbour')
      assert.ok(r.scale > 0 && r.x > 0, 'side cards must remain visible and separated')
      previousScale = r.scale
      previousLayer = right.zIndex
    }
  }
})

test('every visible card stays inside the hand across narrow, wide and short windows', () => {
  for (const width of [240, 320, 539, 540, 799, 800, 1024, 1600]) {
    for (const height of [360, 600, 900, 1200]) {
      const metrics = fanMetrics(width, height)
      assert.ok(metrics.cardWidth > 0 && metrics.cardHeight > 0)
      for (let offset = -metrics.radius; offset <= metrics.radius; offset++) {
        for (const corner of cardCorners(width, metrics, fanPose(offset, metrics))) {
          const context = `${width}×${height}, offset ${offset}: ${JSON.stringify(corner)}`
          assert.ok(corner.x >= 0 && corner.x <= width, `horizontal overflow: ${context}`)
          assert.ok(corner.y >= 0 && corner.y <= metrics.height, `vertical overflow: ${context}; hand height ${metrics.height}`)
        }
      }
    }
  }
})

test('available stage height shrinks cards to leave room for details without making short-window cards unreadable', () => {
  const roomy = fanMetrics(1000, 1200, 900)
  const compact = fanMetrics(1000, 1200, 650)
  const shorter = fanMetrics(1000, 1200, 540)
  assert.ok(roomy.cardHeight > compact.cardHeight && compact.cardHeight > shorter.cardHeight,
    'the actual stage height must affect card size even when viewport size is unchanged')
  for (const width of [560, 1000]) {
    for (const available of [540, 650, 900]) {
      const metrics = fanMetrics(width, 1200, available)
      assert.ok(available - metrics.height >= 180,
        `${width}px stage with ${available}px height must leave a useful area below the fan`)
      assert.ok(metrics.cardHeight >= 200, 'height-constrained cards must retain a readable minimum')
    }
    const small = fanMetrics(width, 360, 300)
    const tiny = fanMetrics(width, 240, 200)
    assert.ok(Math.abs(small.cardHeight - 200) < 1e-8)
    assert.equal(tiny.cardHeight, small.cardHeight, 'shorter windows must scroll instead of continuously shrinking cards')
    assert.ok(tiny.height > 200, 'the minimum card and its fan may exceed a tiny stage and require scrolling')
  }
})

function descendants(node) {
  if (!node || typeof node !== 'object') return []
  return [node, ...(node.children || []).flatMap(descendants)]
}

function byClass(tree, name) {
  return descendants(tree).filter((node) => node.props?.className?.split(' ').includes(name))
}

// A small hook runner renders CardFan itself, preserving state, effect cleanup
// and refs across user actions. Cards remain opaque so this tests the fan's
// integration contract rather than recreating the entire host application.
function mountFan(skills, { width = 1000, height = 900, selected = new Set() } = {}) {
  const hooks = []
  const effects = []
  const timers = new Map()
  const events = new Map()
  let cursor = 0
  let timerId = 0
  let dirty = false
  let tree
  let props
  const toggled = []
  const Card = function Card() {}
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const scope = {
    Card,
    e: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((item) => item != null && item !== false) }),
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [hooks[index], (next) => {
        const value = typeof next === 'function' ? next(hooks[index]) : next
        if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true }
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    useCallback(fn, deps) {
      const index = cursor++
      if (!sameDeps(hooks[index]?.deps, deps)) hooks[index] = { fn, deps }
      return hooks[index].fn
    },
    useEffect(fn, deps) {
      const index = cursor++
      if (sameDeps(hooks[index]?.deps, deps)) return
      effects.push(() => {
        hooks[index]?.cleanup?.()
        hooks[index] = { deps, cleanup: fn() }
      })
    },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id },
    clearTimeout(id) { timers.delete(id) },
    window: {
      innerHeight: height,
      addEventListener(type, fn) { events.set(type, fn) },
      removeEventListener(type) { events.delete(type) },
    },
  }
  const CardFan = runInNewContext(`
    ${functionSource('fanMetrics')}
    ${functionSource('fanPose')}
    ${functionSource('CardFan')}
    CardFan
  `, scope)
  props = {
    skills, selected, t: (key) => key, catDefs: {},
    onToggle: (name) => { toggled.push(name); selected.has(name) ? selected.delete(name) : selected.add(name) },
    onStar() {}, onSetImage() {},
  }
  function render(next = {}) {
    props = { ...props, ...next }
    for (let attempt = 0; attempt < 12; attempt++) {
      dirty = false
      cursor = 0
      tree = CardFan(props)
      for (const node of descendants(tree)) {
        if (node.props.ref && !node.props.ref.current) node.props.ref.current = { get clientWidth() { return width } }
      }
      while (effects.length) effects.shift()()
      if (!dirty) return tree
    }
    throw new Error('CardFan effects did not settle')
  }
  render()
  return {
    get tree() { return tree },
    get slots() { return byClass(tree, 'dsh-sc-fan-slot') },
    get current() { return byClass(tree, 'is-current')[0]?.children[0].props.skill.name },
    get nav() { return byClass(tree, 'dsh-sc-fan-nav')[0]?.children.filter((node) => node.type === 'button') },
    get details() { return byClass(tree, 'dsh-sc-details-actions')[0]?.children },
    toggled, selected, render,
    settle() { for (const [id, fn] of [...timers]) { timers.delete(id); fn() } return render() },
    resize(nextWidth, nextHeight) { width = nextWidth; scope.window.innerHeight = nextHeight; events.get('resize')?.(); return render() },
    clickCard(name) {
      const card = this.slots.map((slot) => slot.children[0]).find((card) => card.props.skill.name === name)
      assert.ok(card, `${name} must be mounted to click it`)
      card.props.onToggle(name)
      return render()
    },
    step(delta) { this.nav[delta < 0 ? 0 : 1].props.onClick(); return render() },
  }
}

const skills = (count) => Array.from({ length: count }, (_, index) => ({ name: `skill-${index}`, description: `description ${index}` }))

test('the fan bounds mounted cards and makes transparent buffers noninteractive', () => {
  const list = skills(95)
  const fan = mountFan(list)
  for (let i = 0; i < 40; i++) fan.step(1)
  for (const width of [320, 600, 1000]) {
    fan.resize(width, 900)
    assert.ok(fan.slots.length <= 9, 'large libraries must not mount the whole collection')
    const visible = fan.slots.filter((slot) => slot.props.style.opacity > 0)
    assert.ok(visible.length <= 7)
    for (const slot of fan.slots.filter((slot) => slot.props.style.opacity === 0)) {
      assert.equal(slot.props['aria-hidden'], 'true')
      assert.equal(slot.props.inert, '')
      assert.equal(slot.props.style.pointerEvents, 'none')
    }
    fan.settle()
    const enabled = fan.slots.filter((slot) => slot.children[0].props.interactive)
    assert.equal(enabled.length, 1, 'only the stable center may open card popovers')
    assert.equal(enabled[0].children[0].props.skill.name, fan.current)
  }
})

test('first and last cards clamp navigation, including a single-card result', () => {
  const fan = mountFan(skills(3))
  assert.equal(fan.current, 'skill-0')
  assert.equal(fan.nav[0].props.disabled, true)
  fan.step(-1)
  assert.equal(fan.current, 'skill-0')
  fan.step(1)
  fan.step(1)
  assert.equal(fan.current, 'skill-2')
  assert.equal(fan.nav[1].props.disabled, true)
  fan.step(1)
  assert.equal(fan.current, 'skill-2')
  fan.render({ skills: [skills(3)[1]] })
  assert.equal(fan.current, 'skill-1')
  assert.ok(fan.nav.every((button) => button.props.disabled))
  fan.render({ skills: [] })
  assert.equal(fan.tree, null)
  fan.render({ skills: skills(2) })
  assert.equal(fan.current, 'skill-0')
})

test('reordering retains the browsed skill while filtering safely chooses a remaining card', () => {
  const list = skills(5)
  const fan = mountFan(list)
  fan.clickCard('skill-2')
  fan.render({ skills: [...list].reverse() })
  assert.equal(fan.current, 'skill-2', 'sort changes should preserve identity')
  fan.render({ skills: [list[4], list[1]] })
  assert.equal(fan.current, 'skill-4', 'a removed current card should fall back within the results')
  assert.equal(fan.nav[0].props.disabled, true)
  assert.deepEqual(fan.toggled, [], 'filtering and sorting are browsing, not selection')
})

test('browsing leaves business multi-selection intact and details target the current card', () => {
  const selected = new Set(['skill-0', 'skill-90'])
  const fan = mountFan(skills(95), { selected })
  fan.clickCard('skill-2')
  fan.step(1)
  assert.equal(fan.current, 'skill-3')
  assert.deepEqual([...selected], ['skill-0', 'skill-90'])
  assert.deepEqual(fan.toggled, [])
  fan.details[0].props.onClick()
  fan.render()
  assert.deepEqual(fan.toggled, ['skill-3'])
  assert.ok(selected.has('skill-3'))
  assert.ok(selected.has('skill-90'), 'an unmounted selected skill must remain selected')
  fan.clickCard('skill-3')
  assert.ok(!selected.has('skill-3'), 'clicking the central face retains the existing toggle action')
  const current = fan.slots.find((slot) => slot.children[0].props.skill.name === 'skill-3')
  assert.equal(current.children[0].props.selected, false)
})

test('horizontal touch swipes browse once without toggling, while vertical gestures do not browse', () => {
  const fan = mountFan(skills(10))
  const target = { closest: () => null }
  let hand = byClass(fan.tree, 'dsh-sc-fan-hand')[0]
  hand.props.onPointerDown({ pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: 180, clientY: 100, target })
  hand.props.onPointerUp({ pointerId: 1, clientX: 80, clientY: 110 })
  fan.render()
  assert.equal(fan.current, 'skill-1')
  assert.deepEqual(fan.toggled, [])
  let prevented = false
  let stopped = false
  hand = byClass(fan.tree, 'dsh-sc-fan-hand')[0]
  hand.props.onClickCapture({ preventDefault() { prevented = true }, stopPropagation() { stopped = true } })
  assert.ok(prevented && stopped, 'the synthetic click following a swipe must be swallowed')
  hand.props.onPointerDown({ pointerType: 'touch', isPrimary: true, pointerId: 2, clientX: 180, clientY: 100, target })
  hand.props.onPointerUp({ pointerId: 2, clientX: 130, clientY: 250 })
  fan.render()
  assert.equal(fan.current, 'skill-1')
})

test('reveal captures mounted cards and uses the center for unmounted selected skills', () => {
  const visibleRect = { left: 25, top: 40, width: 160, height: 233 }
  const centerRect = { left: 400, top: 20, width: 260, height: 379 }
  const grid = {
    querySelector(selector) {
      if (selector === '.dsh-sc-card[data-name="visible"]') return { getBoundingClientRect: () => visibleRect }
      if (selector === '.dsh-sc-fan-slot.is-current .dsh-sc-card') return { getBoundingClientRect: () => centerRect }
      return null
    },
  }
  const result = captureCardRects(grid, ['visible', 'outside', 'third', 'fourth', 'fifth', 'sixth', 'seventh'])
  assert.equal(result.length, 6, 'preserve the existing reveal cap')
  assert.deepEqual(Array.from(result, (card) => card.name), ['visible', 'outside', 'third', 'fourth', 'fifth', 'sixth'])
  assert.deepEqual({ ...result[0] }, { name: 'visible', x: 25, y: 40, w: 160, h: 233 })
  assert.deepEqual({ ...result[1] }, { name: 'outside', x: 400, y: 20, w: 260, h: 379 })
  assert.equal(captureCardRects(null, ['outside']).length, 0)
  assert.equal(captureCardRects(grid, []).length, 0)
  assert.equal(captureCardRects({ querySelector: () => null }, ['outside']).length, 0)
})
