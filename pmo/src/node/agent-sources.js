/**
 * Server-side inputs for the PMO Agent: the repository snapshot that goes into
 * its prompt, and the local env file that holds its AIRouter settings.
 */

import { chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { buildKnowledge } from '../agent/prompt.js'

const DATA = 'pmo/data'
const DOCUMENTS = ['AGENTS.md', '.rules.md']

const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'))

const firstHeading = (text) => text.split('\n').find((row) => row.startsWith('# '))?.slice(2).trim() ?? ''

/** The text a new conversation starts with, read fresh from the working tree. */
export const loadKnowledge = (root) => {
  const catalogPath = join(root, DATA, 'catalog.generated.json')
  const docsDir = join(root, 'docs')
  const contractsDir = join(root, 'server/contracts')
  return buildKnowledge({
    project: readJson(root, `${DATA}/project.json`),
    guardrails: readJson(root, `${DATA}/guardrails.json`),
    plan: readJson(root, `${DATA}/plan.json`),
    catalog: existsSync(catalogPath) ? readJson(root, `${DATA}/catalog.generated.json`) : { modules: [], agents: [] },
    documents: DOCUMENTS.filter((name) => existsSync(join(root, name))).map((name) => ({ path: name, text: readFileSync(join(root, name), 'utf8') })),
    docs: existsSync(docsDir)
      ? readdirSync(docsDir).filter((name) => name.endsWith('.md')).sort().map((name) => ({ path: `docs/${name}`, title: firstHeading(readFileSync(join(docsDir, name), 'utf8')) }))
      : [],
    contracts: existsSync(contractsDir) ? readdirSync(contractsDir).filter((name) => name.endsWith('.js') && !name.endsWith('.test.js')).sort() : [],
    today: new Date().toISOString().slice(0, 10),
  })
}

export const ENV_FILE = '.env.local'

/** Values from .env.local, with real environment variables taking precedence. Read on every call, so a new key needs no restart. */
export const loadAgentEnv = (root, base = process.env) => {
  const file = join(root, ENV_FILE)
  let fromFile = {}
  if (existsSync(file)) {
    try { fromFile = parseEnv(readFileSync(file, 'utf8')) } catch { fromFile = {} }
  }
  return { ...fromFile, ...base }
}

const quote = (value) => (/^[A-Za-z0-9_./:@+-]*$/.test(value) ? value : JSON.stringify(value))

/** Sets KEY=value lines in env-file text, keeping everything else as it was. */
export const updateEnvText = (text, updates) => {
  const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n')
  for (const [key, value] of Object.entries(updates)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`Not an env name: ${key}`)
    if (/[\r\n\0]/.test(value)) throw new Error(`${key} must be a single line.`)
    const entry = `${key}=${quote(value)}`
    const at = lines.findIndex((row) => new RegExp(`^\\s*(export\\s+)?${key}\\s*=`).test(row))
    if (at >= 0) lines[at] = entry
    else lines.push(entry)
  }
  return `${lines.join('\n')}\n`
}

/** Writes the values to .env.local (owner read and write only). Returns the file path. */
export const writeAgentEnv = (root, updates) => {
  const file = join(root, ENV_FILE)
  const before = existsSync(file) ? readFileSync(file, 'utf8') : ''
  writeFileSync(file, updateEnvText(before, updates), { mode: 0o600 })
  chmodSync(file, 0o600)
  return file
}
