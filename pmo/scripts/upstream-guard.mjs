#!/usr/bin/env node
import { resolve } from 'node:path'
import { checkUpstream, readUpstream } from '../src/node/upstream.js'
const args = process.argv.slice(2)
const value = (key, fallback) => { const at = args.indexOf(key); return at < 0 ? fallback : args[at + 1] }
try {
  const root = resolve(value('--root', '.'))
  const expected = value('--repository')
  if (expected && readUpstream(root, value('--package', 'pmo'))?.repository !== expected) throw Error('Unexpected upstream source')
  const result = checkUpstream({ root: resolve(value('--root', '.')), packagePath: value('--package', 'pmo'), base: value('--base', 'origin/main'), branch: value('--branch'), verifyRemote: args.includes('--verify-remote') })
  for (const error of result.errors) console.error(error)
  if (!result.configured && args.includes('--require-config')) { console.error('Upstream provenance is required.'); process.exitCode = 1 }
  else process.exitCode = result.ok ? 0 : 1
  if (result.ok && result.configured) console.log(`${args.includes('--verify-remote') ? 'Upstream receipts remotely verified' : 'Receipt structure checked; remote not verified'} for ${result.checked.length} changed PMO source file(s).`)
} catch { console.error('Upstream verification unavailable; no contribution can be assumed verified.'); process.exitCode = 1 }
