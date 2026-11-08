import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fixture } from './entities.test.js'
import { createEntityClient, validateEntitySnapshot, validateEntityGovernance, entityEvidenceLink, fieldPresence } from './entities.js'

const snapshot = () => ({ ...fixture(), identity: 'b'.repeat(64), generatedAt: '2026-11-07T12:00:00.000Z', warnings: [], stale: false })
test('dated static fallback is bounded, explicitly non-live, and never replaces valid refresh results', async () => {
  const calls = []
  const client = createEntityClient({ fetchImpl: async (path, options) => { calls.push([path, options.method]); return { ok: path === '/data/entities.json', json: async () => snapshot() } } })
  await client.load()
  assert.equal(client.state.snapshot.mode, 'static')
  assert.equal(client.state.snapshot.generatedAt, '2026-11-07T12:00:00.000Z')
  assert.equal(fieldPresence(client.state.snapshot, client.state.snapshot.entities[0], 'pronouns'), 'unknown')
  await assert.rejects(client.load(true))
  assert.equal(calls.filter(([path]) => path === '/data/entities.json').length, 1)
  assert.equal(client.state.snapshot.stale, true)
})
test('undated or private/unknown fallback fails closed', async () => {
  for (const change of [s => { delete s.generatedAt }, s => { s.rows = ['ROW_CANARY'] }, s => { s.entities[0].fields[0].default = 'VALUE_CANARY' }, s => { s.warnings = ['private@example.invalid'] }, s => { s.entities[0].stale = 'secret=CANARY' }]) {
    const s = snapshot(); change(s)
    const client = createEntityClient({ fetchImpl: async path => ({ ok: path === '/data/entities.json', json: async () => s }) })
    await assert.rejects(client.load()); assert.equal(client.state.snapshot, null)
  }
})
test('governance uses closed dated status projection, not host review bodies', () => {
  const g = { version: 1, generatedAt: '2026-11-07T12:00:00.000Z', mode: 'local', deployment: 'unverified', declarations: [{ entityId: 'person:import', status: 'stale-base' }] }
  assert.deepEqual(validateEntityGovernance(g), g)
  assert.deepEqual(validateEntitySnapshot({ ...snapshot(), governance: g }).governance, g)
  for (const change of [v => { v.review = { rows: ['CANARY'] } }, v => { v.declarations[0].status = 'secret=CANARY' }, v => { v.mode = 'live' }, v => { v.generatedAt = 'today' }]) { const v = structuredClone(g); change(v); assert.throws(() => validateEntityGovernance(v)) }
})
test('citations link only safe verified immutable repository source and ranges', () => {
  const e = { ...fixture().entities[0].evidence[0], revision: 'a'.repeat(40), verifiedRevision: true }
  assert.equal(entityEvidenceLink('example/project', e), `https://github.com/example/project/blob/${e.revision}/src/person.js#L1-L1`)
  for (const change of [v => { v.verifiedRevision = false }, v => { v.path = '../secrets.json' }, v => { v.revision = 'main' }, v => { v.line = 0 }]) { const v = { ...e }; change(v); assert.equal(entityEvidenceLink('example/project', v), null) }
  assert.equal(entityEvidenceLink('javascript:alert(1)', e), null)
})
test('browser exposes source links, relationship table and focus restoration hooks', () => {
  const code = readFileSync(new URL('./entities/viewer.jsx', import.meta.url), 'utf8')
  assert.match(code, /search.current\?\.focus/)
  assert.match(code, /inspector.current\?\.focus/)
  assert.match(code, /Declared relationships, not inferred joins/)
  assert.match(code, /DATED STATIC artifact; no local scan/)
  assert.match(code, /rel="noopener noreferrer"/)
})