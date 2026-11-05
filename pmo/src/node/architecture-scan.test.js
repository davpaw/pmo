import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { scanArchitecture, SCAN_LIMITS } from './architecture-scan.js'

const fixture = t => {
  const root = mkdtempSync(join(tmpdir(), 'pmo-architecture-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q'], { cwd: root })
  const put = (file, value) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), typeof value === 'string' ? value : JSON.stringify(value)) }
  const modules = { api: { title: 'API', owns: ['api/**'], dependsOn: ['store'] }, store: { title: 'Storage', owns: ['store/**'] }, future: { title: 'Future', owns: ['future/**'] } }
  put('pmo/data/modules.json', { modules })
  put('api/server.ts', `import { read } from '../store/index.js';\nimport { writeFileSync } from 'node:fs';\nimport { createCipheriv } from 'node:crypto';\napp.get('/items', handler);\nfetch('https://user:password@example.com/private?token=hide-me');\nwriteFileSync('data/items.json', '{}');\ncreateCipheriv('aes-256-gcm', key, iv);\nfetch(dynamicUrl);`)
  put('store/index.ts', 'export const read = () => [];')
  put('api/package.json', { dependencies: { pg: '1.0' } })
  return { root, put, modules, scan: () => scanArchitecture({ root }) }
}
test('host modules, imports, services, persistence and security retain evidence without leaking credentials', t => {
  const f = fixture(t), graph = f.scan()
  assert.equal(graph.version, 1)
  assert.ok(graph.edges.some(e => e.source === 'module:api' && e.target === 'module:store' && e.label === 'depends on'))
  assert.ok(graph.edges.some(e => e.source === 'module:api' && e.target === 'module:store' && e.label === 'imports'))
  for (const kind of ['offered', 'called', 'persistence', 'integration', 'package']) assert.ok(graph.nodes.some(n => n.kind === kind), kind)
  assert.equal(graph.nodes.find(n => n.kind === 'called').security.transit.keyBits, null)
  assert.equal(graph.nodes.find(n => n.kind === 'persistence').location, 'data/items.json')
  assert.equal(graph.nodes.find(n => n.id === 'module:future').planned, true)
  assert.equal(graph.nodes.find(n => n.id === 'module:api').security.atRest.status, 'unknown')
  assert.equal(graph.nodes.find(n => n.id === 'module:api').securityObservations[0].keyBits, 256)
  assert.ok(graph.coverage.unresolved > 0)
  assert.ok(graph.nodes.every(n => n.security && n.evidence.length))
  assert.ok(graph.edges.every(e => e.security && e.evidence.length))
  assert.doesNotMatch(JSON.stringify(graph), /password|hide-me|private\?|createCipheriv/)
})
test('refresh reads additions, edits, deletions, declarations and cycles afresh', t => {
  const f = fixture(t), first = f.scan()
  f.put('api/server.ts', "app.post('/new', handler)")
  f.put('store/index.ts', "import '../api/server.js'")
  f.modules.store.dependsOn = ['api']
  f.put('pmo/data/modules.json', { modules: f.modules })
  const second = f.scan()
  assert.ok(second.nodes.some(n => n.label === 'POST /new'))
  assert.ok(!second.nodes.some(n => n.label === 'GET /items'))
  assert.ok(!second.edges.some(e => e.source === 'module:api' && e.label === 'imports'))
  assert.ok(second.edges.some(e => e.source === 'module:store' && e.target === 'module:api'))
  rmSync(join(f.root, 'api/server.ts')); rmSync(join(f.root, 'api/package.json'))
  const third = f.scan()
  assert.equal(third.nodes.find(n => n.id === 'module:api').planned, true)
  assert.ok(!third.nodes.some(n => n.kind === 'offered'))
  assert.equal(first.nodes.find(n => n.id === 'module:api').id, third.nodes.find(n => n.id === 'module:api').id)
})
test('scan excludes ignored tracked files, symlink files/directories, binaries and secret files', t => {
  const f = fixture(t)
  f.put('api/hidden.js', "fetch('https://hidden.example')")
  execFileSync('git', ['add', 'api/hidden.js'], { cwd: f.root })
  f.put('.gitignore', 'api/hidden.js\n')
  f.put('api/.env.local', 'DO_NOT_LEAK=secret')
  f.put('api/credentials.js', "fetch('https://credential.example')")
  f.put('api/binary.js', "\0fetch('https://binary.example')")
  const outside = mkdtempSync(join(tmpdir(), 'outside-architecture-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  writeFileSync(join(outside, 'outside.js'), "fetch('https://outside.example')")
  symlinkSync(join(outside, 'outside.js'), join(f.root, 'api/link.js'))
  symlinkSync(outside, join(f.root, 'api/links'))
  const graph = f.scan()
  assert.doesNotMatch(JSON.stringify(graph), /hidden.example|credential.example|binary.example|outside.example|DO_NOT_LEAK/)
  assert.ok(graph.coverage.skipped >= 2)
})
test('metadata declares public security and locations, validates types and warns about stale references', t => {
  const f = fixture(t)
  f.put('pmo/data/architecture.json', { version: 1, security: { transit: { status: 'declared', type: 'TLS 1.3', keyBits: null } }, nodes: [{ id: 'module:api', kind: 'module', label: 'API', security: { atRest: { status: 'declared', type: 'AES-256', keyBits: 256 } } }, { id: 'database', kind: 'persistence', label: 'Postgres', module: 'module:store', location: 'us-east-1', security: { authentication: 'IAM' } }], edges: [{ id: 'stale', source: 'removed', target: 'database', label: 'calls' }] })
  const graph = f.scan()
  assert.equal(graph.security.transit.type, 'TLS 1.3')
  assert.equal(graph.nodes.find(n => n.id === 'database').location, 'us-east-1')
  assert.equal(graph.nodes.find(n => n.id === 'module:api').security.atRest.keyBits, 256)
  assert.ok(graph.warnings.some(w => /unresolved connection/.test(w)))
  f.put('pmo/data/architecture.json', { version: 1, nodes: [], edges: [], privateKey: 'do not expose' })
  assert.throws(f.scan, /requires version 1/)
})
test('scan caps report partial coverage and unsafe module metadata fails closed', t => {
  const f = fixture(t)
  assert.equal(scanArchitecture({ root: f.root, limits: { ...SCAN_LIMITS, files: 1 } }).coverage.truncated, true)
  f.put('api/unsupported.py', 'app.get("/python")')
  assert.equal(f.scan().coverage.unsupported, 1)
  rmSync(join(f.root, 'pmo/data/modules.json'))
  symlinkSync(join(f.root, 'api/package.json'), join(f.root, 'pmo/data/modules.json'))
  assert.throws(f.scan, /safe, bounded/)
})

test('malformed URLs and dynamic paths are coverage gaps, not scan failures', t => {
  const f = fixture(t)
  f.put('api/server.ts', "fetch('https://'); fetch(dynamic); app.get('/items', handler); fetch('/items');")
  const graph = f.scan()
  assert.ok(graph.coverage.unresolved >= 2)
  assert.ok(graph.edges.some(e => e.label === 'matching route (unverified)'))
})

test('resource encryption does not silently assert connection encryption; location queries are withheld', t => {
  const f = fixture(t)
  f.put('pmo/data/architecture.json', { version: 1, nodes: [{ id: 'db', kind: 'persistence', label: 'Database', module: 'module:api', location: 'data/db.sqlite?password=private-value', security: { atRest: { status: 'declared', type: 'AES-256', keyBits: 256 } } }], edges: [] })
  const g = f.scan()
  assert.equal(g.nodes.find(n => n.id === 'db').security.atRest.keyBits, 256)
  assert.equal(g.edges.find(e => e.target === 'db').security.atRest.status, 'unknown')
  assert.doesNotMatch(JSON.stringify(g), /private-value/)
})
