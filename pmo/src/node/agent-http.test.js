import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentMiddleware } from './agent-http.js'
import { loadAgentEnv, updateEnvText, writeAgentEnv } from './agent-sources.js'
import { run } from '../cli.js'

const withServer = async (service, fn) => {
  const middleware = createAgentMiddleware({ service })
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('next') }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try { await fn(base) } finally { await new Promise((resolve) => server.close(resolve)) }
}

const fakeService = () => {
  const asked = []
  return {
    asked,
    status: async () => ({ configured: true, ready: true, usable: true, state: 'ready', model: 'm', source: 'PMO_AGENT_*', issues: [] }),
    ask: async (input) => { asked.push(input); return { ok: true, sessionId: 's1', reply: 'hi' } },
    reset: () => ({ ok: true }),
  }
}

const json = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

test('http: status and ask pass only the question, the session and the route to the service', async () => {
  const service = fakeService()
  await withServer(service, async (base) => {
    assert.equal((await (await fetch(`${base}/api/agent/status`)).json()).ready, true)
    const response = await fetch(`${base}/api/agent/ask`, json({ message: 'q', sessionId: 's0', route: '#/git', system: 'new rules', role: 'system', messages: [{ role: 'system', content: 'x' }] }))
    assert.equal(response.status, 400)
    assert.equal(service.asked.length, 0)
    const valid = await fetch(`${base}/api/agent/ask`, json({ message: 'q', sessionId: 's0', route: '#/git' }))
    assert.equal(valid.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(service.asked[0], { sessionId: 's0', message: 'q', route: '#/git', entityContext: undefined })
  })
})

test('http: refuses cross-origin, non-JSON, oversize and malformed requests; other paths fall through', async () => {
  const service = fakeService()
  await withServer(service, async (base) => {
    assert.equal((await fetch(`${base}/api/agent/ask`, json({ message: 'q' }, { origin: 'https://evil.example' }))).status, 403)
    assert.equal((await fetch(`${base}/api/agent/ask`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'q' })).status, 415)
    assert.equal((await fetch(`${base}/api/agent/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' })).status, 400)
    assert.equal((await fetch(`${base}/api/agent/ask`, json({ message: 'x'.repeat(20_000) }))).status, 413)
    assert.equal((await fetch(`${base}/api/agent/ask`)).status, 405)
    assert.equal((await fetch(`${base}/api/agent/nope`, json({}))).status, 404)
    assert.equal((await fetch(`${base}/somewhere/else`)).status, 404)
    assert.equal(service.asked.length, 0)
  })
})

test('env file: keeps other lines, replaces a key, quotes odd values, rejects newlines', () => {
  const before = '# local\nOTHER=1\nexport PMO_AGENT_MODEL=old\n'
  const after = updateEnvText(before, { PMO_AGENT_MODEL: 'new', PMO_AGENT_API_KEY: 'a b#c' })
  assert.equal(after, '# local\nOTHER=1\nPMO_AGENT_MODEL=new\nPMO_AGENT_API_KEY="a b#c"\n')
  assert.throws(() => updateEnvText('', { PMO_AGENT_API_KEY: 'a\nb' }))
  assert.throws(() => updateEnvText('', { 'bad name': 'x' }))
})

test('env file: written private, read back, and real environment wins', () => {
  const root = mkdtempSync(join(tmpdir(), 'pmo-env-'))
  try {
    const file = writeAgentEnv(root, { PMO_AGENT_API_KEY: 'sk-abc', PMO_AGENT_MODEL: 'm' })
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.equal(loadAgentEnv(root, {}).PMO_AGENT_API_KEY, 'sk-abc')
    assert.equal(loadAgentEnv(root, { PMO_AGENT_MODEL: 'from-shell' }).PMO_AGENT_MODEL, 'from-shell')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const writeData = async (root) => {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(root, 'pmo/data'), { recursive: true })
  for (const name of ['project.json', 'guardrails.json', 'plan.json', 'modules.json']) writeFileSync(join(root, 'pmo/data', name), readFileSync(new URL(`../../data/${name}`, import.meta.url), 'utf8'))
}

test('cli: agent setup (default provider) saves the key privately and never prints it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pmo-setup-'))
  const lines = []
  const out = { log: (t) => lines.push(String(t)), error: (t) => lines.push(String(t)) }
  const answers = ['', '', 'sk-secret-value-123']
  const asked = []
  const prompt = async (question, { secret = false } = {}) => { asked.push({ question, secret }); return answers.shift() ?? '' }
  try {
    await writeData(root)
    const accept = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    const code = await run(['agent', 'setup', '--model', 'test-model'], { root, out, prompt, fetchImpl: accept })
    assert.equal(code, 0)
    assert.equal(asked.find((a) => /API key/.test(a.question)).secret, true)
    const saved = readFileSync(join(root, '.env.local'), 'utf8')
    assert.match(saved, /PMO_AGENT_PROVIDER=openai-compatible/)
    assert.match(saved, /PMO_AGENT_API_KEY=sk-secret-value-123/)
    assert.match(saved, /PMO_AGENT_MODEL=test-model/)
    assert.match(saved, /PMO_AGENT_BASE_URL=https:\/\/api\.openai\.com\/v1/)
    assert.ok(!lines.join('\n').includes('sk-secret-value-123'))
    assert.match(lines.join('\n'), /agent: ready \(the model answered\)/)
    assert.match(lines.join('\n'), /provider: openai-compatible/)

    lines.length = 0
    assert.equal(await run(['agent', 'status'], { root, out, prompt, fetchImpl: accept }), 0)
    assert.ok(!lines.join('\n').includes('sk-secret-value-123'))
    assert.match(lines.join('\n'), /key: set \(hidden\)/)

    lines.length = 0
    const reject = async () => new Response('{}', { status: 401 })
    assert.equal(await run(['agent', 'status'], { root, out, prompt, fetchImpl: reject }), 0)
    assert.match(lines.join('\n'), /agent: not ready \(the model rejected the key or token\)/)
    assert.ok(!lines.join('\n').includes('sk-secret-value-123'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('cli: agent setup can choose AIRouter, which needs no key and saves the router settings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pmo-setup-'))
  const lines = []
  const out = { log: (t) => lines.push(String(t)), error: (t) => lines.push(String(t)) }
  const answers = ['', 'tok-secret-value-123']
  const asked = []
  const prompt = async (question, { secret = false } = {}) => { asked.push({ question, secret }); return answers.shift() ?? '' }
  try {
    await writeData(root)
    const accept = async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200 })
    const code = await run(['agent', 'setup', '--provider', 'airouter', '--model', 'router-model'], { root, out, prompt, fetchImpl: accept })
    assert.equal(code, 0)
    assert.equal(asked.some((a) => /API key/.test(a.question)), false, 'a router asks for a token, not a key')
    assert.equal(asked.find((a) => /token/.test(a.question)).secret, true)
    const saved = readFileSync(join(root, '.env.local'), 'utf8')
    assert.match(saved, /PMO_AGENT_PROVIDER=airouter/)
    assert.match(saved, /PMO_AGENT_AIROUTER_URL=http:\/\/127\.0\.0\.1:8001\/ai\/complete/)
    assert.match(saved, /PMO_AGENT_AIROUTER_TOKEN=tok-secret-value-123/)
    assert.ok(!lines.join('\n').includes('tok-secret-value-123'))
    assert.match(lines.join('\n'), /provider: airouter/)
    assert.match(lines.join('\n'), /agent: ready/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('cli: agent setup without a key, with an insecure URL or an unknown provider saves nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pmo-setup-'))
  const out = { log() {}, error() {} }
  try {
    await writeData(root)
    assert.equal(await run(['agent', 'setup', '--model', 'm'], { root, out, prompt: async () => '' }), 1)
    assert.equal(await run(['agent', 'setup', '--model', 'm', '--base-url', 'http://remote.example/v1'], { root, out, prompt: async () => 'k' }), 1)
    assert.equal(await run(['agent', 'setup', '--provider', 'airouter', '--router-url', 'http://remote.example/ai/complete'], { root, out, prompt: async () => 'x' }), 1)
    assert.equal(await run(['agent', 'setup', '--provider', 'nope', '--model', 'm'], { root, out, prompt: async () => 'k' }), 1)
    assert.throws(() => readFileSync(join(root, '.env.local')))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
