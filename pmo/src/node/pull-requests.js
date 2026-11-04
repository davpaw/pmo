import { pmoDirectory } from './paths.js'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { git } from './git.js'
import { validatePlan } from '../schema.js'
import { normalizedPrState, proposedPlanBlocks, validRepository } from '../pull-requests.js'

export const PR_CACHE_PATH = 'pmo/.data/pull-requests.json'
export const readPrState = (root) => {
  try { return normalizedPrState(JSON.parse(readFileSync(join(root, pmoDirectory(root), '.data/pull-requests.json'), 'utf8'))) } catch { return null }
}
const ghDefault = (root, args) => JSON.parse(execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 32 * 1024 * 1024 }))
const fields = 'number,title,state,isDraft,headRefName,headRefOid,baseRefName,baseRefOid,mergeCommit,reviewDecision'
const oid = (value) => typeof value === 'string' && /^[0-9a-f]{40,64}$/.test(value)

/** Git/gh run only locally, never in the public browser. No PR content is executed. */
export const syncPullRequests = ({ root, project, plan, now = () => new Date().toISOString(), gh = (args) => ghDefault(root, args), runGit = (args, options) => git(root, args, options), previous = readPrState(root), persist = true } = {}) => {
  const planPath = `${pmoDirectory(root, project)}/data/plan.json`
  const snapshot = { schemaVersion: 1, repository: project.repository, checkedAt: now(), ok: false, approvedPlan: previous?.approvedPlan || null, pullRequests: previous?.repository === project.repository ? previous.pullRequests : [] }
  try {
    if (!validRepository(project.repository)) throw Error('repository')
    const remoteUrl = runGit(['remote', 'get-url', project.remote])
    const expected = project.repository.toLowerCase()
    if (!new RegExp(`github\\.com[:/]${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.git)?$`, 'i').test(remoteUrl || '')) throw Error('remote')
    runGit(['fetch', '--prune', project.remote])
    const main = `${project.remote}/${project.mainBranch}`
    snapshot.mainOid = runGit(['rev-parse', main])
    if (!oid(snapshot.mainOid)) throw Error('main')
    const approved = JSON.parse(runGit(['show', `${snapshot.mainOid}:${planPath}`]))
    if (validatePlan(approved).length) throw Error('approved plan')
    snapshot.approvedPlan = approved
    const listed = gh(['pr', 'list', '--repo', project.repository, '--state', 'all', '--limit', '1000', '--json', fields])
    if (!Array.isArray(listed) || listed.length >= 1000) throw Error('incomplete listing')
    const prs = new Map(listed.filter((p) => Number.isSafeInteger(p.number) && p.number > 0).map((p) => [p.number, p]))
    // Keep previously discovered blockers even when they disappear from the listing.
    const required = new Set(snapshot.pullRequests.map((p) => p.number))
    for (const w of plan.workstreams) for (const e of w.epics) for (const s of e.steps) for (const ref of s.requiresPullRequests || []) if (!ref.repository || ref.repository === project.repository) required.add(ref.number)
    for (const number of required) if (!prs.has(number)) prs.set(number, gh(['pr', 'view', String(number), '--repo', project.repository, '--json', fields]))
    const superseded = new Set()
    for (const w of approved.workstreams) for (const e of w.epics) for (const s of e.steps) for (const ref of s.dismissedPullRequests || []) if (!ref.repository || ref.repository === project.repository) superseded.add(ref.number)
    snapshot.pullRequests = [...prs.values()].map((raw) => {
      const prior = previous?.pullRequests.find((p) => p.number === raw.number)
      const stepId = /^step\/(\d+\.\d+\.\d+)-/.exec(raw.headRefName || '')?.[1] || null
      const pr = { number: raw.number, title: raw.title, state: raw.state, draft: raw.isDraft, reviewDecision: raw.reviewDecision, kind: raw.headRefName?.startsWith('plan/') ? 'plan' : stepId ? 'delivery' : 'other', stepId, blocks: prior?.blocks || [], mergeVerified: false }
      const mergeOid = raw.mergeCommit?.oid
      const inMain = (commit) => runGit(['merge-base', '--is-ancestor', commit, main], { allowFail: true }) !== null
      if (raw.state === 'MERGED' && raw.baseRefName === project.mainBranch && oid(mergeOid)) pr.mergeVerified = inMain(mergeOid)
      // A merge into a stacked base is delivered once the PR's own head commit is in main,
      // or when a step in the approved plan on main records a reviewed supersession.
      else if (raw.state === 'MERGED') pr.mergeVerified = (oid(raw.headRefOid) && inMain(raw.headRefOid)) || superseded.has(raw.number)
      if (pr.kind === 'plan' && (raw.state === 'OPEN' || (!prior && !pr.mergeVerified))) {
        try {
          if (!oid(raw.headRefOid) || !oid(raw.baseRefOid)) throw Error('refs')
          // A fork head may not be among origin's branch refs. Fetch only the PR's data, never execute it.
          if (!runGit(['rev-parse', '--verify', raw.headRefOid], { allowFail: true })) runGit(['fetch', project.remote, `pull/${raw.number}/head`])
          const base = runGit(['merge-base', raw.headRefOid, raw.baseRefOid])
          const before = JSON.parse(runGit(['show', `${base}:${planPath}`]))
          const after = JSON.parse(runGit(['show', `${raw.headRefOid}:${planPath}`]))
          if (!Array.isArray(before.workstreams) || !Array.isArray(after.workstreams)) throw Error('plan')
          pr.blocks = proposedPlanBlocks(before, after)
        } catch { pr.discoveryError = true }
      }
      return pr
    })
    snapshot.ok = true
  } catch { snapshot.error = 'Could not verify PR state. Check gh authentication, origin and network access, then run pmo prs sync.' }
  const safe = normalizedPrState(snapshot)
  if (persist && safe) { mkdirSync(dirname(join(root, pmoDirectory(root), '.data/pull-requests.json')), { recursive: true }); writeFileSync(join(root, pmoDirectory(root), '.data/pull-requests.json'), `${JSON.stringify(safe, null, 2)}\n`) }
  return safe
}

export const canSyncPrs = (root, project) => {
  if (!validRepository(project.repository)) return false
  const remote = git(root, ['remote', 'get-url', project.remote], { allowFail: true }) || ''
  return remote.toLowerCase().replace(/\.git$/, '').endsWith(`github.com/${project.repository.toLowerCase()}`) || remote.toLowerCase().replace(/\.git$/, '').endsWith(`github.com:${project.repository.toLowerCase()}`)
}
