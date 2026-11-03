import test from 'node:test'
import assert from 'node:assert/strict'
import { syncPullRequests } from './pull-requests.js'
const MAIN = 'a'.repeat(40), HEAD = 'b'.repeat(40), BASE = 'c'.repeat(40), MERGE = 'd'.repeat(40)
const project = { repository: 'owner/repo', remote: 'origin', mainBranch: 'main' }
const plan = { workstreams: [{ id: '1', title: 'w', summary: 's', epics: [{ id: '1.1', title: 'e', summary: 's', steps: [{ id: '1.1.1', title: 's', summary: 's', status: 'roadmap', modules: ['pmo'], effort: { size: 'S' }, risk: { level: 'low', notes: 'n' }, value: { score: 3, why: 'w' }, acceptance: ['a'], onboarding: 'none' }] }] }] }
const changed = structuredClone(plan)
changed.workstreams[0].epics[0].steps[0].scope = { extra: ['x'] }
const raw = (number, extra = {}) => ({ number, title: 'Scope decision', state: 'OPEN', headRefName: 'plan/scope', headRefOid: HEAD, baseRefOid: MAIN, baseRefName: 'main', ...extra })
const setup = ({ merged = true, head = changed } = {}) => ({
  root: '/unused', project, plan, persist: false, previous: null, now: () => '2026-11-03T13:00:00Z',
  runGit: (args) => {
    if (args[0] === 'remote') return 'https://github.com/owner/repo.git'
    if (args[0] === 'fetch') return ''
    if (args[0] === 'rev-parse') return args.includes('--verify') ? HEAD : MAIN
    if (args[0] === 'merge-base') return args.includes('--is-ancestor') ? merged ? '' : null : BASE
    if (args[0] === 'show') return JSON.stringify(args[1].startsWith(HEAD) ? head : plan)
    throw Error('unexpected git request')
  },
})
test('discovers plan changes, delivery and main-verified merges through read-only gh/git adapters', () => {
  const result = syncPullRequests({ ...setup(), gh: () => [raw(1), raw(2, { headRefName: 'step/1.1.1-code' }), raw(3, { state: 'MERGED', mergeCommit: { oid: MERGE } })] })
  assert.equal(result.ok, true)
  assert.equal(result.pullRequests[0].blocks[0].id, '1.1.1')
  assert.equal(result.pullRequests[1].kind, 'delivery')
  assert.equal(result.pullRequests[1].stepId, '1.1.1')
  assert.equal(result.pullRequests[2].mergeVerified, true)
  assert.deepEqual(result.approvedPlan, plan)
  assert.equal(result.approvedPlan.workstreams[0].epics[0].steps[0].scope, undefined)
})
test('GitHub MERGED alone and merges into a different base cannot clear a prerequisite', () => {
  for (const options of [{ merged: false }, { merged: true }]) {
    const result = syncPullRequests({ ...setup(options), gh: () => [raw(1, { state: 'MERGED', baseRefName: options.merged ? 'step/other' : 'main', mergeCommit: { oid: MERGE } })] })
    assert.equal(result.pullRequests[0].mergeVerified, false)
  }
})
test('auth or network failure preserves known blockers and exposes no command error or credentials', () => {
  const prior = syncPullRequests({ ...setup(), gh: () => [raw(1)] })
  const result = syncPullRequests({ ...setup(), previous: prior, gh: () => { throw Error('secret credential in provider error') } })
  assert.equal(result.ok, false)
  assert.equal(result.pullRequests[0].blocks[0].id, '1.1.1')
  assert.doesNotMatch(JSON.stringify(result), /secret credential/)
})
test('unreadable pending plan data reports incomplete discovery instead of dropping its blockers', () => {
  const result = syncPullRequests({ ...setup({ head: { not: 'a plan' } }), gh: () => [raw(1)] })
  assert.equal(result.pullRequests[0].discoveryError, true)
})
test('previously tracked or explicit prerequisites are fetched even outside the returned listing', () => {
  const prior = syncPullRequests({ ...setup(), gh: () => [raw(1)] })
  const calls = []
  const result = syncPullRequests({ ...setup(), previous: prior, gh: (args) => { calls.push(args); return args[1] === 'list' ? [] : raw(1, { state: 'CLOSED' }) } })
  assert.equal(result.pullRequests[0].state, 'CLOSED')
  assert.equal(result.pullRequests[0].blocks.length, 1)
  assert.equal(calls[1][1], 'view')
})
