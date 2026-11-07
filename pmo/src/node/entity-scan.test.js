import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fixture } from '../entities.test.js'
import { scanEntities, contentIdentity } from './entity-scan.js'
import { createEntityMiddleware, createEntityService, runEntityScan } from './entity-http.js'
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'pmo-entity-'))
  execFileSync('git', ['init', '-q', root]); mkdirSync(join(root, 'pmo/data'), { recursive: true }); mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'pmo/data/plan.json'), '{}')
  const source = '// schema declaration; never evaluated\n', metadata = fixture()
  metadata.entities[0].evidence[0].sha256 = contentIdentity(source)
  writeFileSync(join(root, 'src/person.js'), source)
  const save = () => writeFileSync(join(root, 'pmo/data/entities.json'), JSON.stringify(metadata))
  save(); return { root, metadata, save, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
test('checks source hashes without evaluation; stable identities change with source drift', () => {
  const s = setup()
  try {
    const first = scanEntities(s); assert.equal(first.entities[0].stale, false)
    writeFileSync(join(s.root, 'src/person.js'), 'throw Error("MUST_NOT_EVALUATE")\n')
    const next = scanEntities(s); assert.equal(next.entities[0].stale, true); assert.notEqual(next.identity, first.identity)
    assert.equal(next.entities[0].evidence[0].verifiedCurrentContent, false)
  } finally { s.cleanup() }
})
test('missing metadata is unknown, not a complete empty schema', () => {
  const s = setup()
  try { rmSync(join(s.root, 'pmo/data/entities.json')); const snapshot = scanEntities(s); assert.equal(snapshot.entities.length, 0); assert.equal(snapshot.coverage.unresolved, 1) } finally { s.cleanup() }
})
test('rejects metadata symlink and oversize; ignored and symlink evidence is unresolved', () => {
  const s = setup()
  try {
    rmSync(join(s.root, 'src/person.js')); symlinkSync(join(s.root, 'pmo/data/plan.json'), join(s.root, 'src/person.js'))
    assert.equal(scanEntities(s).entities[0].stale, true)
    rmSync(join(s.root, 'src/person.js')); writeFileSync(join(s.root, 'src/person.js'), 'safe')
    writeFileSync(join(s.root, '.gitignore'), 'src/person.js\n'); assert.equal(scanEntities(s).entities[0].stale, true)
    writeFileSync(join(s.root, 'pmo/data/entities.json'), ' '.repeat(512 * 1024 + 1)); assert.throws(() => scanEntities(s), /limit/)
    rmSync(join(s.root, 'pmo/data/entities.json')); symlinkSync(join(s.root, 'pmo/data/plan.json'), join(s.root, 'pmo/data/entities.json')); assert.throws(() => scanEntities(s), /Symlinks/)
  } finally { s.cleanup() }
})
test('reviewed overrides are separate conflicts, stale base identity stays unknown', () => {
  const s = setup()
  try {
    const base = s.metadata.entities[0]
    const variant = structuredClone(base); variant.id = 'person:custom'; variant.variant = 'customer declaration'; variant.override = { baseEntity: base.id, baseIdentity: contentIdentity(base), owner: 'operations', version: '2', evidence: ['schema'] }
    variant.fields.push({ ...variant.fields[0], id: 'pronouns', name: 'pronouns', required: false })
    s.metadata.entities.push(variant); s.save()
    let snapshot = scanEntities(s); assert.equal(snapshot.entities.length, 2); assert.equal(snapshot.entities[1].conflict, true); assert.equal(snapshot.entities[1].stale, false)
    variant.override.baseIdentity = '0'.repeat(64); s.save(); snapshot = scanEntities(s); assert.equal(snapshot.entities[1].stale, true)
  } finally { s.cleanup() }
})
test('bounded worker loads generic metadata', async () => {
  const s = setup(); try { assert.equal((await runEntityScan(s.root)).entities[0].name, 'Person') } finally { s.cleanup() }
})
test('declared revisions require reachable matching content, not hash-shaped text', () => {
  const s = setup()
  try {
    execFileSync('git', ['add', 'src/person.js'], { cwd: s.root })
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture schema'], { cwd: s.root })
    s.metadata.entities[0].evidence[0].revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: s.root, encoding: 'utf8' }).trim(); s.save()
    assert.equal(scanEntities(s).entities[0].evidence[0].verifiedRevision, true)
    s.metadata.entities[0].evidence[0].revision = '0'.repeat(40); s.save()
    assert.equal(scanEntities(s).entities[0].stale, true)
  } finally { s.cleanup() }
})
test('entity endpoint forbids remote/foreign origin, body, root/query and methods', async () => {
  let calls = 0
  const middleware = createEntityMiddleware({ service: createEntityService({ scan: () => { calls++; return { version: 1, entities: [] } } }) })
  const request = async patch => {
    let body; const req = { url: '/api/pmo/entities', method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:5299' }, ...patch }
    const res = { statusCode: 200, setHeader() {}, end(value) { body = JSON.parse(value) } }
    await middleware(req, res, () => assert.fail('Unexpected next')); return { code: res.statusCode, body }
  }
  assert.equal((await request({ socket: { remoteAddress: '192.0.2.1' } })).code, 403)
  assert.equal((await request({ headers: { host: 'evil.invalid' } })).code, 403)
  assert.equal((await request({ headers: { host: 'localhost:5299', origin: 'http://evil.invalid' } })).code, 403)
  assert.equal((await request({ method: 'POST', headers: { host: 'localhost:5299', 'content-length': '2' } })).code, 400)
  assert.equal((await request({ url: '/api/pmo/entities?root=/' })).code, 400)
  assert.equal((await request({ method: 'DELETE' })).code, 405)
  assert.equal(calls, 0)
  assert.equal((await request({})).code, 200); assert.equal(calls, 1)
})