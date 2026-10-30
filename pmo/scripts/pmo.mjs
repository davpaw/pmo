#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { initHost } from '../src/node/init.js'

const here = fileURLToPath(new URL('.', import.meta.url))

if (process.argv[2] === 'init') {
  initHost(process.cwd())
  process.exit(process.exitCode ?? 0)
}

const { repoRoot } = await import('../src/node/git.js')
const { run } = await import('../src/cli.js')

try {
  process.exitCode = await run(process.argv.slice(2), { root: repoRoot(here) })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
