import { pmoDirectory } from './paths.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRepositoryState } from './repository-state.js'

export const createRepositoryMiddleware = ({ read }) => (req, res, next) => {
  if (String(req.url).split('?')[0] !== '/api/pmo/repository') return next()
  const send = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.end(JSON.stringify(body)) }
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '')) return send(403, { error: 'Repository refresh is local only.' })
  if (req.headers.origin) {
    try { const origin = new URL(req.headers.origin); if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) return send(403, { error: 'Use the local PMO origin.' }) } catch { return send(403, { error: 'Invalid origin.' }) }
  }
  if (req.method !== 'GET') return send(405, { error: 'Use GET.' })
  try { return send(200, { repository: read() }) } catch { return send(503, { error: 'Local repository refresh unavailable.' }) }
}
export const pmoRepositoryPlugin = ({ root }) => {
  const middleware = createRepositoryMiddleware({ read: () => buildRepositoryState({ root, project: JSON.parse(readFileSync(join(root, pmoDirectory(root), 'data/project.json'), 'utf8')) }) })
  const attach = server => { server.middlewares.use(middleware) }
  return { name: 'pmo-repository', configureServer: attach, configurePreviewServer: attach }
}
