import test from 'node:test'
import assert from 'node:assert/strict'
import { groupedClaims, normalizeRepositoryState, repositoryFresh } from './repository-state.js'
import { createRepositoryRefresher } from './repository-client.js'
const now = Date.parse('2026-11-03T15:00:00Z')
const state = { generatedAt: new Date(now).toISOString(), branch: 'main', head: 'abc1234', clean: true, branches: [] }
test('static, old, future and invalid snapshots cannot claim current local freshness', () => {
  assert.equal(repositoryFresh(state, true, now), true)
  assert.equal(repositoryFresh(state, false, now), false)
  assert.equal(repositoryFresh(state, true, now + 100000), false)
  assert.equal(repositoryFresh(state, true, now - 1), false)
  assert.equal(normalizeRepositoryState({ ...state, head: 'bad' }), null)
})
test('claim groups deduplicate branches and retain unknown activity instead of guessing', () => {
  const branch = { name: 'step/1.1.1-one', kind: 'step', stepId: '1.1.1', active: true }
  const snapshot = normalizeRepositoryState({ ...state, branches: [branch, branch, { ...branch, name: 'step/1.1.1-two' }, { ...branch, stepId: '1.1.2', active: false }, { ...branch, stepId: '1.1.3', active: undefined }] })
  const groups = groupedClaims(snapshot, { steps: new Map() })
  assert.equal(groups.active.length, 1)
  assert.equal(groups.active[0].branches.length, 2)
  assert.equal(groups.inactive.length, 1)
  assert.equal(groups.unknown.length, 1)
})
test('refresh updates facts without caching; failure retains snapshot but removes live-state label', async () => {
  const ctx = {}
  let mode = 'ok', renders = 0
  const refresh = createRepositoryRefresher({ ctx, render: () => { renders++ }, fetcher: async (url, options) => {
    assert.equal(url, '/api/pmo/repository')
    assert.equal(options.cache, 'no-store')
    return { ok: mode === 'ok', json: async () => ({ repository: state }) }
  } })
  await refresh()
  assert.equal(ctx.repositoryState.head, 'abc1234')
  assert.equal(ctx.repositoryOnline, true)
  mode = 'fail'
  await refresh()
  assert.equal(ctx.repositoryOnline, false)
  assert.equal(ctx.repositoryState.head, 'abc1234')
  assert.match(ctx.repositoryMessage, /last snapshot/)
  assert.equal(renders, 2)
})
