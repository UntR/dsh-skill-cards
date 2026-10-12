/**
 * Smoke tests for the host-side pure logic (no DSH runtime required).
 * Run: node --test test/smoke.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanRoot, readCover, userSkillRoots } from '../lib/skills-scan.js'
import { sameOrigin } from '../lib/http.js'

test('userSkillRoots covers the real-world skill locations', () => {
  const home = '/Users/someone/.dsh'
  const roots = userSkillRoots(home).map((r) => r.path)
  // ~/.agents/skills is where the agent CLI actually installs skills; an earlier
  // version only scanned ~/.dsh/skills (usually absent) and listed nothing.
  assert.ok(roots.includes('/Users/someone/.agents/skills'), 'missing ~/.agents/skills')
  assert.ok(roots.includes('/Users/someone/.claude/skills'), 'missing ~/.claude/skills')
  assert.ok(roots.includes('/Users/someone/.dsh/skills'), 'missing ~/.dsh/skills')
})

function makeSkill(root, name, description, withCover) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`)
  if (withCover) writeFileSync(join(dir, 'cover.png'), 'fake-png')
}

/** Write a SKILL.md with a raw frontmatter body, for parser edge cases. */
function makeRawSkill(root, name, frontmatterBody) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatterBody}\n---\n# ${name}\n`)
}

test('frontmatter supports YAML block scalars (|, |-, >)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sc-block-'))
  try {
    // Literal block: newlines preserved, trailing newline chomped by |-.
    makeRawSkill(root, 'lit', 'name: lit\ndescription: |-\n  First line.\n  Second line.')
    // Folded block: newlines become spaces.
    makeRawSkill(root, 'fold', 'name: fold\ndescription: >\n  Folded one\n  folded two.')
    // A following key must terminate the block.
    makeRawSkill(root, 'after', 'name: after\ndescription: |\n  Body text.\nlicense: MIT')
    const list = await scanRoot(root, 'test')
    const byName = Object.fromEntries(list.map((s) => [s.name, s.description]))
    // Before the fix these came out as the literal characters "|-" / ">".
    assert.equal(byName.lit, 'First line.\nSecond line.')
    assert.equal(byName.fold, 'Folded one folded two.')
    assert.equal(byName.after, 'Body text.')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('frontmatter keeps colons inside quoted values', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sc-quote-'))
  try {
    makeRawSkill(root, 'quoted', 'name: quoted\ndescription: "Use when: the user asks"')
    const [skill] = await scanRoot(root, 'test')
    assert.equal(skill.description, 'Use when: the user asks')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('frontmatter tolerates a missing or malformed block', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sc-nofm-'))
  try {
    const dir = join(root, 'bare')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '# No frontmatter at all\n')
    // Falls back to the directory name with an empty description, not a throw.
    const [skill] = await scanRoot(root, 'test')
    assert.equal(skill.name, 'bare')
    assert.equal(skill.description, '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('scanRoot discovers directory skills and parses frontmatter', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sc-test-'))
  try {
    makeSkill(root, 'pdf-helper', '处理 PDF', false)
    makeSkill(root, 'image-gen', '生成图片', true)
    const list = await scanRoot(root, 'test')
    const names = list.map((s) => s.name).sort()
    assert.deepEqual(names, ['image-gen', 'pdf-helper'])
    const pdf = list.find((s) => s.name === 'pdf-helper')
    assert.equal(pdf.description, '处理 PDF')
    const img = list.find((s) => s.name === 'image-gen')
    assert.equal(img.hasCover, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('scanRoot ignores a directory without SKILL.md', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sc-test-'))
  try {
    mkdirSync(join(root, 'not-a-skill'), { recursive: true })
    writeFileSync(join(root, 'not-a-skill', 'readme.txt'), 'hi')
    const list = await scanRoot(root, 'test')
    assert.equal(list.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('readCover returns the cover buffer when present', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sc-test-'))
  try {
    makeSkill(root, 'with-cover', 'desc', true)
    const list = await scanRoot(root, 'test')
    const cover = await readCover(list[0].rootDir, list[0].skillFile)
    assert.ok(cover && cover.mime === 'image/png' && cover.buffer.length > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sameOrigin admits loopback (desktop shell is cross-origin but local)', () => {
  // The desktop renderer runs on dsh-app:// and may send Origin: null or a
  // cross-site marker. Loopback must still be admitted or the app breaks.
  assert.equal(sameOrigin({ headers: { host: 'localhost:3080' } }), null)
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:19387', origin: 'null' } }), null)
  assert.equal(
    sameOrigin({ headers: { host: '127.0.0.1:19387', 'sec-fetch-site': 'cross-site' } }),
    null,
  )
})

test('sameOrigin rejects cross-site requests aimed at a remote host', () => {
  assert.equal(
    sameOrigin({ headers: { host: 'example.com', 'sec-fetch-site': 'cross-site' } }),
    'cross-site request rejected',
  )
  assert.equal(sameOrigin({ headers: { host: 'example.com' } }), 'untrusted host')
  assert.equal(
    sameOrigin({ headers: { host: 'example.com', origin: 'https://evil.test' } }),
    'origin does not match host',
  )
})
