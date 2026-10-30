/**
 * `pmo agent ...`: set up and inspect the PMO Agent's model connection.
 * Prompts are injectable so tests never touch a terminal.
 */

import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { DEFAULT_BASE_URL, DEFAULT_PROVIDER, DEFAULT_ROUTER_URL, PROVIDERS, describeAgentConfig, normalizeProvider, parseBaseUrl, parseRouterUrl, resolveAgentConfig } from '../agent/config.js'
import { CHARTER_VERSION } from '../agent/instructions.js'
import { ENV_FILE, loadAgentEnv, loadKnowledge, writeAgentEnv } from './agent-sources.js'
import { createAgentService, verifyKey } from '../agent/service.js'

/** Asks on the terminal. A secret answer is not echoed. */
export const terminalPrompt = (question, { secret = false } = {}) => new Promise((resolve) => {
  let muted = false
  const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done() } })
  const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) })
  rl.question(question, (answer) => {
    muted = false
    if (secret) process.stdout.write('\n')
    rl.close()
    resolve(answer.trim())
  })
  muted = secret
})

const verdicts = {
  ready: 'ready (the model answered)',
  rejected: 'not ready (the model rejected the key or token)',
  not_found: 'not ready (the model, router or address was not found)',
  unverified: 'not verified (the model could not be checked just now)',
}

const show = async (out, root, fetchImpl) => {
  const config = resolveAgentConfig(loadAgentEnv(root))
  const info = describeAgentConfig(config)
  let check = null
  if (info.configured) check = await verifyKey({ config, fetchImpl })
  out.log(`agent: ${check ? verdicts[check.state] : 'not ready (settings incomplete)'}`)
  out.log(`  provider: ${info.provider}`)
  out.log(`  settings from: ${info.source}`)
  out.log(`  model: ${info.model || (info.provider === 'airouter' ? '(AIRouter chooses)' : '(not set)')}`)
  if (info.provider === 'airouter') out.log(`  task: ${info.task}`)
  out.log(`  host: ${info.host || '(not set)'}`)
  out.log(`  key: ${info.keySet ? 'set (hidden)' : info.provider === 'airouter' ? 'not set (fine for a local router)' : 'not set'}`)
  for (const issue of info.issues) out.log(`  problem: ${issue}`)
  if (check?.message) out.log(`  problem: ${check.message}`)
  out.log(`  charter: version ${CHARTER_VERSION}, fixed in pmo/src/agent/instructions.js`)
  return info
}

export const commandAgent = async ({ root, args, out, prompt = terminalPrompt, fetchImpl }) => {
  const sub = args.positional[1] ?? 'status'

  if (sub === 'status') {
    await show(out, root, fetchImpl)
    return 0
  }

  if (sub === 'prompt') {
    const service = createAgentService({ getConfig: () => resolveAgentConfig({}), loadKnowledge: () => loadKnowledge(root) })
    out.log(service.previewPrompt())
    return 0
  }

  if (sub === 'setup') {
    const current = loadAgentEnv(root)
    const flag = (name) => (typeof args.flags[name] === 'string' ? args.flags[name].trim() : undefined)
    const providerAnswer = flag('provider') ?? (await prompt(`Provider (${PROVIDERS.join(' | ')}) [${normalizeProvider(current.PMO_AGENT_PROVIDER) ?? DEFAULT_PROVIDER}]: `))
    const provider = normalizeProvider(providerAnswer || current.PMO_AGENT_PROVIDER || DEFAULT_PROVIDER)
    if (!provider) {
      out.error(`The provider must be one of ${PROVIDERS.join(', ')}.`)
      out.error('Nothing was saved.')
      return 1
    }
    const model = (flag('model') ?? (await prompt(provider === 'airouter'
      ? `Preferred model (blank lets AIRouter choose)${current.PMO_AGENT_MODEL ? ` [${current.PMO_AGENT_MODEL}]` : ''}: `
      : `Model id${current.PMO_AGENT_MODEL ? ` [${current.PMO_AGENT_MODEL}]` : ''}: `))) || current.PMO_AGENT_MODEL || ''
    const updates = { PMO_AGENT_PROVIDER: provider, PMO_AGENT_MODEL: model }
    const problems = []

    if (provider === 'airouter') {
      const url = (flag('router-url') ?? (await prompt(`AIRouter URL [${current.PMO_AGENT_AIROUTER_URL || DEFAULT_ROUTER_URL}]: `))) || current.PMO_AGENT_AIROUTER_URL || DEFAULT_ROUTER_URL
      const token = await prompt(`AIRouter token (blank if none)${current.PMO_AGENT_AIROUTER_TOKEN ? ' [keep the saved token: press Enter]' : ''}: `, { secret: true }) || current.PMO_AGENT_AIROUTER_TOKEN || ''
      const parsed = parseRouterUrl(url)
      if (parsed.error) problems.push(`The AIRouter URL ${parsed.error}.`)
      Object.assign(updates, { PMO_AGENT_AIROUTER_URL: parsed.url ?? '', PMO_AGENT_AIROUTER_TOKEN: token })
    } else {
      const baseUrl = (flag('base-url') ?? (await prompt(`Base URL [${current.PMO_AGENT_BASE_URL || DEFAULT_BASE_URL}]: `))) || current.PMO_AGENT_BASE_URL || DEFAULT_BASE_URL
      const key = await prompt(`API key${current.PMO_AGENT_API_KEY ? ' [keep the saved key: press Enter]' : ''}: `, { secret: true }) || current.PMO_AGENT_API_KEY || ''
      if (!model) problems.push('A model id is required.')
      if (!key) problems.push('An API key is required.')
      const parsed = parseBaseUrl(baseUrl)
      if (parsed.error) problems.push(`The base URL ${parsed.error}.`)
      Object.assign(updates, { PMO_AGENT_API_KEY: key, PMO_AGENT_BASE_URL: parsed.url ?? '' })
    }

    if (problems.length) {
      for (const problem of problems) out.error(problem)
      out.error('Nothing was saved.')
      return 1
    }
    const file = writeAgentEnv(root, updates)
    out.log(`Saved to ${ENV_FILE} (${file}), readable only by you. That file is ignored by git; never commit a key or token.`)
    await show(out, root, fetchImpl)
    out.log('The running PMO app picks this up on the next question. Open it with: npm run pmo:dev')
    return 0
  }

  out.error('Usage: pmo agent [status | setup [--provider openai-compatible|airouter] [--model id] [--base-url url] [--router-url url] | prompt]')
  return 1
}
