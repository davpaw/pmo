/**
 * Builds public/data/live.json: facts that change with every commit, so they are
 * generated locally and git-ignored rather than committed.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { buildRepositoryState } from './repository-state.js'
import { commitCountFor, lastCommitFor, tagsFor } from './git.js'

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

  return {
    ...buildRepositoryState({ root, catalog, project }),
    modules,
    testFiles,
  }
}
