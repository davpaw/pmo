/**
 * Scaffolds the PMO tool into a host repository so it can be used after
 * `npm install`. Run with: `npx pmo init` (or `node pmo/scripts/pmo.mjs init`
 * when already vendored).
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const SKIP = new Set(['node_modules', '.git', 'dist', '.runtime'])

export const initHost = (targetRoot = process.cwd()) => {
  const dest = join(targetRoot, 'pmo')
  if (existsSync(dest)) {
    console.error(`pmo/ already exists at ${dest}; refusing to overwrite.`)
    process.exitCode = 1
    return false
  }
  mkdirSync(dest, { recursive: true })
  cpSync(packageRoot, dest, {
    recursive: true,
    filter: (source) => {
      const rel = source.slice(packageRoot.length + 1)
      if (!rel) return true
      const first = rel.split(/[\\/]/)[0]
      if (SKIP.has(first)) return false
      if (rel === 'public/data/live.json') return false
      return true
    },
  })
  console.log(`Scaffolded PMO into ${dest}`)
  console.log('Next: add scripts to package.json and run `npm run pmo -- validate`.')
  return true
}

if (import.meta.url === `file://${process.argv[1]}`) {
  initHost()
}