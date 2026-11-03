import test from 'node:test'
import assert from 'node:assert/strict'
import { createPrMiddleware } from './pr-http.js'
const call = (changes = {}) => {
  let syncs = 0, status, body
  const middleware = createPrMiddleware({ load: () => null, sync: () => { syncs++; return { ok: true } } })
  const req = { url: '/api/pmo/prs', method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:5199', origin: 'http://localhost:5199', 'content-type': 'application/json' }, ...changes }
  const res = { set statusCode(value) { status = value }, setHeader() {}, end(value) { body = JSON.parse(value) } }
  middleware(req, res, () => { status = 404 })
  return { syncs, status, body }
}
test('local same-origin PR sync is available; remote, rebinding and cross-origin requests are refused', () => {
  assert.equal(call().syncs, 1)
  assert.equal(call({ socket: { remoteAddress: '192.0.2.1' } }).status, 403)
  assert.equal(call({ headers: { host: 'evil.example', origin: 'http://evil.example' } }).status, 403)
  assert.equal(call({ headers: { host: 'localhost:5199', origin: 'https://evil.example' } }).status, 403)
  assert.equal(call({ method: 'DELETE' }).status, 405)
})
