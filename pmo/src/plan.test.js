import test from 'node:test'
import assert from 'node:assert/strict'
import { branchNameFor, decisionScore, indexPlan, nextSteps, rankOpenSteps, readiness, rollup, slugify, transitiveDependents } from './plan.js'

const open = (id, overrides = {}) => ({
  id, title: `Step ${id}`, summary: 's', status: 'incomplete', modules: ['alpha'],
  effort: { size: 'M' }, risk: { level: 'low', notes: 'n' }, value: { score: 3, why: 'w' }, acceptance: ['a'], ...overrides,
})
const done = (id) => ({ id, title: `Done ${id}`, summary: 's', status: 'complete', modules: ['alpha'], evidence: ['x'] })
const plan = {
  workstreams: [{ id: '1', title: 'W', summary: 's', epics: [{ id: '1.1', title: 'E', summary: 's', steps: [
    done('1.1.1'),
    open('1.1.2', { dependsOn: ['1.1.1'], effort: { size: 'XS' }, value: { score: 5, why: 'w' } }),
    open('1.1.3', { dependsOn: ['1.1.2'], effort: { size: 'XL' }, risk: { level: 'high', notes: 'n' }, value: { score: 5, why: 'w' }, status: 'roadmap' }),
    open('1.1.4', { effort: { size: 'S' }, value: { score: 2, why: 'w' }, modules: ['beta'], scope: { crossModuleReason: 'x' } }),
  ] }] }],
}
const index = indexPlan(plan)

test('decision score is value per effort point, discounted by risk', () => {
  assert.equal(decisionScore(plan.workstreams[0].epics[0].steps[1]), 50)
  assert.equal(decisionScore(plan.workstreams[0].epics[0].steps[2]), 3.8)
  assert.equal(decisionScore(plan.workstreams[0].epics[0].steps[0]), null)
})

test('readiness reports unfinished and unknown prerequisites', () => {
  assert.equal(readiness(index, '1.1.2').ready, true)
  const blocked = readiness(index, '1.1.3')
  assert.equal(blocked.ready, false)
  assert.deepEqual(blocked.blockers.map((b) => b.id), ['1.1.2'])
  assert.equal(readiness(index, '9.9.9').exists, false)
  assert.equal(readiness(index, '1.1.1').ready, false, 'a complete step cannot be started')
})

test('ranking hides blocked work by default and orders by score', () => {
  assert.deepEqual(rankOpenSteps(index).map((r) => r.id), ['1.1.2', '1.1.4'])
  assert.deepEqual(rankOpenSteps(index, { includeBlocked: true }).map((r) => r.id), ['1.1.2', '1.1.4', '1.1.3'])
  assert.deepEqual(rankOpenSteps(index, { module: 'beta' }).map((r) => r.id), ['1.1.4'])
  assert.deepEqual(nextSteps(index, 1).map((r) => r.id), ['1.1.2'])
})

test('dependents are found transitively', () => {
  assert.deepEqual(transitiveDependents(index, '1.1.1'), ['1.1.2', '1.1.3'])
})

test('rollup counts by status and sums remaining effort points', () => {
  const { overall, modules } = rollup(index)
  assert.equal(overall.total, 4)
  assert.equal(overall.complete, 1)
  assert.equal(overall.roadmap, 1)
  assert.equal(overall.remainingPoints, 1 + 8 + 2)
  assert.equal(modules.alpha.complete, 1)
  assert.equal(modules.beta.open, 1)
})

test('branch names are step/<id>-<slug> and stay short', () => {
  assert.equal(slugify('Fix: the Thing (v2)!'), 'fix-the-thing-v2')
  assert.match(branchNameFor('2.3.1', { title: 'A '.repeat(60) }), /^step\/2\.3\.1-[a-z0-9-]{1,40}$/)
})
