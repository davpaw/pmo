import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildRepositoryState } from './repository-state.js'
const project = JSON.parse(readFileSync(new URL('../../data/project.json', import.meta.url)))
const plan = { workstreams: [{ epics: [{ steps: [{ id: '1.1.1', status: 'complete' }, { id: '1.1.2', status: 'roadmap' }, { id: '1.1.3', status: 'incomplete' }] }] }] }
const runFixture = ({ unavailable = false, mergedFailure = false } = {}) => {
  const calls = []
  const refs = ['refs/heads/step/1.1.1-done\t[1.1.1] done', 'refs/heads/step/1.1.2-work\t[1.1.2] pending', 'refs/remotes/origin/step/1.1.2-work\t[1.1.2] old', 'refs/heads/step/1.1.3-finished\t[1.1.3] finished', 'refs/heads/step/9.9.9-unplanned\tnew', 'refs/heads/main\tmain', 'refs/remotes/origin/HEAD\tmain']
  const run = args => {
    calls.push(args)
    if (args[0] === 'show') { if (unavailable) throw Error('missing'); return JSON.stringify(plan) }
    if (args.includes('--abbrev-ref')) return 'plan/working'
    if (args.includes('--short')) return 'abc1234'
    if (args[0] === 'rev-parse') return 'a'.repeat(40)
    if (args[0] === 'status') return ''
    if (args[0] === 'rev-list') return '123'
    if (args.some(a => a.startsWith('--merged='))) return mergedFailure ? null : ['refs/remotes/origin/step/1.1.2-work', 'refs/heads/step/1.1.3-finished'].join('\n')
    if (args[0] === 'for-each-ref') return refs.join('\n')
    throw Error('unexpected command')
  }
  return { run, calls }
}
test('checkout facts distinguish completed, merged, active and unknown claims while deduplicating refs', () => {
  const { run, calls } = runFixture()
  const snapshot = buildRepositoryState({ root: '.', project, run, now: () => '2026-11-03T15:00:00Z' })
  assert.equal(snapshot.branch, 'plan/working')
  assert.equal(snapshot.clean, true)
  assert.equal(snapshot.mainRef, 'origin/main')
  const byId = new Map(snapshot.branches.map(b => [b.stepId, b]))
  assert.equal(byId.get('1.1.1').active, false)
  assert.equal(byId.get('1.1.2').active, true, 'unmerged local work survives a merged remote copy')
  assert.equal(byId.get('1.1.3').active, false)
  assert.equal(byId.get('9.9.9').active, null)
  assert.equal(snapshot.branches.filter(b => b.stepId === '1.1.2').length, 1)
  assert.ok(!snapshot.branches.some(b => b.name === 'HEAD'))
  assert.ok(calls.every(args => ['rev-parse', 'show', 'for-each-ref', 'status', 'rev-list'].includes(args[0])))
})
test('unavailable canonical plan or merge metadata never labels unknown branches as active', () => {
  for (const options of [{ unavailable: true }, { mergedFailure: true }]) {
    const { run } = runFixture(options)
    const snapshot = buildRepositoryState({ root: '.', project, run })
    assert.ok(snapshot.branches.filter(b => b.kind === 'step').every(b => b.active === null))
  }
})
