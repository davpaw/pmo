import { pmoDirectory } from './paths.js'
import { git } from './git.js'
import { classifyBranch } from '../isolation.js'

/** Read local refs only: no network, checkout, file mutation or PR code execution. */
export const buildRepositoryState = ({ root, project, now = () => new Date().toISOString(), run = (args, options) => git(root, args, options) }) => {
  const remoteMain = `${project.remote}/${project.mainBranch}`
  const mainRef = run(['rev-parse', '--verify', '--quiet', remoteMain], { allowFail: true }) ? remoteMain : project.mainBranch
  const mainHead = run(['rev-parse', '--verify', '--quiet', mainRef], { allowFail: true })
  let steps = null
  try {
    const plan = JSON.parse(run(['show', `${mainRef}:${pmoDirectory(root, project)}/data/plan.json`]))
    steps = new Map(plan.workstreams.flatMap(w => w.epics).flatMap(e => e.steps).map(s => [s.id, s.status]))
  } catch { /* Activity cannot be established without an approved local base. */ }
  const refs = run(['for-each-ref', '--format=%(refname)%09%(subject)', 'refs/heads', `refs/remotes/${project.remote}`]).split('\n').filter(Boolean)
  const mergedRefs = mainHead ? run(['for-each-ref', `--merged=${mainRef}`, '--format=%(refname)', 'refs/heads', `refs/remotes/${project.remote}`], { allowFail: true }) : null
  const merged = mergedRefs === null ? null : new Set(mergedRefs.split('\n'))
  const branches = new Map()
  for (const line of refs) {
    const [ref, subject = ''] = line.split('\t')
    const name = ref.startsWith('refs/heads/') ? ref.slice(11) : ref.slice(`refs/remotes/${project.remote}/`.length)
    if (!name || name === 'HEAD') continue
    const { kind, stepId } = classifyBranch(name, project)
    const active = kind !== 'step' ? false : !steps || !merged || !steps.has(stepId) ? null : steps.get(stepId) === 'complete' ? false : !(merged.has(ref) && subject.startsWith(`[${stepId}] `))
    const prior = branches.get(name)
    // Local and remote copies of the same branch are one row; either may still claim work.
    const combined = prior?.active === true || active === true ? true : prior?.active === null || active === null ? null : false
    branches.set(name, { name, kind, stepId: stepId ?? null, active: combined })
  }
  return { generatedAt: now(), source: 'local-checkout', branch: run(['rev-parse', '--abbrev-ref', 'HEAD']), head: run(['rev-parse', '--short', 'HEAD']), clean: run(['status', '--porcelain']) === '', totalCommits: Number.parseInt(run(['rev-list', '--count', 'HEAD']), 10), mainRef, mainHead, branches: [...branches.values()].sort((a, b) => a.name.localeCompare(b.name)) }
}
