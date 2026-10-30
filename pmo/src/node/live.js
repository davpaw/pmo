/**
 * Builds public/data/live.json: facts that change with every commit, so they are
 * generated locally and git-ignored rather than committed.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { classifyBranch } from '../isolation.js'
import { allBranches, baseRef, claimsFor, commitCountFor, currentBranch, git, isClean, lastCommitFor, tagsFor } from './git.js'

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

export const buildLive = ({ root, catalog, project }) => {
  const modules = {}
  const testFiles = {}

  for (const m of catalog.modules) {
    if (!m.exists || !m.path) continue
    modules[m.id] = { last: lastCommitFor(root, m.path), commits: commitCountFor(root, m.path), tags: tagsFor(root, `${m.id}@`) }
    const dir = join(root, m.path)
    if (!existsSync(dir)) continue
    testFiles[m.id] = statSync(dir).isDirectory() ? walk(dir).filter((f) => f.endsWith('.test.js')).length : (m.hasTests ? 1 : 0)
  }

  const branches = allBranches(root, project.remote).map((name) => ({ name, ...classifyBranch(name, project) })).map(({ name, kind, stepId }) => ({ name, kind, stepId: stepId ?? null, active: kind === 'step' && claimsFor(root, project.remote, stepId, { base: baseRef(root, project) }).includes(name) }))
  return {
    generatedAt: new Date().toISOString(),
    branch: currentBranch(root),
    head: git(root, ['rev-parse', '--short', 'HEAD']),
    clean: isClean(root),
    totalCommits: Number.parseInt(git(root, ['rev-list', '--count', 'HEAD']), 10),
    branches,
    modules,
    testFiles,
  }
}
