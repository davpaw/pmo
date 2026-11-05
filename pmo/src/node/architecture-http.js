import { Worker } from 'node:worker_threads'

/** A worker bounds scan CPU time and keeps the PMO server responsive. */
export const runArchitectureScan = root => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./architecture-worker.js', import.meta.url), { workerData: { root }, resourceLimits: { maxOldGenerationSizeMb: 256 } })
  const timer = setTimeout(() => { worker.terminate(); reject(Error('Architecture scan timed out; narrow module ownership or reduce source size.')) }, 20000)
  const done = () => clearTimeout(timer)
  worker.once('message', result => { done(); result.ok ? resolve(result.graph) : reject(Object.assign(Error(result.error), { public: true })) })
  worker.once('error', () => { done(); reject(Error('Architecture scanner unavailable.')) })
  worker.once('exit', code => { done(); if (code !== 0) reject(Error('Architecture scanner stopped before completing.')) })
})
export const createArchitectureService = ({ scan, now = Date.now }) => {
  let graph = null, pending = null
  const recent = []
  return { read(refresh = false) {
    if (pending) return pending
    if (graph && !refresh) return Promise.resolve(graph)
    while (recent.length && recent[0] <= now() - 60000) recent.shift()
    if (recent.length >= 12) return Promise.reject(Object.assign(Error('Too many architecture scans. Try again in a minute.'), { status: 429 }))
    recent.push(now())
    pending = Promise.resolve().then(scan).then(result => { graph = result; return result }).finally(() => { pending = null })
    return pending
  } }
}
export const createArchitectureMiddleware = ({ service }) => async (req, res, next) => {
  if (String(req.url).split('?')[0] !== '/api/pmo/architecture') return next()
  const send = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.end(JSON.stringify(body)) }
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '')) return send(403, { error: 'Architecture scans are local only.' })
  if (req.headers.origin) {
    try { const origin = new URL(req.headers.origin); if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) return send(403, { error: 'Use the local PMO origin.' }) } catch { return send(403, { error: 'Invalid origin.' }) }
  }
  if (!['GET', 'POST'].includes(req.method)) return send(405, { error: 'Use GET or POST.' })
  // No paths, commands, model output or request body ever configure the scan.
  if (req.method === 'POST' && (req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) !== 0)) return send(400, { error: 'Refresh accepts no request body.' })
  try { send(200, { graph: await service.read(req.method === 'POST') }) }
  catch (error) { send(error.status ?? 503, { error: error.public ? error.message : error.status === 429 ? error.message : 'Architecture scan failed. Check module declarations and architecture.json, scan limits and server availability. The previous diagram is unchanged.' }) }
}
export const pmoArchitecturePlugin = ({ root }) => {
  const service = createArchitectureService({ scan: () => runArchitectureScan(root) })
  const middleware = createArchitectureMiddleware({ service })
  const attach = server => { server.middlewares.use(middleware) }
  return { name: 'pmo-architecture', configureServer: attach, configurePreviewServer: attach }
}
