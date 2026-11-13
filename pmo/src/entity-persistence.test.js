import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fixture } from './entities.test.js'
import { validateEntityMetadata, validateEntitySnapshot, fieldPresence } from './entities.js'
import { validatePersistence, negotiatePersistence, persistedFieldPresence, PERSISTENCE_LIMITS } from './entity-persistence.js'
import { scanEntities, contentIdentity } from './node/entity-scan.js'

const SOURCE = '// public schema declaration; never evaluated\n'
const ev = (id, path = 'src/person.js') => ({ id, path, line: 1, endLine: 1, symbol: 'PERSON', sha256: contentIdentity(SOURCE), revision: null, schemaVersion: '1' })
const base = () => { const m = fixture(); m.entities[0].evidence[0].sha256 = contentIdentity(SOURCE); return m }
const extension = (metadata = base()) => ({
  extension: 'persistence', version: 1, base: { metadataIdentity: contentIdentity(metadata) },
  variants: [{
    entityId: 'person:import', owner: 'importer', steward: 'operations', backend: 'sqlite', resource: 'person table',
    layers: [{ kind: 'physical-ddl', coverage: 'complete', evidence: ['ddl'], limitations: [] }, { kind: 'payload', coverage: 'partial', evidence: ['ser'], limitations: ['serialized document column not described'] }],
    fields: [{ fieldId: 'id', layer: 'physical-ddl', required: true, nullable: false, missing: 'unknown', constraints: ['unique'], key: true, evidence: ['ddl'] }],
    indexes: [{ id: 'idx_id', name: 'person_id_idx', columns: ['id'], unique: true, layer: 'physical-ddl', evidence: ['ddl'] }],
    migrations: [{ id: 'm1', order: 1, summary: 'create person', evidence: ['ddl'] }, { id: 'm2', order: 2, summary: 'add index', evidence: ['ddl'] }],
    serializers: [{ id: 'ser', role: 'serializer', symbol: 'toDocument', evidence: ['ser'] }],
    evidence: [ev('ddl'), ev('ser')],
  }],
  dependencies: [{ id: 'dep1', from: 'person:import', to: 'person:import', kind: 'references', basis: 'observed', fieldId: 'id', evidence: ['ddl'] }],
  assessment: { rubricVersion: null, confidence: 'unknown', assumptions: [], unknowns: ['deployment version'] },
})
const setup = (ext) => {
  const root = mkdtempSync(join(tmpdir(), 'pmo-persist-'))
  execFileSync('git', ['init', '-q', root]); mkdirSync(join(root, 'pmo/data'), { recursive: true }); mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'pmo/data/plan.json'), '{}'); writeFileSync(join(root, 'src/person.js'), SOURCE)
  writeFileSync(join(root, 'pmo/data/entities.json'), JSON.stringify(base()))
  if (ext !== undefined) writeFileSync(join(root, 'pmo/data/entities.persistence.json'), typeof ext === 'string' ? ext : JSON.stringify(ext))
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('a complete valid extension is accepted and checked against entity metadata', () => {
  const metadata = validateEntityMetadata(base())
  assert.doesNotThrow(() => validatePersistence(extension(), metadata))
  assert.equal(negotiatePersistence(extension(), metadata).status, 'current')
})
test('closed schema and bounds: extra keys, values, defaults, secrets, paths, dangling references and overflow are rejected', () => {
  const metadata = validateEntityMetadata(base())
  const changes = [
    e => { e.rows = ['ROW_CANARY'] }, e => { e.variants[0].sample = 'VALUE_CANARY' }, e => { e.variants[0].fields[0].default = 'VALUE_CANARY' },
    e => { e.variants[0].resource = 'https://db.example.invalid/x' }, e => { e.variants[0].owner = 'private@example.invalid' }, e => { e.assessment.unknowns = ['token=CANARY'] },
    e => { e.variants[0].evidence[0].path = '../secrets.json' }, e => { e.variants[0].evidence[0].path = 'db/schema.sql' }, e => { e.variants[0].evidence[0].path = 'data/people.json' },
    e => { e.variants[0].entityId = 'missing:entity' }, e => { e.variants[0].fields[0].fieldId = 'nope' }, e => { e.variants[0].fields[0].evidence = ['absent'] },
    e => { e.variants[0].fields[0].layer = 'demo' }, e => { e.variants[0].indexes[0].columns = ['id', 'ghost'] }, e => { e.variants[0].migrations[1].order = 1 },
    e => { e.variants[0].migrations.reverse() }, e => { e.variants[0].layers.push(e.variants[0].layers[0]) }, e => { e.variants[0].backend = 'oracle-prod' },
    e => { e.dependencies[0].to = 'missing:entity' }, e => { e.dependencies[0].evidence = [] }, e => { e.dependencies[0].basis = 'proven' },
    e => { e.variants[0].migrations = Array.from({ length: PERSISTENCE_LIMITS.migrations + 1 }, (_, i) => ({ id: `m${i}`, order: i + 1, summary: 's', evidence: ['ddl'] })) },
    e => { e.dependencies = Array.from({ length: PERSISTENCE_LIMITS.dependencies + 1 }, (_, i) => ({ ...e.dependencies[0], id: `d${i}` })) },
  ]
  for (const change of changes) { const e = extension(); change(e); assert.throws(() => validatePersistence(e, metadata), /Invalid public/); assert.equal(negotiatePersistence(e, metadata).status, 'invalid') }
})
test('a hypothesis dependency needs no evidence but observed and reviewed edges do', () => {
  const metadata = validateEntityMetadata(base()), e = extension()
  e.dependencies[0].basis = 'hypothesis'; e.dependencies[0].evidence = []
  assert.doesNotThrow(() => validatePersistence(e, metadata))
})
test('version negotiation is explicit, value-free and fails closed', () => {
  const metadata = validateEntityMetadata(base())
  assert.deepEqual(negotiatePersistence(undefined, metadata), { status: 'absent', persistence: null })
  const future = { ...extension(), version: 2, secret: 'CANARY_SECRET' }
  const result = negotiatePersistence(future, metadata)
  assert.deepEqual(result, { status: 'unsupported-version', persistence: null }); assert.ok(!JSON.stringify(result).includes('CANARY'))
  assert.equal(negotiatePersistence({ ...extension(), extension: 'other' }, metadata).status, 'invalid')
  assert.equal(negotiatePersistence('text', metadata).status, 'invalid')
})
test('v1 metadata is unchanged: an extension key inside entities.json is still rejected and the extension never leaks into it', () => {
  const m = base(); m.persistence = extension()
  assert.throws(() => validateEntityMetadata(m), /Invalid public/)
  const legacy = scanEntities({ root: setup().root })
  assert.equal(legacy.persistence, undefined)
})

