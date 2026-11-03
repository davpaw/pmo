import { pmoDirectory } from './paths.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPrState, syncPullRequests } from './pull-requests.js'
import { prStateFresh } from '../pull-requests.js'
const local = (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
export const createPrMiddleware = ({ load, sync }) => (req, res, next) => {
  if (String(req.url).split('?')[0] !== '/api/pmo/prs') return next()
  const send = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.end(JSON.stringify(body)) }
  if (!local(req.socket?.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '')) return send(403, { error: 'PR sync is available on this machine only.' })
  if (req.headers.origin) {
    try { const origin = new URL(req.headers.origin); if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) return send(403, { error: 'Use the local PMO origin.' }) } catch { return send(403, { error: 'Invalid origin.' }) }
  }
  if (!['GET', 'POST'].includes(req.method)) return send(405, { error: 'Use GET or POST.' })
  if (req.method === 'POST' && !/^application\/json\b/.test(req.headers['content-type'] || '')) return send(415, { error: 'Send application/json.' })
  try {
    const cached = load()
    const state = req.method === 'POST' || !prStateFresh(cached) ? sync() : cached
    return send(200, { pullRequests: state })
  } catch { return send(503, { error: 'PR sync unavailable. Run npm run pmo -- prs sync locally.' }) }
}
export const pmoPrPlugin = ({ root }) => {
  const data = (file) => JSON.parse(readFileSync(join(root, pmoDirectory(root), 'data', file), 'utf8'))
  const middleware = createPrMiddleware({ load: () => readPrState(root), sync: () => syncPullRequests({ root, project: data('project.json'), plan: data('plan.json') }) })
  const attach = (server) => { server.middlewares.use(middleware) }
  return { name: 'pmo-prs', configureServer: attach, configurePreviewServer: attach }
}
