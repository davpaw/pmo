import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildBrief } from '../briefing.js'
import { indexPlan } from '../plan.js'
import { canonicalStartCheck, planRevision } from '../snapshot.js'
import { baseRef, currentBranch, git, isClean, showAt } from './git.js'
import { gatherFacts } from './preflight.js'
import { pmoDirectory } from './paths.js'

const prCache = new Map()
export const pullRequestFor = (root, branch) => {
  const key = `${root}:${branch}`
  const cached = prCache.get(key)
  if (cached && Date.now() - cached.at < 60000) return cached.value
  try {
    const rows = JSON.parse(execFileSync('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number,state,baseRefName,mergeStateStatus'], { cwd: root, encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'] }))
    const value = rows[0] ?? null
    prCache.set(key, { at: Date.now(), value })
    return value
  } catch { return null }
}
export const readSnapshot = async ({ root, stepId, getPullRequest = pullRequestFor, readIntake = () => null }) => {
  const read = (name) => JSON.parse(readFileSync(join(root, pmoDirectory(root), 'data', name), 'utf8'))
  const plan = read('plan.json'); const project = read('project.json'); const catalog = read('catalog.generated.json')
  const step = indexPlan(plan).steps.get(stepId)?.step
  let facts
  if (step) {
    const brief = buildBrief({ index: indexPlan(plan), id: stepId, catalog, project, guardrails: read('guardrails.json') })
    facts = await gatherFacts({ root, project, stepId, keys: brief.env.keys, ports: brief.env.ports })
  }
  const canonicalText = showAt(root, baseRef(root, project), `${pmoDirectory(root)}/data/plan.json`)
  const canonical = canonicalText ? JSON.parse(canonicalText) : null
  if (facts) facts.git.canonical = canonicalStartCheck(canonical, stepId)
  const branch = currentBranch(root)
  const inbox = readIntake(root)
  return {
    generatedAt: new Date().toISOString(), planRevision: planRevision(plan), catalogRevision: planRevision(catalog), branch,
    head: git(root, ['rev-parse', '--short', 'HEAD']), clean: isClean(root), stepId, facts,
    canonicalBase: baseRef(root, project), remoteRefresh: 'not performed; remote refs may be behind GitHub',
    mergedSteps: canonical ? [...indexPlan(canonical).steps.values()].filter(({ step: s }) => s.status === 'complete').map(({ step: s }) => s.id) : null,
    pullRequest: getPullRequest(root, branch),
    intake: inbox ? { syncedAt: inbox.syncedAt, items: inbox.items.map(({ key, status, gaps, handoff }) => ({ key, status, gaps, stage: handoff?.stage ?? 'waiting' })) } : null,
  }
}
export const createSnapshotMiddleware = ({ root, read = readSnapshot, readIntake }) => async (req, res, next) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname !== '/api/pmo/snapshot') return next()
  res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store')
  let sameOrigin = true
  try { sameOrigin = !req.headers.origin || new URL(req.headers.origin).host === req.headers.host } catch { sameOrigin = false }
  if (!sameOrigin) { res.statusCode = 403; return res.end('{}') }
  if (req.method !== 'GET') { res.statusCode = 405; return res.end('{}') }
  try {
    const stepId = url.searchParams.get('step') ?? undefined
    if (stepId && !/^\d+\.\d+\.\d+$/.test(stepId)) { res.statusCode = 400; return res.end('{}') }
    res.end(JSON.stringify(await read({ root, stepId, readIntake })))
  } catch { res.statusCode = 503; res.end(JSON.stringify({ error: 'Worktree snapshot unavailable.' })) }
}

export const pmoSnapshotPlugin = (options) => ({
  name: 'pmo-worktree-snapshot',
  configureServer(server) { server.middlewares.use(createSnapshotMiddleware(options)) },
  configurePreviewServer(server) { server.middlewares.use(createSnapshotMiddleware(options)) },
})
