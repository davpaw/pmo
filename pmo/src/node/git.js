/**
 * Thin git wrapper. execFileSync with an argument array: no shell, so branch
 * names and paths can never be interpreted as commands.
 */

import { execFileSync } from 'node:child_process'

export const git = (cwd, args, { allowFail = false } = {}) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).replace(/\n$/, '')
  } catch (error) {
    if (allowFail) return null
    const detail = String(error.stderr || error.message).trim()
    throw new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
}

export const repoRoot = (cwd) => git(cwd, ['rev-parse', '--show-toplevel'])
export const currentBranch = (cwd) => git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
export const isClean = (cwd) => git(cwd, ['status', '--porcelain']) === ''
export const hasRef = (cwd, ref) => git(cwd, ['rev-parse', '--verify', '--quiet', ref], { allowFail: true }) !== null

const lines = (text) => (text ? text.split('\n').filter(Boolean) : [])

/** Local and remote-tracking branch names (remote prefix stripped), de-duplicated. */
export const allBranches = (cwd, remote) => {
  const local = lines(git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']))
  const remoteRefs = lines(git(cwd, ['for-each-ref', '--format=%(refname:short)', `refs/remotes/${remote}`]))
    .map((name) => name.slice(remote.length + 1))
    .filter((name) => name && name !== 'HEAD')
  return [...new Set([...local, ...remoteRefs])].sort()
}

/** Branches that claim a step: step/<id>-*. */
export const claimsFor = (cwd, remote, stepId, { base, plan, excludeBranch } = {}) => {
  const canonical = base ?? (hasRef(cwd, `${remote}/main`) ? `${remote}/main` : 'main')
  let source = plan
  if (!source) {
    try { source = JSON.parse(showAt(cwd, canonical, 'pmo/data/plan.json')) } catch { /* no canonical plan in a minimal repository */ }
  }
  const step = source?.workstreams?.flatMap((w) => w.epics).flatMap((e) => e.steps).find((s) => s.id === stepId)
  if (step?.status === 'complete') return []
  return allBranches(cwd, remote).filter((name) => {
    if (name === excludeBranch || !name.startsWith(`step/${stepId}-`)) return false
    const refs = [name, `${remote}/${name}`].filter((ref) => hasRef(cwd, ref))
    return refs.some((ref) => {
      const merged = hasRef(cwd, canonical) && git(cwd, ['merge-base', '--is-ancestor', ref, canonical], { allowFail: true }) !== null
      const subject = git(cwd, ['log', '-1', '--format=%s', ref], { allowFail: true }) ?? ''
      return !(merged && subject.startsWith(`[${stepId}] `))
    })
  })
}

/** The ref to compare against: origin/main when it exists, else main. */
export const baseRef = (cwd, project) => {
  const remoteRef = `${project.remote}/${project.mainBranch}`
  return hasRef(cwd, remoteRef) ? remoteRef : project.mainBranch
}

export const mergeBase = (cwd, base) => git(cwd, ['merge-base', base, 'HEAD'], { allowFail: true }) ?? base

/** Files changed on this branch since it left base, plus uncommitted and untracked changes. */
export const changedFiles = (cwd, base) => {
  const since = mergeBase(cwd, base)
  const committed = lines(git(cwd, ['diff', '--name-only', '--no-renames', `${since}...HEAD`]))
  const working = lines(git(cwd, ['diff', '--name-only', '--no-renames', 'HEAD']))
  const untracked = lines(git(cwd, ['ls-files', '--others', '--exclude-standard']))
  return [...new Set([...committed, ...working, ...untracked])].sort()
}

/** Added lines (with file) since the merge base, plus uncommitted work. Untracked files are read whole. */
export const addedLines = (cwd, base, readFile) => {
  const since = mergeBase(cwd, base)
  const out = []
  const parse = (diff) => {
    let file = null
    for (const line of diff.split('\n')) {
      if (line.startsWith('+++ b/')) file = line.slice(6)
      else if (line.startsWith('+++ ')) file = null
      else if (file && line.startsWith('+') && !line.startsWith('+++')) out.push({ file, text: line.slice(1) })
    }
  }
  parse(git(cwd, ['diff', '-U0', '--no-color', '--no-renames', `${since}...HEAD`]))
  parse(git(cwd, ['diff', '-U0', '--no-color', '--no-renames', 'HEAD']))
  for (const file of lines(git(cwd, ['ls-files', '--others', '--exclude-standard']))) {
    for (const text of (readFile(file) ?? '').split('\n')) out.push({ file, text })
  }
  return out
}

/** File contents at a ref, or null. */
export const showAt = (cwd, ref, path) => git(cwd, ['show', `${ref}:${path}`], { allowFail: true })

export const lastCommitFor = (cwd, path) => {
  const out = git(cwd, ['log', '-1', '--format=%h%x09%cs%x09%s', '--', path], { allowFail: true })
  if (!out) return null
  const [hash, date, subject] = out.split('\t')
  return { hash, date, subject }
}

export const commitCountFor = (cwd, path) => Number.parseInt(git(cwd, ['rev-list', '--count', 'HEAD', '--', path], { allowFail: true }) ?? '0', 10)

export const tagsFor = (cwd, prefix) => lines(git(cwd, ['tag', '--list', `${prefix}*`, '--sort=-creatordate'], { allowFail: true }) ?? '')

export const behindRemote = (cwd, project) => {
  const remoteRef = `${project.remote}/${project.mainBranch}`
  if (!hasRef(cwd, remoteRef)) return undefined
  return Number.parseInt(git(cwd, ['rev-list', '--count', `${project.mainBranch}..${remoteRef}`], { allowFail: true }) ?? '0', 10)
}
