/**
 * Resolve the locally installed Vite binary (root or vendored under pmo/) and
 * run it, so `npm run pmo:dev` / `pmo:preview` work without a global install.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const candidates = [
  resolve(root, 'pmo', 'node_modules', '.bin', 'vite'),
  resolve(root, 'node_modules', '.bin', 'vite'),
]
const vite = candidates.find((candidate) => existsSync(candidate))
if (!vite) {
  console.error('vite not found. Run `npm install` at the repository root (see project.json install).')
  process.exit(1)
}

const mode = process.argv[2] === 'preview' ? 'preview' : 'dev'
const args = mode === 'preview' ? ['preview', 'pmo'] : ['pmo']
const result = spawnSync(vite, args, { stdio: 'inherit' })
process.exit(result.status ?? (result.error ? 1 : 0))