test('scan: absent extension keeps the v1 snapshot and identity; persistence is unknown', () => {
  const s = setup()
  try {
    const snap = scanEntities(s)
    assert.equal(snap.persistence, undefined)
    assert.equal(persistedFieldPresence(snap, 'person:import', 'physical-ddl', 'person_id'), 'unknown')
    assert.equal(snap.identity, scanEntities({ ...s, persistence: undefined }).identity)
  } finally { s.cleanup() }
})
test('scan: current extension verifies evidence, joins the snapshot identity and validates in the browser contract', () => {
  const s = setup(extension())
  try {
    const plain = setup()
    const withoutExt = scanEntities(plain)
    const snap = scanEntities(s)
    assert.equal(snap.persistence.status, 'current')
    assert.notEqual(snap.identity, withoutExt.identity) // extension identity participates in context pinning
    assert.ok(snap.persistence.freshness[0].evidence.every(e => e.verifiedCurrentContent))
    assert.equal(validateEntitySnapshot({ ...snap, generatedAt: '2026-11-07T12:00:00.000Z' }).persistence.status, 'current')
    assert.equal(scanEntities(s).identity, snap.identity) // stable across scans
    plain.cleanup()
  } finally { s.cleanup() }
})
test('scan: source drift makes the variant stale and absence unknown; forged hashes never verify', () => {
  const s = setup(extension())
  try {
    writeFileSync(join(s.root, 'src/person.js'), 'changed\n')
    const snap = scanEntities(s)
    assert.equal(snap.persistence.freshness[0].stale, true)
    assert.equal(persistedFieldPresence(snap, 'person:import', 'physical-ddl', 'nothing'), 'unknown')
    assert.ok(snap.warnings.some(w => /persistence evidence missing or content changed/.test(w)))
  } finally { s.cleanup() }
  const forged = extension(); forged.variants[0].evidence[0].sha256 = 'f'.repeat(64)
  const t = setup(forged)
  try { assert.equal(scanEntities(t).persistence.freshness[0].evidence[0].verifiedCurrentContent, false) } finally { t.cleanup() }
})
test('scan: unsupported version, invalid document and a base bound to other metadata contribute no facts', () => {
  const cases = [[{ ...extension(), version: 9 }, 'unsupported-version'], ['{not json', 'invalid'], [{ ...extension(), extra: 1 }, 'invalid'], [{ ...extension(), base: { metadataIdentity: '0'.repeat(64) } }, 'stale-base']]
  for (const [ext, status] of cases) {
    const s = setup(ext)
    try {
      const snap = scanEntities(s)
      assert.deepEqual(snap.persistence, { status })
      assert.equal(persistedFieldPresence(snap, 'person:import', 'physical-ddl', 'id'), 'unknown')
      assert.ok(snap.warnings.some(w => w.includes(status)))
      assert.equal(snap.entities[0].fields[0].name, 'person_id') // legacy metadata still shown
      validateEntitySnapshot({ ...snap, generatedAt: '2026-11-07T12:00:00.000Z' })
    } finally { s.cleanup() }
  }
})
test('scan: symlinked or ignored extension file and private evidence paths never become authority', () => {
  const s = setup(); const outside = join(s.root, 'outside.json')
  try {
    writeFileSync(outside, JSON.stringify(extension())); symlinkSync(outside, join(s.root, 'pmo/data/entities.persistence.json'))
    assert.deepEqual(scanEntities(s).persistence, { status: 'invalid' })
  } finally { s.cleanup() }
})
test('layers never vouch for each other: physical columns say nothing about the serialized payload', () => {
  const s = setup(extension())
  try {
    const snap = scanEntities(s)
    assert.equal(persistedFieldPresence(snap, 'person:import', 'physical-ddl', 'person_id'), 'present')
    assert.equal(persistedFieldPresence(snap, 'person:import', 'physical-ddl', 'pronouns'), 'absent-in-layer') // complete physical layer
    assert.equal(persistedFieldPresence(snap, 'person:import', 'payload', 'pronouns'), 'unknown') // payload layer only partial
    assert.equal(persistedFieldPresence(snap, 'person:import', 'payload', 'person_id'), 'unknown') // not declared in payload
    assert.equal(persistedFieldPresence(snap, 'person:import', 'demo', 'pronouns'), 'unknown') // layer not recorded
    snap.entities[0].conflict = true
    assert.equal(persistedFieldPresence(snap, 'person:import', 'physical-ddl', 'pronouns'), 'unknown')
    assert.equal(fieldPresence(snap, snap.entities[0], 'pronouns'), 'unknown') // v1 behavior preserved
  } finally { s.cleanup() }
})
test('truncation and stale snapshots make absence unknown', () => {
  const s = setup(extension())
  try {
    const snap = scanEntities(s)
    assert.equal(persistedFieldPresence({ ...snap, stale: true }, 'person:import', 'physical-ddl', 'x'), 'unknown')
    assert.equal(persistedFieldPresence({ ...snap, coverage: { ...snap.coverage, truncated: true } }, 'person:import', 'physical-ddl', 'x'), 'unknown')
  } finally { s.cleanup() }
})
test('snapshot validation rejects a forged persistence block and keeps errors value-free', () => {
  const s = setup(extension())
  try {
    const snap = { ...scanEntities(s), generatedAt: '2026-11-07T12:00:00.000Z' }
    for (const change of [v => { v.persistence.document.rows = ['CANARY'] }, v => { v.persistence.freshness[0].stale = 'secret=CANARY' }, v => { v.persistence.status = 'trusted' }, v => { v.persistence.freshness = [] }, v => { v.persistence = { status: 'invalid', document: extension() } }]) {
      const v = structuredClone(snap); change(v)
      assert.throws(() => validateEntitySnapshot(v), error => !/CANARY/.test(error.message))
    }
  } finally { s.cleanup() }
})
