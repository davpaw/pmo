import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepositoryMiddleware, pmoRepositoryPlugin } from './repository-http.js'
const call = (changes = {}, fail = false) => {
  let reads = 0, status, body
  const headers = {}
  const middleware = createRepositoryMiddleware({ read: () => { reads++; if (fail) throw Error('credential details'); return { branch: 'main' } } })
  const req = { url: '/api/pmo/repository', method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:5199', origin: 'http://localhost:5199' }, ...changes }
  middleware(req, { set statusCode(value) { status = value }, setHeader(key, value) { headers[key] = value }, end(value) { body = JSON.parse(value) } }, () => { status = 404 })
  return { reads, status, body, headers }
}
test('local repository refresh reads fresh metadata, ignores client parameters and prevents caching', () => {
  const response = call({ url: '/api/pmo/repository?root=/elsewhere&command=delete' })
  assert.equal(response.status, 200)
  assert.equal(response.reads, 1)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(call({ url: '/unrelated' }).reads, 0)
})
test('remote, rebinding, cross-origin and mutation requests never read repository facts', () => {
  for (const changes of [{ socket: { remoteAddress: '192.0.2.1' } }, { headers: { host: 'evil.example' } }, { headers: { host: 'localhost:5199', origin: 'https://evil.example' } }, { method: 'POST' }]) {
    const response = call(changes)
    assert.equal(response.reads, 0)
    assert.ok([403, 405].includes(response.status))
  }
  assert.equal(call({}, true).status, 503)
  assert.doesNotMatch(JSON.stringify(call({}, true).body), /credential/)
})

test('Vite hooks attach middleware without returning it as a post-configuration callback', () => {
  const plugin = pmoRepositoryPlugin({ root: '/unused' })
  let count = 0
  const server = { middlewares: { use: handler => { assert.equal(typeof handler, 'function'); count++; return () => { throw Error('not a post hook') } } } }
  assert.equal(plugin.configureServer(server), undefined)
  assert.equal(plugin.configurePreviewServer(server), undefined)
  assert.equal(count, 2)
})
