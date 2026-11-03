import test from 'node:test'
import assert from 'node:assert/strict'
import { indexPlan, readiness, nextSteps } from './plan.js'
import { normalizedPrState, proposedPlanBlocks, prStatus } from './pull-requests.js'
import { validatePlan } from './schema.js'
const NOW = Date.parse('2026-11-03T13:00:00Z')
const makePlan = () => ({ workstreams: [{ id: '1', title: 'W', summary: 's', epics: [{ id: '1.1', title: 'E', summary: 's', steps: [
  { id: '1.1.1', title: 'First', summary: 's', status: 'complete', evidence: ['proof.js'] },
  { id: '1.1.2', title: 'Second', summary: 's', status: 'roadmap', dependsOn: ['1.1.1'], modules: ['pmo'], effort: { size: 'S' }, risk: { level: 'low', notes: 'n' }, value: { score: 3, why: 'w' }, acceptance: ['a'], onboarding: 'none' },
] }] }] })
const pr = (number = 1, extra = {}) => ({ number, kind: 'plan', title: '<Pending scope>', state: 'OPEN', blocks: [{ id: '1.1.2', reason: 'Scope awaits merge' }], ...extra })
const state = (pullRequests, extra = {}) => ({ schemaVersion: 1, repository: 'owner/repo', checkedAt: new Date(NOW).toISOString(), ok: true, pullRequests, ...extra })
const idx = (pullRequests, extra = {}) => indexPlan(makePlan(), { pullRequests: state(pullRequests, extra), now: NOW })

test('all prerequisite PRs must merge and be verified before readiness and next unblock', () => {
  const one = pr(1), two = pr(2)
  assert.equal(readiness(idx([one, two]), '1.1.2').blockers.length, 2)
  const merged = { ...one, state: 'MERGED', mergeVerified: true }
  assert.equal(readiness(idx([merged, two]), '1.1.2').ready, false)
  assert.equal(nextSteps(idx([merged, two]), 5).length, 0)
  assert.equal(readiness(idx([merged, { ...two, state: 'MERGED', mergeVerified: true }]), '1.1.2').ready, true)
})
test('closed, unverified, stale, future and unavailable states never silently unblock', () => {
  for (const current of [pr(1, { state: 'CLOSED' }), pr(1, { state: 'MERGED' }), pr(1, { discoveryError: true })]) assert.equal(readiness(idx([current]), '1.1.2').ready, false)
  const merged = pr(1, { state: 'MERGED', mergeVerified: true })
  for (const extra of [{ ok: false }, { checkedAt: '2020-01-01' }, { checkedAt: '2040-01-01' }]) assert.equal(readiness(idx([merged], extra), '1.1.2').ready, false)
  assert.match(prStatus(pr(1, { state: 'CLOSED' }), state([]), NOW), /Closed without merge/)
})
test('implementation delivery blocks dependents, not its own existing step; it creates no plan decision', () => {
  const current = pr(2, { kind: 'delivery', stepId: '1.1.1', blocks: [] })
  const index = idx([current])
  assert.equal(index.steps.size, 2)
  assert.equal(readiness(index, '1.1.2').ready, false)
  assert.match(readiness(index, '1.1.2').blockers[0].reason, /Delivery of prerequisite 1.1.1/)
})
test('manual PR prerequisites validate and fail closed when unknown', () => {
  const plan = makePlan()
  plan.workstreams[0].epics[0].steps[1].requiresPullRequests = [{ number: 77, repository: 'owner/repo' }]
  assert.deepEqual(validatePlan(plan), [])
  assert.equal(readiness(indexPlan(plan), '1.1.2').ready, false)
  for (const ref of [{ number: -1 }, { number: 1.5 }, { number: 1, repository: 'javascript:bad' }]) {
    plan.workstreams[0].epics[0].steps[1].requiresPullRequests = [ref]
    assert.ok(validatePlan(plan).length)
  }
})
test('proposed scope, dependencies and new follow-ups become blockers without mutating approved steps', () => {
  const base = makePlan(), head = structuredClone(base)
  head.workstreams[0].epics[0].steps[1].scope = { contracts: ['src/contracts/new.js'] }
  head.workstreams[0].epics[0].steps.push({ id: '1.1.3', title: 'Follow-up', dependsOn: ['1.1.2'] })
  const before = JSON.stringify(base)
  const blocks = proposedPlanBlocks(base, head)
  assert.deepEqual(blocks.map((b) => b.id), ['1.1.2', '1.1.3'])
  assert.equal(blocks[1].proposed, true)
  assert.deepEqual(blocks[1].followUps, ['1.1.2'])
  const index = indexPlan(base, { pullRequests: state([pr(3, { blocks })]), now: NOW })
  assert.equal(index.steps.has('1.1.3'), false)
  assert.equal(JSON.stringify(base), before)
  assert.equal(readiness(index, '1.1.2').ready, false)
})
test('explicit reviewed withdrawal is required to dismiss a closed-unmerged prerequisite', () => {
  const plan = makePlan()
  plan.workstreams[0].epics[0].steps[1].dismissedPullRequests = [{ number: 1, reason: 'Product owner withdrew this scope change.' }]
  assert.deepEqual(validatePlan(plan), [])
  assert.equal(readiness(indexPlan(plan, { pullRequests: state([pr(1, { state: 'CLOSED' })]), now: NOW }), '1.1.2').ready, true)
})
test('PR links are derived from validated repository and number, never a supplied URL', () => {
  const normalized = normalizedPrState(state([pr(1, { url: 'javascript:alert(1)' })]))
  assert.equal(normalized.pullRequests[0].url, 'https://github.com/owner/repo/pull/1')
  assert.equal(normalizedPrState({ ...state([]), repository: 'https://evil' }), null)
})
