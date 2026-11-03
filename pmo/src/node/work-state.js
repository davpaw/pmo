import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './git.js'

export const worktreeInventory = ({ root, run = (path, args) => git(path, args) }) => {
  const rows = run(root, ['worktree', 'list', '--porcelain']).trim().split('\n\n').filter(Boolean).map(block => {
    const lines = block.split('\n'); const path = lines.find(line => line.startsWith('worktree '))?.slice(9)
    const branch = lines.find(line => line.startsWith('branch '))?.slice(18) || '(detached)'
    if (!path || !existsSync(path)) return { path, branch, available: false, dirty: null }
    try { return { path, branch, available: true, dirty: run(path, ['status', '--porcelain']).length > 0, head: run(path, ['rev-parse', 'HEAD']) } } catch { return { path, branch, available: false, dirty: null } }
  })
  const stashes = run(root, ['stash', 'list']).split('\n').filter(Boolean).length
  return { worktrees: rows, stashes }
}
const prDefault = (root, repository, branch) => JSON.parse(execFileSync('gh', ['pr', 'list', '--repo', repository, '--head', branch, '--state', 'all', '--json', 'number,state,baseRefName,headRefOid,mergeCommit,url'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }))
/** Verify completion; never deletes files, cleans a worktree, stashes work or writes a recovery bundle. */
export const finishWork = ({ root, project, plan, getPullRequests = (repository, branch) => prDefault(root, repository, branch), run = (args, options) => git(root, args, options) }) => {
  const errors = [], branch = run(['rev-parse', '--abbrev-ref', 'HEAD']), head = run(['rev-parse', 'HEAD'])
  const id = /^step\/(\d+\.\d+\.\d+)-/.exec(branch)?.[1]
  const step = plan.workstreams.flatMap(w => w.epics).flatMap(e => e.steps).find(s => s.id === id)
  if (!id || !step) errors.push('Finish from the owning step branch.')
  if (run(['status', '--porcelain'])) errors.push('Commit all intended changes before finishing. Uncommitted work remains.')
  if (step && (step.status !== 'complete' || !step.completedAt || !step.evidence?.length || !step.evidence.every(path => existsSync(join(root, path))))) errors.push('Complete the step with dated, existing evidence before finishing.')
  const pushed = run(['rev-parse', '--verify', `${project.remote}/${branch}`], { allowFail: true })
  if (pushed !== head) errors.push('The local head is not the verified remote-tracking head. Push, fetch and verify before finishing.')
  let pr = null, delivery = 'unverified'
  try {
    pr = getPullRequests(project.repository, branch).find(pr => pr.headRefOid === head && ['OPEN', 'MERGED'].includes(pr.state))
    if (!pr) errors.push('No PR matches this exact committed head. Open or update its PR.')
    else if (pr.baseRefName !== project.mainBranch) errors.push('The delivery PR must target configured main. Keep a stacked PR explicitly pending until retargeted.')
    else if (pr.state === 'OPEN') delivery = 'awaiting review / merge'
    else {
      const sha = pr.mergeCommit?.oid
      if (sha && /^[0-9a-f]{40}$/.test(sha) && run(['merge-base', '--is-ancestor', sha, `${project.remote}/${project.mainBranch}`], { allowFail: true }) !== null) delivery = 'merged on main'
      else errors.push('Merged status is not yet verified on the configured main ref; fetch and recheck.')
    }
  } catch { errors.push('PR verification unavailable; completion remains unverified.') }
  return { ok: errors.length === 0, branch, head, stepId: id, delivery, pullRequest: pr ? { number: pr.number, url: pr.url } : null, errors }
}

export const orphanedWork = (inventory, plan) => {
  const steps = new Map(plan.workstreams.flatMap(w => w.epics).flatMap(e => e.steps).map(step => [step.id,step.status]))
  return inventory.worktrees.filter(tree => {
    if (!tree.available || !tree.dirty) return false
    if (/^(?:plan|release)\//.test(tree.branch)) return false
    const id = /^step\/(\d+\.\d+\.\d+)-/.exec(tree.branch)?.[1]
    return !id || !steps.has(id) || steps.get(id) === 'complete'
  })
}
