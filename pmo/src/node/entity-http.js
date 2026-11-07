import { Worker } from 'node:worker_threads'
import { createArchitectureService, createArchitectureMiddleware } from './architecture-http.js'
export const runEntityScan = root => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./entity-worker.js', import.meta.url), { workerData: { root }, resourceLimits: { maxOldGenerationSizeMb: 64 } })
  const timer = setTimeout(() => { worker.terminate(); reject(Error('Entity scan timed out.')) }, 10000)
  worker.once('message', result => { clearTimeout(timer); result.ok ? resolve(result.snapshot) : reject(Error('Invalid or unavailable public entity metadata.')) })
  worker.once('error', () => { clearTimeout(timer); reject(Error('Entity scanner unavailable.')) })
  worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(Error('Entity scan stopped.')) })
})
export const createEntityService = options => createArchitectureService(options)
/** Reuse the tested local-only bodyless architecture boundary; expose only a fixed metadata binding. */
export const createEntityMiddleware = ({ service }) => {
  const middleware = createArchitectureMiddleware({ service })
  return (req, res, next) => {
    if (req.url !== '/api/pmo/entities') {
      if (String(req.url).split('?')[0] === '/api/pmo/entities') { res.statusCode = 400; res.end(JSON.stringify({ error: 'Entity requests accept no query parameters.' })); return }
      return next()
    }
    const proxy = Object.create(req); proxy.url = '/api/pmo/architecture'
    const response = Object.create(res)
    response.setHeader = (...args) => res.setHeader(...args)
    response.end = body => { res.statusCode = response.statusCode; const parsed = JSON.parse(body); res.end(JSON.stringify(parsed.graph ? { snapshot: parsed.graph } : { error: 'Public entity metadata unavailable or request rejected.' })) }
    return middleware(proxy, response, next)
  }
}
export const pmoEntityPlugin = ({ root, service = createEntityService({ scan: () => runEntityScan(root) }) }) => {
  const attach = server => { server.middlewares.use(createEntityMiddleware({ service })) }
  return { name: 'pmo-entities', configureServer: attach, configurePreviewServer: attach }
}