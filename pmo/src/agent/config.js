/**
 * Where the PMO Agent's model is and how to reach it. Read on the server only;
 * no name here carries the VITE_ prefix, so no bundler can ship it to a browser.
 *
 * Two providers; the default is a model API you call directly:
 *
 *   PMO_AGENT_PROVIDER   openai-compatible (default) | airouter
 *
 *   openai-compatible (any OpenAI-style chat completions API, e.g. OpenAI, Anthropic's /v1, a local server)
 *     PMO_AGENT_API_KEY    the key (required)
 *     PMO_AGENT_MODEL      the model id (required)
 *     PMO_AGENT_BASE_URL   default https://api.openai.com/v1
 *
 *   airouter (optional: AIRouter owns keys, model choice, fallback and cost control)
 *     PMO_AGENT_AIROUTER_URL    default http://127.0.0.1:8001/ai/complete
 *     PMO_AGENT_AIROUTER_TOKEN  bearer token, if the router requires one (optional)
 *     PMO_AGENT_MODEL           preferred model; empty lets AIRouter choose
 *     PMO_AGENT_TASK            AIRouter task name (default text_analysis)
 *
 *   both:  PMO_AGENT_TIMEOUT_MS (default 30000), PMO_AGENT_MAX_TOKENS (default 1200, at most 4000)
 *
 * Every PMO_AGENT_* name falls back to the shared name without the prefix, so the product's
 * own model settings can serve both: AI_PROVIDER, AI_API_KEY, AI_MODEL, AI_BASE_URL,
 * AIROUTER_URL, AIROUTER_TOKEN. The key sits behind a function so a config can be logged
 * or spread without carrying it.
 */

export const PROVIDERS = Object.freeze(['openai-compatible', 'airouter'])
export const DEFAULT_PROVIDER = 'openai-compatible'
export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_ROUTER_URL = 'http://127.0.0.1:8001/ai/complete'
export const DEFAULT_TASK = 'text_analysis'
export const KEY_NAMES = Object.freeze(['PMO_AGENT_PROVIDER', 'PMO_AGENT_API_KEY', 'PMO_AGENT_MODEL', 'PMO_AGENT_BASE_URL', 'PMO_AGENT_AIROUTER_URL', 'PMO_AGENT_AIROUTER_TOKEN', 'PMO_AGENT_TASK', 'PMO_AGENT_TIMEOUT_MS', 'PMO_AGENT_MAX_TOKENS'])

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const parseSecureUrl = (value) => {
  let url
  try { url = new URL(String(value).trim()) } catch { return { error: 'is not a URL' } }
  if (url.username || url.password) return { error: 'must not carry a user name or password' }
  if (url.search || url.hash) return { error: 'must not carry a query or fragment' }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) return { error: 'must use https (http is allowed only for localhost)' }
  return { url }
}

/** An https URL, or http for a model server on this machine. No credentials, query or fragment. */
export const parseBaseUrl = (value) => {
  const parsed = parseSecureUrl(value)
  return parsed.error ? parsed : { url: `${parsed.url.origin}${parsed.url.pathname.replace(/\/+$/, '')}` }
}

/** Like parseBaseUrl, and a bare origin gets /ai/complete. */
export const parseRouterUrl = (value) => {
  const parsed = parseSecureUrl(value)
  if (parsed.error) return parsed
  return { url: `${parsed.url.origin}${parsed.url.pathname.replace(/\/+$/, '') || '/ai/complete'}` }
}

/** Accepts the aliases people type. Returns null for anything else. */
export const normalizeProvider = (value) => {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return DEFAULT_PROVIDER
  if (['openai-compatible', 'openai', 'direct'].includes(text)) return 'openai-compatible'
  if (['airouter', 'ai-router', 'router'].includes(text)) return 'airouter'
  return null
}

const boundedInt = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}

const hold = (value) => () => value

/** @returns {{ configured: boolean, issues: string[], source: string, provider: string, baseUrl: string, url: string, model: string, task: string, timeoutMs: number, maxTokens: number, secret: () => string }} */
export const resolveAgentConfig = (env = {}) => {
  const clean = (name) => (typeof env[name] === 'string' ? env[name].trim() : '')
  const own = (suffix) => clean(`PMO_AGENT_${suffix}`)
  const pick = (suffix, shared = suffix) => own(suffix) || clean(shared)
  const usesOwn = KEY_NAMES.some((name) => name.startsWith('PMO_AGENT_') && !['TIMEOUT_MS', 'MAX_TOKENS', 'TASK'].some((tail) => name.endsWith(tail)) && clean(name))

  const issues = []
  const provider = normalizeProvider(pick('PROVIDER', 'AI_PROVIDER'))
  if (!provider) issues.push(`Provider "${pick('PROVIDER', 'AI_PROVIDER')}" is not one of ${PROVIDERS.join(', ')}.`)

  const apiKey = pick('API_KEY', 'AI_API_KEY')
  const model = pick('MODEL', 'AI_MODEL')
  const rawBase = pick('BASE_URL', 'AI_BASE_URL')
  const routerToken = pick('AIROUTER_TOKEN', 'AIROUTER_TOKEN')
  const rawRouter = pick('AIROUTER_URL', 'AIROUTER_URL')
  const anySet = Boolean(apiKey || model || rawBase || routerToken || rawRouter || pick('PROVIDER', 'AI_PROVIDER'))

  let baseUrl = ''
  let url = ''
  let secret = apiKey
  if (provider === 'airouter') {
    secret = routerToken
    const parsed = parseRouterUrl(rawRouter || DEFAULT_ROUTER_URL)
    if (parsed.error) issues.push(`AIRouter URL ${parsed.error}.`)
    url = parsed.url ?? ''
  } else if (provider) {
    if (!anySet) issues.push('No model is set. Run: npm run pmo -- agent setup')
    else {
      if (!apiKey) issues.push('PMO_AGENT_API_KEY is missing.')
      if (!model) issues.push('PMO_AGENT_MODEL is missing.')
      const parsed = parseBaseUrl(rawBase || DEFAULT_BASE_URL)
      if (parsed.error) issues.push(`Base URL ${parsed.error}.`)
      baseUrl = parsed.url ?? ''
    }
  }

  return Object.freeze({
    configured: issues.length === 0,
    issues,
    source: !anySet ? 'none' : usesOwn ? 'PMO_AGENT_*' : 'AI_*',
    provider: provider ?? DEFAULT_PROVIDER,
    baseUrl,
    url,
    model,
    task: own('TASK') || DEFAULT_TASK,
    timeoutMs: boundedInt(own('TIMEOUT_MS'), 30_000, 120_000),
    maxTokens: boundedInt(own('MAX_TOKENS'), 1200, 4000),
    secret: hold(secret),
  })
}

/** What may be shown to a person: everything except the key or token. */
export const describeAgentConfig = (config) => ({
  configured: config.configured,
  provider: config.provider,
  source: config.source,
  model: config.model,
  task: config.provider === 'airouter' ? config.task : '',
  host: (() => { try { return new URL(config.provider === 'airouter' ? config.url : config.baseUrl).host } catch { return '' } })(),
  keySet: Boolean(config.secret()),
  issues: [...config.issues],
})
