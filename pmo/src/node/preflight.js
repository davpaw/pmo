/**
 * Facts the CLI gathers from the machine: git state, node, dependencies, env keys, ports.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { behindRemote, claimsFor, currentBranch, isClean } from './git.js'

const envKeys = (path) => {
  if (!existsSync(path)) return new Set()
  const keys = new Set()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line)
    if (match && match[2] !== '""' && match[2] !== "''") keys.add(match[1])
  }
  return keys
}

export const portInUse = (port) =>
  new Promise((resolve) => {
    const server = createServer()
    server.once('error', (error) => resolve(error.code === 'EADDRINUSE'))
    server.once('listening', () => server.close(() => resolve(false)))
    server.listen(port, '127.0.0.1')
  })

/**
 * @param {{ root: string, project: object, stepId?: string, keys?: string[], ports?: number[] }} input
 */
export const gatherFacts = async ({ root, project, stepId, keys = [], ports = [], base, plan, excludeBranch }) => {
  const branch = currentBranch(root)
  const resuming = Boolean(stepId && branch.startsWith(`step/${stepId}-`))
  const have = new Set([...envKeys(join(root, '.env')), ...envKeys(join(root, '.env.local')), ...Object.keys(process.env)])
  const busy = []
  for (const port of ports) if (await portInUse(port)) busy.push(port)
  return {
    git: {
      branch,
      resuming,
      clean: isClean(root),
      behind: behindRemote(root, project),
      claims: stepId ? claimsFor(root, project.remote, stepId, { base, plan, excludeBranch: excludeBranch ?? (resuming ? branch : undefined) }) : [],
    },
    env: {
      node: process.versions.node,
      nodeModules: existsSync(join(root, 'node_modules')),
      missingKeys: keys.filter((key) => !have.has(key)),
      portsInUse: busy,
    },
  }
}
