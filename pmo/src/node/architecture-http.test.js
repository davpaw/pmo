import test from 'node:test'
import assert from 'node:assert/strict'
import { createArchitectureService, createArchitectureMiddleware } from './architecture-http.js'

test('service coalesces scans, caches reads, refreshes, retains good snapshot on failure and rate limits', async () => {
  let scans = 0, fail = false
  const service = createArchitectureService({ scan: async () => { scans++; if (fail) throw Error('failed'); return { version: scans } } })
  const [a, b] = await Promise.all([service.read(true), service.read(true)])
  assert.equal(scans, 1); assert.deepEqual(a, b)
  assert.equal((await service.read()).version, 1)
  assert.equal((await service.read(true)).version, 2)
  fail = true; await assert.rejects(service.read(true))
  assert.equal((await service.read()).version, 2)
  fail = false
  for (let i = 0; i < 9; i++) await service.read(true)
  await assert.rejects(service.read(true), e => e.status === 429)
})
const call = async (changes = {}, fail = false) => {
  let reads = 0, status, body, refresh
  const headers = {}
  const middleware = createArchitectureMiddleware({ service: { read: async force => { reads++; refresh = force; if (fail) throw Error('secret source content'); return { version: 1 } } } })
  const req = { url: '/api/pmo/architecture', method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:5299', origin: 'http://localhost:5299' }, ...changes }
  await middleware(req, { set statusCode(value) { status = value }, setHeader(key, value) { headers[key] = value }, end(value) { body = JSON.parse(value) } }, () => { status = 404 })
  return { reads, status, body, headers, refresh }
}
test('local endpoint has no client-selected root, refuses cross-origin/bodies and conceals errors', async () => {
  assert.equal((await call()).status, 200)
  assert.equal((await call({ method: 'POST', url: '/api/pmo/architecture?root=/elsewhere' })).refresh, true)
  for (const changes of [{ socket: { remoteAddress: '192.0.2.1' } }, { headers: { host: 'evil.example' } }, { headers: { host: 'localhost:5299', origin: 'https://evil.example' } }, { method: 'DELETE' }, { method: 'POST', headers: { host: 'localhost:5299', 'content-length': '10' } }]) {
    const response = await call(changes); assert.equal(response.reads, 0); assert.ok(response.status >= 400)
  }
  assert.equal((await call()).headers['cache-control'], 'no-store')
  assert.doesNotMatch(JSON.stringify((await call({}, true)).body), /secret source/)
})
