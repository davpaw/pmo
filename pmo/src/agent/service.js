/**
 * The PMO Agent service. It owns the conversation, so the browser sends only
 * its new question and a session id: it cannot send a system turn, forge an
 * assistant turn, or reorder anything. Every model call is
 *
 *   system  charter + repository snapshot (fixed, built here)
 *   ...     the history this service recorded
 *   user    the new question (cleaned, length-capped)
 *   system  a short reminder (stronger when the question looks like an override)
 *
 * The model has no tools. The reply is text, withheld if it contains the
 * per-process marker that only the system prompt carries.
 */

import { createHash, randomUUID } from 'node:crypto'
import { REMINDER, REMINDER_FLAGGED, looksLikeOverride } from './instructions.js'
import { buildSystemPrompt, neutralise } from './prompt.js'
import { resolveEntityQuestion, validateEntityContextIds, verifyEntityReply, privateEntityText } from './entity-context.js'

export const LIMITS = Object.freeze({
  messageChars: 4000,
  replyChars: 8000,
  historyMessages: 20,
  sessions: 50,
  sessionTtlMs: 60 * 60 * 1000,
  requestsPerMinute: 20,
})

/** How long a key check is trusted. A good result lasts longer than a bad or unclear one. */
export const VALIDATION = Object.freeze({ readyMs: 5 * 60_000, retryMs: 30_000, timeoutMs: 10_000 })

const ROUTE = /^#\/[A-Za-z0-9./_-]{0,80}$/

const fail = (code, message) => Object.assign(new Error(message), { code })

/** One chat completion against an OpenAI-compatible API. Throws an Error with a safe message. */
/**
 * AIRouter takes one system prompt and a user/assistant history. System turns are folded in:
 * the first become the system prompt; a system turn that comes after the last user turn
 * (the per-request reminder) is appended to that user turn, so it still comes last.
 */
export const toRouterRequest = (messages) => {
  const lastUser = messages.map((m) => m.role).lastIndexOf('user')
  const system = []
  const history = []
  let reminder = ''
  messages.forEach((message, index) => {
    if (message.role === 'system') {
      if (index > lastUser && lastUser >= 0) reminder += `${reminder ? '\n' : ''}${message.content}`
      else system.push(message.content)
    } else history.push({ role: message.role, content: message.content })
  })
  if (reminder && history.length) history[history.length - 1] = { ...history[history.length - 1], content: `${history[history.length - 1].content}\n\n[${reminder}]` }
  return { systemPrompt: system.join('\n\n'), history }
}

const rejectedMessage = 'The model rejected the key or token. Run: npm run pmo -- agent setup'

const interpretStatus = (response, config) => {
  if (response.status === 401 || response.status === 403) throw fail('rejected', rejectedMessage)
  if (response.status === 404) {
    throw fail('not_found', config.provider === 'airouter'
      ? 'AIRouter or the model was not found. Check the URL (it should end in /ai/complete) and the preferred model. Re-run: npm run pmo -- agent setup'
      : 'The model or address was not found. Check the model id, and that the base URL ends in /v1 (for example https://api.anthropic.com/v1). Re-run: npm run pmo -- agent setup')
  }
  if (response.status === 429) throw fail('rate_limited', 'The model is rate limited. Try again shortly.')
  if (!response.ok) throw fail('status', `The model returned status ${response.status}.`)
}

const unreachable = (error, config) => (error?.name === 'TimeoutError'
  ? fail('timeout', 'The model did not answer in time.')
  : fail('unreachable', config.provider === 'airouter' ? 'AIRouter could not be reached. Is it running (./start.sh in the AIRouter project)?' : 'The model could not be reached.'))

