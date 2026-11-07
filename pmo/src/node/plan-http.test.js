import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { Readable } from 'node:stream'
import { createPlanEditor, createPlanMiddleware, pmoPlanPlugin } from './plan-http.js'
import { git } from './git.js'

const draft = { title: 'New', summary: 'Local plan', modules: ['pmo'], effort: { size: 'S' }, risk: { level: 'low', notes: 'isolated' }, value: { score: 3, why: 'review' }, acceptance: ['valid'], onboarding: 'none' }
const fixture = (t, directory = 'pmo') => {
  const parent = mkdtempSync(join(tmpdir(), 'pmo-browser-'))
  const root = join(parent, 'repo')
  mkdirSync(root)
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const sh = (...args) => git(root, args)
  sh('init', '-q', '-b', 'main'); sh('config', 'user.email', 'test@example.com'); sh('config', 'user.name', 'Test'); sh('config', 'commit.gpgsign', 'false')
  const write = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2)) }
  const path = `${directory}/data/plan.json`
  write(path, { version: 1, workstreams: [{ id: '1', title: 'W', summary: 's', epics: [{ id: '1.1', title: 'E', summary: 's', steps: [{ ...draft, id: '1.1.1', status: 'roadmap' }] }] }] })
  write(`${directory}/data/project.json`, { remote: 'origin', mainBranch: 'main', branching: { protected: ['main'], plan: '^plan/([a-z0-9][a-z0-9-]{0,48})$', step: '^step/(\\d+\\.\\d+\\.\\d+)-(.+)$', release: '^release/(.+)$' } })
  write(`${directory}/data/catalog.generated.json`, { modules: [{ id: 'pmo' }] })
  sh('add', '.'); sh('commit', '-qm', 'initial'); sh('update-ref', 'refs/remotes/origin/main', 'HEAD')
  let clock = 0
  const editor = createPlanEditor({ root, now: () => clock })
  const request = { operation: 'add', target: '1.1', slug: 'review', changes: draft }
  return { root, path, write, sh, editor, request, advance: () => { clock += 300001 } }
}
test('preview writes nothing; confirmed edit creates a new plan branch/worktree only', t => {
  const s = fixture(t)
  const before = readFileSync(join(s.root, s.path), 'utf8'), head = s.sh('rev-parse', 'HEAD')
  const p = s.editor.preview(s.request)
  assert.equal(s.sh('status', '--porcelain'), '')
  assert.equal(s.sh('branch', '--list', 'plan/review'), '')
  assert.throws(() => s.editor.confirm({ token: p.token }), /confirmation/)
  const saved = s.editor.confirm({ token: p.token, confirmed: true })
  assert.equal(git(saved.worktree, ['branch', '--show-current']), 'plan/review')
  assert.equal(git(saved.worktree, ['diff', '--name-only']), s.path)
  assert.equal(s.sh('rev-parse', 'HEAD'), head)
  assert.equal(s.sh('status', '--porcelain'), '')
  assert.equal(readFileSync(join(s.root, s.path), 'utf8'), before)
  assert.throws(() => s.editor.confirm({ token: p.token, confirmed: true }), /already used/)
  assert.throws(() => s.editor.preview(s.request), /already exists/)
})
test('attached host path works and unrelated dirty worktrees are preserved', t => {
  const s = fixture(t, 'packages/pmo')
  const other = join(dirname(s.root), 'other')
  s.sh('worktree', 'add', '-b', 'step/9.9.9-other', other, 'HEAD')
  writeFileSync(join(other, 'unfinished.txt'), 'preserve me')
  const p = s.editor.preview(s.request)
  const saved = s.editor.confirm({ token: p.token, confirmed: true })
  assert.equal(saved.path, 'packages/pmo/data/plan.json')
  assert.equal(readFileSync(join(other, 'unfinished.txt'), 'utf8'), 'preserve me')
})
test('dirty, stale, expired, invalid and unknown previews never create branches', t => {
  const s = fixture(t)
  assert.throws(() => s.editor.preview({ ...s.request, slug: '../escape' }))
  assert.throws(() => s.editor.preview({ ...s.request, changes: { title: 'bad' } }))
  const p = s.editor.preview(s.request); s.advance()
  assert.throws(() => s.editor.confirm({ token: p.token, confirmed: true }), /expired/)
  const q = s.editor.preview(s.request)
  s.sh('commit', '--allow-empty', '-qm', 'move head')
  assert.throws(() => s.editor.confirm({ token: q.token, confirmed: true }), /changed/)
  const r = s.editor.preview(s.request)
  s.write('dirty.txt', 'unfinished')
  assert.throws(() => s.editor.confirm({ token: r.token, confirmed: true }), /uncommitted/)
  assert.throws(() => s.editor.preview(s.request), /uncommitted/)
  assert.equal(s.sh('branch', '--list', 'plan/review'), '')
})
const http = async (middleware, overrides = {}, body = '{}') => {
  const req = Readable.from([body])
  Object.assign(req, { url: '/api/pmo/plan/preview', method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:5299', origin: 'http://localhost:5299', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, ...overrides })
  let result
  const res = { setHeader() {}, end(value) { result = { code: this.statusCode, body: JSON.parse(value) } } }
  await middleware(req, res, () => { result = { next: true } })
  return result
}
test('HTTP requires bounded loopback same-origin JSON and explicit confirmation', async () => {
  let calls = 0
  const middleware = createPlanMiddleware({ editor: { preview: () => { calls++; return {} }, confirm: r => { if (r.confirmed !== true) throw Error('confirmation'); calls++; return {} }, read: () => ({ plan: {} }) } })
  assert.equal((await http(middleware)).code, 200)
  for (const headers of [{ host: 'evil.test', origin: 'http://evil.test' }, { host: 'localhost:5299', origin: 'http://evil.test', 'content-type': 'application/json' }, { host: 'localhost:5299', 'content-type': 'application/json' }, { host: 'localhost:5299', origin: 'http://localhost:5299', 'content-type': 'text/plain' }, { host: 'localhost:5299', origin: 'http://localhost:5299', 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }]) assert.equal((await http(middleware, { headers })).code, 403)
  assert.equal((await http(middleware, { socket: { remoteAddress: '192.0.2.1' } })).code, 403)
  assert.equal((await http(middleware, {}, 'x'.repeat(128 * 1024 + 1))).code, 413)
  assert.equal((await http(middleware, {}, '{invalid')).code, 400)
  assert.equal((await http(middleware, { url: '/api/pmo/plan/confirm' })).code, 400)
  assert.equal((await http(middleware, { method: 'DELETE' })).code, 405)
  assert.deepEqual(await http(middleware, { url: '/elsewhere' }), { next: true })
  assert.equal(calls, 1)
  assert.equal(pmoPlanPlugin({ root: '/not-used' }).configurePreviewServer, undefined)
})