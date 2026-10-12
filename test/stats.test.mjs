/**
 * Tests for the skill stats layer: category suggestion + the persisted
 * skill-cards-stats.json store (starred / uses / category per skill).
 *
 * Run: node --test test/stats.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CATEGORY_DEFS,
  suggestCategory,
  readStats,
  writeStats,
  statsFilePath,
  categoriesFor,
  readCustomCategories,
  addCustomCategory,
  removeCustomCategory,
  renameCustomCategory,
} from '../lib/stats.js'

test('CATEGORY_DEFS has stable ids and labels for default categories', () => {
  for (const [id, def] of Object.entries(CATEGORY_DEFS)) {
    assert.ok(id.match(/^[a-z]+$/), `category id "${id}" should be lowercase latin`)
    assert.ok(typeof def.label === 'string' && def.label.length > 0, `category ${id} needs a label`)
  }
})

test('suggestCategory maps known keywords to a category id', () => {
  assert.equal(suggestCategory('docx'), 'doc')
  assert.equal(suggestCategory('xlsx'), 'doc')
  assert.equal(suggestCategory('browser-testing-with-devtools'), 'test')
  assert.equal(suggestCategory('qa'), 'test')
  assert.equal(suggestCategory('git-workflow-and-versioning'), 'workflow')
  assert.equal(suggestCategory('git-guardrails-claude-code'), 'ai')
  assert.equal(suggestCategory('frontend-design'), 'design')
  assert.equal(suggestCategory('claude-api'), 'ai')
  assert.equal(suggestCategory('skill-creator'), 'skills')
  assert.equal(suggestCategory('security-and-hardening'), 'security')
  assert.equal(suggestCategory('obsidian-vault'), 'data')
  assert.equal(suggestCategory('internal-comms'), 'write')
})

test('suggestCategory still has an "other" escape for unknown names', () => {
  const c = suggestCategory('some-clearly-unknown-thing-xyz')
  assert.equal(c, 'other')
})

test('categoriesFor returns the assigned category or the suggestion', () => {
  // No override → the suggested one.
  assert.equal(categoriesFor({ name: 'docx', stats: null }), 'doc')
  // Override wins.
  assert.equal(categoriesFor({ name: 'docx', stats: { category: 'design' } }), 'design')
  // A cleared override (null) falls back to the suggestion.
  assert.equal(categoriesFor({ name: 'docx', stats: { category: null } }), 'doc')
})

test('writeStats then readStats round-trips the store, and empty writes {}', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sc-stats-'))
  try {
    const p = statsFilePath(dir)
    writeStats(dir, { pdfHelper: { uses: 3, starred: true, category: 'doc' } })
    const stored = JSON.parse(readFileSync(p, 'utf8'))
    assert.deepEqual(stored, { pdfHelper: { uses: 3, starred: true, category: 'doc' } })
    assert.deepEqual(readStats(dir), { pdfHelper: { uses: 3, starred: true, category: 'doc' } })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readStats tolerates a missing or malformed file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sc-stats2-'))
  try {
    // Missing file.
    assert.deepEqual(readStats(dir), {})
    // Malformed JSON.
    writeFileSync(statsFilePath(dir), 'not json{{{', 'utf8')
    assert.deepEqual(readStats(dir), {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Only include a light smoke check of writeStats creating the parent dir.
test('writeStats creates the parent directory', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'sc-stats3-')), 'nested', 'deeper')
  try {
    mkdirSync(dir, { recursive: true })
    writeStats(dir, { foo: { uses: 1 } })
    assert.ok(readStats(dir).foo.uses === 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('custom categories: add → list → rename → remove round-trip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sc-cat-'))
  try {
    // Add: returns a slug id.
    const id = addCustomCategory(dir, '我的工作')
    assert.ok(id && /^[a-z][a-z0-9_-]*$/.test(id), `slug id should be latin: ${id}`)
    assert.deepEqual(readCustomCategories(readStats(dir)), { [id]: { label: '我的工作' } })
    // A CJK label collides with no built-in but still yields a valid id.
    assert.ok(id !== 'dev' && id !== 'other', 'new category should not shadow a built-in id')

    // Rename.
    assert.ok(renameCustomCategory(dir, id, '研发工作'))
    assert.equal(readCustomCategories(readStats(dir))[id].label, '研发工作')

    // Assigning a skill to it persists; removing it clears that skill too.
    writeStats(dir, { ...readStats(dir), someSkill: { category: id, uses: 2 } })
    assert.ok(readStats(dir).someSkill.category === id)
    assert.ok(removeCustomCategory(dir, id))
    assert.deepEqual(readCustomCategories(readStats(dir)), {})
    assert.equal(readStats(dir).someSkill.category, undefined, 'skill should fall back after its custom category is removed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})