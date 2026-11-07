/**
 * HTTP for the PMO Agent, as middleware for the Vite dev and preview servers.
 *
 *   GET  /api/agent/status   { configured, ready, usable, state, model, source, issues }  (never the key;
 *                            ready means the model accepted the key)
 *   POST /api/agent/ask      { sessionId?, message, route? } -> { ok, reply, sessionId, flagged }
 *   POST /api/agent/reset    { sessionId }
 *
 * Same-origin only: a request that names a different Origin is refused, and
 * bodies must be small JSON. The service builds the prompt; nothing in a
 * request can reach it.
 */

import { createAgentService } from '../agent/service.js'
import { resolveAgentConfig } from '../agent/config.js'
import { loadAgentEnv, loadKnowledge } from './agent-sources.js'
import { createEntityService, runEntityScan } from './entity-http.js'

const MAX_BODY = 16 * 1024

const send = (res, status, body) => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(body))
}

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0
  let refused = false
  const chunks = []
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > MAX_BODY) {
      if (!refused) reject(Object.assign(new Error('Request too large.'), { status: 413 }))
      refused = true
    } else if (!refused) chunks.push(chunk)
  })
  req.on('end', () => {
    if (refused) return
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(Object.assign(new Error('Send JSON.'), { status: 400 })) }
  })
  req.on('error', reject)
})

const sameOrigin = (req) => {
  const origin = req.headers.origin
  if (!origin) return true
  try { return new URL(origin).host === req.headers.host } catch { return false }
}

export const createAgentMiddleware = ({ service }) => async (req, res, next) => {
  const path = (req.url ?? '').split('?')[0]
  if (!path.startsWith('/api/agent/')) return next()
  try {
    if (!sameOrigin(req)) return send(res, 403, { ok: false, error: 'Cross-origin requests are not accepted.' })
    if (path === '/api/agent/status' && req.method === 'GET') return send(res, 200, await service.status())
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Use POST.' })
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return send(res, 415, { ok: false, error: 'Send application/json.' })
    const body = await readBody(req)
    if (path === '/api/agent/ask') {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['sessionId', 'message', 'route', 'entityContext'].includes(k))) return send(res, 400, { ok: false, error: 'Send only message/session/route and stable entity context ids.' })
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '')) return send(res, 403, { ok: false, error: 'PMO questions and entity context are local only.' })
      const result = await service.ask({ sessionId: body.sessionId, message: body.message, route: body.route, entityContext: body.entityContext })
      return send(res, result.ok ? 200 : result.status ?? 500, result)
    }
    if (path === '/api/agent/reset') return send(res, 200, service.reset(body.sessionId))
    return send(res, 404, { ok: false, error: 'Unknown agent route.' })
  } catch (error) {
    return send(res, error.status ?? 500, { ok: false, error: error.status ? error.message : 'The agent hit an error.' })
  }
}

/** A Vite plugin that serves the agent from the dev and preview servers. */
export const pmoAgentPlugin = ({ root, entityService = createEntityService({ scan: () => runEntityScan(root) }) }) => {
  const service = createAgentService({
    getConfig: () => resolveAgentConfig(loadAgentEnv(root)),
    loadKnowledge: () => loadKnowledge(root),
    loadEntities: () => entityService.read(true),
  })
  const middleware = createAgentMiddleware({ service })
  // Return nothing: Vite treats a returned function as a post-middleware hook.
  const attach = (server) => { server.middlewares.use(middleware) }
  return { name: 'pmo-agent', configureServer: attach, configurePreviewServer: attach }
}
