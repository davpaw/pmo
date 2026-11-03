import test from 'node:test'
import assert from 'node:assert/strict'
import { planRevision, snapshotState, factsForStep, canonicalStartCheck } from './snapshot.js'
import { parseRoute } from './views.js'

test('only fresh facts for this served plan and requested step can grant eligibility', () => {
  const plan = { workstreams: [] }; const now = Date.now()
  const live = { generatedAt: new Date(now).toISOString(), planRevision: planRevision(plan), stepId: '6.1.21', facts: { git: { clean: false, claims: [], canonical: { ok: true, detail: 'checked' } }, env: { node: '24.0.0', nodeModules: true, missingKeys: [], portsInUse: [] } } }
  assert.equal(snapshotState(null, plan, now).state, 'unavailable')
  assert.equal(snapshotState({ ...live, generatedAt: 'bad' }, plan, now).state, 'stale')
  assert.equal(snapshotState(live, plan, now + 61000).state, 'stale')
  assert.equal(snapshotState(live, { ...plan, changed: true }, now).state, 'mismatch')
  assert.equal(snapshotState(live, plan, now).state, 'current')
  assert.equal(snapshotState(live, plan, now, { modules: [] }).state, 'mismatch')
  assert.equal(factsForStep({ live, plan }, '6.1.21'), live.facts)
  assert.equal(factsForStep({ live, plan }, '6.1.20'), undefined)
  assert.equal(factsForStep({ live: { ...live, facts: {} }, plan }, '6.1.21'), undefined)
})
test('malformed URL encoding is recoverable', () => {
  assert.deepEqual(parseRoute('#/steps/%ZZ'), { name: 'invalid' })
  assert.deepEqual(parseRoute('#/modules/%E0%A4%A'), { name: 'invalid' })
})


test('local prerequisite completion cannot replace canonical readiness', () => {
  const plan = (status) => ({ workstreams: [{ id: '1', epics: [{ id: '1.1', steps: [
    { id: '1.1.1', status }, { id: '1.1.2', status: 'roadmap', dependsOn: ['1.1.1'] },
  ] }] }] })
  assert.equal(canonicalStartCheck(plan('roadmap'), '1.1.2').ok, false)
  assert.equal(canonicalStartCheck(plan('complete'), '1.1.2').ok, true)
  assert.equal(canonicalStartCheck(plan('complete'), '1.1.1').ok, false)
  assert.equal(canonicalStartCheck(null, '1.1.2').ok, false)
})