/** One chat-completions call to an OpenAI-compatible API. */
const chatOpenAiCompatible = async ({ config, messages, fetchImpl }) => {
  const send = async (tokenParam) => fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.secret()}` },
    body: JSON.stringify({ model: config.model, messages, [tokenParam]: config.maxTokens }),
    signal: AbortSignal.timeout(config.timeoutMs),
  })
  let response
  try {
    response = await send('max_tokens')
    if (response.status === 400) {
      const detail = await response.text().catch(() => '')
      if (/max_completion_tokens/.test(detail)) response = await send('max_completion_tokens')
    }
  } catch (error) {
    throw unreachable(error, config)
  }
  interpretStatus(response, config)
  const body = await response.json().catch(() => null)
  return body?.choices?.[0]?.message?.content
}

/** One completion through AIRouter (optional provider). */
const chatAiRouter = async ({ config, messages, fetchImpl }) => {
  const { systemPrompt, history } = toRouterRequest(messages)
  const headers = { 'content-type': 'application/json' }
  if (config.secret()) headers.authorization = `Bearer ${config.secret()}`
  let response
  try {
    response = await fetchImpl(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        systemPrompt,
        history,
        task: config.task,
        preferredModel: config.model || undefined,
        maxTokens: config.maxTokens,
        temperature: 0.2,
        clientProfile: { app: 'pmo', channel: 'text' },
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    throw unreachable(error, config)
  }
  interpretStatus(response, config)
  const body = await response.json().catch(() => null)
  return body?.text
}

/** One completion from the configured provider. Throws an Error with a safe message. */
export const chat = async ({ config, messages, fetchImpl = globalThis.fetch }) => {
  const text = await (config.provider === 'airouter' ? chatAiRouter : chatOpenAiCompatible)({ config, messages, fetchImpl })
  if (typeof text !== 'string' || !text.trim()) throw fail('empty', 'The model returned no text.')
  return text
}

/**
 * Asks the model one tiny question, to learn whether the key, model and address
 * work. Never throws. A rejected key or an unknown model is a definite no; an
 * outage, timeout or rate limit proves nothing either way, so it is "unverified".
 * @returns {Promise<{ state: 'ready' | 'rejected' | 'not_found' | 'unverified', message?: string }>}
 */
export const verifyKey = async ({ config, fetchImpl }) => {
  try {
    await chat({
      config: { ...config, maxTokens: 16, timeoutMs: Math.min(config.timeoutMs, VALIDATION.timeoutMs) },
      messages: [{ role: 'user', content: 'Reply with the word ok.' }],
      fetchImpl,
    })
    return { state: 'ready' }
  } catch (error) {
    if (error.code === 'empty') return { state: 'ready' }
    if (error.code === 'rejected' || error.code === 'not_found') return { state: error.code, message: error.message }
    return { state: 'unverified', message: error.message }
  }
}

/**
 * @param {{ getConfig: () => object, loadKnowledge: () => string,
 *   fetchImpl?: typeof fetch, now?: () => number, newId?: () => string, newMarker?: () => string }} deps
 */
export const createAgentService = ({ getConfig, loadKnowledge, loadEntities = null, fetchImpl, now = Date.now, newId = randomUUID, newMarker = () => `pmo-${randomUUID()}` }) => {
  const marker = newMarker()
  const sessions = new Map()
  const recent = []
  /** The latest key check. Keyed by a digest, so changing the provider, key, model or address checks again and the key is never held here. */
  let last = null

  const verified = (config) => {
    const id = createHash('sha256').update([config.provider, config.url, config.baseUrl, config.model, config.task, config.secret()].join('\n')).digest('hex')
    if (last?.id === id) {
      if (last.pending) return last.pending
      if (now() - last.at < (last.result.state === 'ready' ? VALIDATION.readyMs : VALIDATION.retryMs)) return Promise.resolve(last.result)
    }
    const entry = { id, at: now(), pending: null, result: null }
    entry.pending = verifyKey({ config, fetchImpl }).then((result) => { entry.result = result; entry.at = now(); entry.pending = null; return result })
    last = entry
    return entry.pending
  }

  const sweep = () => {
    const cutoff = now() - LIMITS.sessionTtlMs
    for (const [id, session] of sessions) if (session.touched < cutoff) sessions.delete(id)
    while (sessions.size >= LIMITS.sessions) sessions.delete(sessions.keys().next().value)
  }

  const limited = () => {
    const cutoff = now() - 60_000
    while (recent.length && recent[0] < cutoff) recent.shift()
    if (recent.length >= LIMITS.requestsPerMinute) return true
    recent.push(now())
    return false
  }

  const open = (id) => {
    const existing = typeof id === 'string' ? sessions.get(id) : null
    if (existing) return { session: existing, id }
    sweep()
    const created = { system: buildSystemPrompt({ knowledge: loadKnowledge(), marker }), history: [], busy: false, touched: now() }
    const fresh = newId()
    sessions.set(fresh, created)
    return { session: created, id: fresh }
  }

  return {
    /**
     * `configured`: the settings are complete. `ready`: the model accepted the key.
     * `usable`: ready, or not yet provable (outage, rate limit), so asking is still allowed.
     */
    status: async () => {
      const config = getConfig()
      const base = { configured: config.configured, provider: config.provider, model: config.model || (config.provider === 'airouter' ? 'AIRouter default' : ''), source: config.source }
      if (!config.configured) return { ...base, state: 'unconfigured', ready: false, usable: false, issues: [...config.issues] }
      const check = await verified(config)
      return { ...base, state: check.state, ready: check.state === 'ready', usable: check.state === 'ready' || check.state === 'unverified', issues: check.message ? [check.message] : [] }
    },

    /** The exact system prompt a new conversation starts with (for maintainers; it holds no secrets). */
    previewPrompt: () => buildSystemPrompt({ knowledge: loadKnowledge(), marker: '<marker withheld>' }),

    reset: (id) => ({ ok: sessions.delete(id) }),

    async ask({ sessionId, message, route, entityContext }) {
      const config = getConfig()
      if (typeof message !== 'string' || !message.trim()) return { ok: false, status: 400, error: 'Type a question first.' }
      if (message.length > LIMITS.messageChars) return { ok: false, status: 413, error: `Keep the question under ${LIMITS.messageChars} characters.` }
      if (limited()) return { ok: false, status: 429, error: 'Too many questions in a minute. Wait a moment.' }
      try { validateEntityContextIds(entityContext) } catch { return { ok: false, status: 400, error: 'Invalid entity context. Send only ids and snapshot identity.' } }
      let grounding = null
      if (loadEntities) {
        try { grounding = resolveEntityQuestion({ snapshot: await loadEntities(), context: entityContext, message }) }
        catch { return { ok: false, status: 503, error: 'Entity metadata unavailable. Refresh public declarations before asking; no schema answer can be grounded.' } }
      } else if (entityContext) return { ok: false, status: 503, error: 'Entity metadata service unavailable.' }
      if (grounding?.error) return { ok: false, status: grounding.status, error: grounding.error }
      if (grounding?.localReply) return { ok: true, reply: grounding.localReply, entityPin: grounding.pin || null, unverified: false }
      if (!config.configured) return { ok: false, status: 503, error: `The agent is not configured. ${config.issues.join(' ')}`.trim() }
      if (grounding && privateEntityText(message)) return { ok: false, status: 400, error: 'Do not send private values or credentials to schema chat.' }

      const { session, id } = open(sessionId)
      if (session.busy) return { ok: false, status: 409, error: 'The previous question is still being answered.' }
      session.busy = true
      session.touched = now()
      // Context changes discard history before transmission, including retained record/private user text.
      const contextKey = grounding?.key || null
      if (session.entityKey !== contextKey) { session.history = []; session.entityKey = contextKey }
      // Revalidate retained turns before transmission; private-looking provider text is never reused.
      if (grounding) session.history = session.history.filter(turn => !privateEntityText(turn.content))

      const text = neutralise(message).trim()
      const flagged = looksLikeOverride(text)
      const page = typeof route === 'string' && ROUTE.test(route) ? `[PMO page open: ${route}]\n` : ''
      const user = { role: 'user', content: `${page}${text}` }
      const messages = [
        { role: 'system', content: session.system },
        ...(grounding ? [{ role: 'system', content: grounding.prompt }] : []),
        ...session.history.slice(-LIMITS.historyMessages),
        user,
        { role: 'system', content: flagged ? REMINDER_FLAGGED : REMINDER },
      ]
      try {
        const raw = await chat({ config, messages, fetchImpl })
        if (raw.includes(marker)) {
          return { ok: true, sessionId: id, reply: 'That reply was withheld because it would have exposed the agent\'s internal instructions. Ask about the plan, a step, a module or the git rules.', flagged: true }
        }
        const checked = grounding ? verifyEntityReply(neutralise(raw).slice(0, LIMITS.replyChars), grounding) : null
        const reply = checked ? checked.reply : neutralise(raw).slice(0, LIMITS.replyChars)
        session.history.push(user, { role: 'assistant', content: reply })
        if (session.history.length > LIMITS.historyMessages) session.history.splice(0, session.history.length - LIMITS.historyMessages)
        return { ok: true, sessionId: id, reply, flagged, ...(grounding ? { entityPin: grounding.pin, unverified: checked.unverified } : {}) }
      } catch (error) {
        if (error.code === 'rejected' || error.code === 'not_found') last = null
        return { ok: false, status: 502, error: error.message, code: error.code, sessionId: id }
      } finally {
        session.busy = false
        session.touched = now()
      }
    },
  }
}
