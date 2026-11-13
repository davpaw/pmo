import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { run } from '../cli.js'
import { entitiesFromSources, parseTable, generateEntities } from './entity-generate.js'
import { scanEntities } from './entity-scan.js'

const DDL = `
const db = open();
db.exec(\`
 CREATE TABLE IF NOT EXISTS solo_settings(tenant TEXT PRIMARY KEY, policy TEXT, token_hash TEXT);
 CREATE TABLE IF NOT EXISTS solo_bookings(tenant TEXT NOT NULL, id TEXT, work TEXT DEFAULT 'DEFAULT_CANARY', document TEXT, PRIMARY KEY(tenant,id), UNIQUE(tenant,work),
   FOREIGN KEY(tenant) REFERENCES solo_settings(tenant));
\`);
`
const setup = (files = { 'apps/api/store.js': DDL }, project = { entitySources: ['apps/api/*.js'] }) => {
  const root = mkdtempSync(join(tmpdir(), 'pmo-gen-'))
  execFileSync('git', ['init', '-q', root]); mkdirSync(join(root, 'pmo/data'), { recursive: true })
  writeFileSync(join(root, 'pmo/data/plan.json'), '{}')
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text) }
  return { root, project, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
const src = (text, path = 'a.js') => ({ path, text, hash: 'a'.repeat(64) })
const quiet = { log() {}, error() {} }

test('reads literal DDL: columns, keys, uniqueness, references; never copies defaults', () => {
  const { metadata } = entitiesFromSources([src(DDL)])
  assert.deepEqual(metadata.entities.map(e => e.id), ['table:solo_bookings', 'table:solo_settings'])
  const b = metadata.entities[0]
  assert.equal(b.coverage, 'complete'); assert.equal(b.evidenceClass, 'schema')
  assert.deepEqual(b.fields.map(f => f.name), ['tenant', 'id', 'work', 'document'])
  assert.equal(b.fields[0].required, true); assert.equal(b.fields[0].key, true)
  assert.deepEqual(b.fields[2].constraints, ['unique(tenant,work)'])
  assert.equal(b.fields[3].nullable, true)
  assert.equal(b.relationships[0].target, 'table:solo_settings'); assert.equal(b.relationships[0].targetField, 'tenant')
  assert.equal(metadata.entities[1].fields[0].required, null) // PRIMARY KEY without NOT NULL stays unknown
  assert.ok(!JSON.stringify(metadata).includes('DEFAULT_CANARY'))
})
test('dynamic, unbalanced and unparsable DDL is partial or counted, never guessed', () => {
  const { metadata, notes } = entitiesFromSources([src('x(`CREATE TABLE a(id TEXT, ${cols}, name TEXT); CREATE TABLE ${t}(id TEXT); CREATE TABLE c(id TEXT')])
  assert.equal(metadata.entities.length, 1)
  assert.equal(metadata.entities[0].coverage, 'partial')
  assert.deepEqual(metadata.entities[0].fields.map(f => f.name), ['id', 'name'])
  assert.equal(metadata.coverage.unresolved, 2); assert.ok(notes.length >= 3)
})
test('ALTER TABLE anywhere makes the table partial so absence is never claimed', () => {
  const { metadata } = entitiesFromSources([src('`CREATE TABLE a(id TEXT)`'), src('`ALTER TABLE a ADD COLUMN extra TEXT`', 'b.js')])
  assert.equal(metadata.entities[0].coverage, 'partial')
})
test('unacceptable names are skipped and counted, other tables survive; unknown references are unresolved', () => {
  const { metadata } = entitiesFromSources([src('`CREATE TABLE ghp_FAKE_CANARY(id TEXT); CREATE TABLE "my table"(id TEXT); CREATE TABLE ok(id TEXT REFERENCES missing(id)); CREATE TABLE ok2(id TEXT)`')])
  assert.deepEqual(metadata.entities.map(e => e.id), ['table:ok', 'table:ok2'])
  assert.equal(metadata.coverage.skipped, 2); assert.equal(metadata.coverage.unresolved, 1)
  assert.ok(!JSON.stringify(metadata).includes('FAKE_CANARY'))
})
test('duplicate table definitions keep the first and are reported', () => {
  const { metadata, notes } = entitiesFromSources([src('`CREATE TABLE a(id TEXT)`', 'a.js'), src('`CREATE TABLE a(other TEXT)`', 'b.js')])
  assert.equal(metadata.entities.length, 1); assert.equal(metadata.entities[0].fields[0].name, 'id'); assert.ok(notes.some(n => /already defined/.test(n)))
})
test('parseTable handles quoted identifiers and parameterised types', () => {
  const p = parseTable('"my col" VARCHAR(20) NOT NULL, `b` REAL, CHECK (b > 0), CONSTRAINT pk PRIMARY KEY ("my col")')
  assert.deepEqual(p.columns.map(c => [c.name, c.type]), [['my col', 'VARCHAR(20)'], ['b', 'REAL']])
  assert.equal(p.tableConstraints[0].kind, 'primary')
})

test('generated file is accepted by the existing scanner with fresh evidence, and is deterministic', async () => {
  const s = setup()
  try {
    writeFileSync(join(s.root, 'pmo/data/project.json'), JSON.stringify({ entitySources: ['apps/api/*.js'], remote: 'origin', mainBranch: 'main' }))
    writeFileSync(join(s.root, 'pmo/data/guardrails.json'), '{}'); writeFileSync(join(s.root, 'pmo/data/entities.json'), 'stale')
    const first = generateEntities({ root: s.root, project: s.project })
    writeFileSync(join(s.root, 'pmo/data/entities.json'), first.text)
    const snapshot = scanEntities({ root: s.root })
    assert.equal(snapshot.entities.length, 2)
    assert.ok(snapshot.entities.every(e => !e.stale && e.evidence[0].verifiedCurrentContent))
    assert.equal(generateEntities({ root: s.root, project: s.project }).text, first.text)
    // Adding a store source is picked up; a source edit makes the committed file stale for --check.
    writeFileSync(join(s.root, 'apps/api/other.js'), '`CREATE TABLE added(id TEXT)`')
    assert.equal(generateEntities({ root: s.root, project: s.project }).metadata.entities.length, 3)
  } finally { s.cleanup() }
})
test('only configured safe files are read: symlinks, ignored, oversize, data and unsafe paths', () => {
  const s = setup({ 'apps/api/ok.js': '`CREATE TABLE ok(id TEXT)`', 'apps/api/big.js': `//${'x'.repeat(600 * 1024)}`, 'apps/api/ignored.js': '`CREATE TABLE ign(id TEXT)`', 'outside.js': '`CREATE TABLE out(id TEXT)`' })
  try {
    writeFileSync(join(s.root, '.gitignore'), 'ignored.js\n'); symlinkSync(join(s.root, 'outside.js'), join(s.root, 'apps/api/link.js'))
    const r = generateEntities({ root: s.root, project: s.project })
    assert.deepEqual(r.metadata.entities.map(e => e.id), ['table:ok'])
    assert.ok(r.notes.some(n => /link\.js.*Symlinks/.test(n)) && r.notes.some(n => /big\.js/.test(n)) && r.notes.some(n => /ignored\.js.*Ignored/.test(n)))
    for (const bad of ['../x.js', '/etc/x.js', 'data/x.js', 'apps/.hidden/x.js', 'apps/api/x.csv', 'apps/**/x.js', 'apps/api/*.sql']) assert.throws(() => generateEntities({ root: s.root, project: { entitySources: [bad] } }), /Unsupported/)
    assert.throws(() => generateEntities({ root: s.root, project: {} }), /entitySources/)
  } finally { s.cleanup() }
})
test('generate writes, --check detects missing, stale and current files', async () => {
  const s = setup()
  try {
    writeFileSync(join(s.root, 'pmo/data/project.json'), JSON.stringify({ entitySources: ['apps/api/*.js'], remote: 'origin', mainBranch: 'main' })); writeFileSync(join(s.root, 'pmo/data/guardrails.json'), '{}')
    const go = (...argv) => run(['entities', ...argv], { root: s.root, out: quiet })
    assert.equal(await go('generate', '--check'), 1)
    assert.equal(await go('generate'), 0)
    assert.equal(await go('generate', '--check'), 0)
    writeFileSync(join(s.root, 'apps/api/store.js'), `${DDL}\n// edited`)
    assert.equal(await go('generate', '--check'), 1)
    assert.equal(await go('generate'), 0); assert.equal(await go('generate', '--check'), 0)
    assert.equal(JSON.parse(readFileSync(join(s.root, 'pmo/data/entities.json'), 'utf8')).version, 1)
    assert.equal(await go('nope'), 1)
  } finally { s.cleanup() }
})
