#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { repoRoot } from '../src/node/git.js'
import { run } from '../src/cli.js'

const here = fileURLToPath(new URL('.', import.meta.url))

try {
  process.exitCode = await run(process.argv.slice(2), { root: repoRoot(here) })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
