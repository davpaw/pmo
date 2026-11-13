import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { run } from '../cli.js'
import { introspectEntities, validateStores } from './entity-introspect.js'
import { generateEntities, writeEntities } from './entity-generate.js'
import { scanEntities } from './entity-scan.js'
import { persistedFieldPresence } from '../entity-persistence.js'

let DatabaseSync = null
try { ({ DatabaseSync } = await import('node:sqlite')) } catch { /* Node without node:sqlite: the SQLite cases skip. */ }
const sqlite = { skip: DatabaseSync ? false : 'node:sqlite unavailable' }
const quiet = { log() {}, error() {} }
const LOCAL = { CI: undefined }

const setup = ({ project = {}, files = {}, db = true } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'pmo-introspect-'))
  execFileSync('git', ['init', '-q', root]); mkdirSync(join(root, 'pmo/data'), { recursive: true }); mkdirSync(join(root, 'apps'), { recursive: true }); mkdirSync(join(root, 'var'))
  writeFileSync(join(root, 'pmo/data/plan.json'), '{}'); writeFileSync(join(root, 'pmo/data/guardrails.json'), '{}')
  writeFileSync(join(root, 'apps/db.js'), '// opens the dev database\n'); writeFileSync(join(root, 'apps/ddl.js'), '`CREATE TABLE orders(id TEXT PRIMARY KEY, total REAL)`')
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text)
  if (db && DatabaseSync) {
    const d = new DatabaseSync(join(root, 'var/dev.db'))
    d.exec("CREATE TABLE people(id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT 'DEFAULT_CANARY', note TEXT); CREATE TABLE orders(id TEXT PRIMARY KEY, person TEXT REFERENCES people(id), extra TEXT); CREATE UNIQUE INDEX people_email ON people(email); INSERT INTO people VALUES('1','ROW_CANARY@example.invalid','VALUE_CANARY');")
    d.close()
  }
  const full = { remote: 'origin', mainBranch: 'main', entityStores: [{ label: 'dev', kind: 'sqlite', source: 'apps/db.js', path: 'var/dev.db' }], ...project }
  writeFileSync(join(root, 'pmo/data/project.json'), JSON.stringify(full))
  return { root, project: full, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('SQLite catalog becomes unverified store entities with introspection provenance and no values', sqlite, async () => {
  const s = setup()
  try {
    const r = await introspectEntities({ ...s, env: LOCAL, now: () => '2026-11-13T12:00:00.000Z' })
    const ids = r.metadata.entities.map(e => e.id)
    assert.deepEqual(ids, ['store:dev:orders', 'store:dev:people'])
    const people = r.metadata.entities.find(e => e.id === 'store:dev:people')
    assert.equal(people.evidenceClass, 'deployment-unverified'); assert.equal(people.coverage, 'partial')
    assert.deepEqual(people.fields.map(f => f.name), ['id', 'email', 'note'])
    assert.equal(r.metadata.entities[0].relationships[0].target, 'store:dev:people')
    const text = r.text + r.persistenceText
    assert.ok(!/CANARY|DEFAULT/.test(text), 'no row values or defaults')
    const doc = JSON.parse(r.persistenceText)
    assert.equal(doc.version, 2)
    const variant = doc.variants.find(v => v.entityId === 'store:dev:people')
    assert.deepEqual(variant.evidence, [{ id: 'live', kind: 'introspection', store: 'sqlite', label: 'dev', at: '2026-11-13T12:00:00.000Z', query: 'sqlite-pragma-v1' }])
    assert.equal(variant.layers[0].coverage, 'partial'); assert.equal(variant.indexes[0].name, 'people_email')
  } finally { s.cleanup() }
})
test('written files are read by the scanner: present is known, absence stays unknown, evidence is never "verified"', sqlite, async () => {
  const s = setup()
  try {
    const r = await introspectEntities({ ...s, env: LOCAL })
    assert.equal(writeEntities({ result: { ...r, entityFiles: r.entityFiles } }).changed, true)
    const snap = scanEntities({ root: s.root })
    assert.equal(snap.persistence.status, 'current')
    assert.equal(persistedFieldPresence(snap, 'store:dev:people', 'physical-ddl', 'email'), 'present')
    assert.equal(persistedFieldPresence(snap, 'store:dev:people', 'physical-ddl', 'pronouns'), 'unknown')
    assert.ok(snap.persistence.freshness.every(f => f.evidence.every(e => e.verifiedCurrentContent === false)))
  } finally { s.cleanup() }
})
test('guards: CI, bad config, missing or escaping or symlinked files', sqlite, async () => {
  const s = setup()
  try {
    await assert.rejects(introspectEntities({ ...s, env: { CI: 'true' } }), /refused when CI/)
    for (const bad of [{ label: '1bad', kind: 'sqlite', source: 'apps/db.js', path: 'var/dev.db' }, { label: 'x', kind: 'mysql', source: 'apps/db.js' }, { label: 'x', kind: 'sqlite', source: 'apps/db.js', path: '../x.db' }, { label: 'x', kind: 'sqlite', source: 'apps/db.js', path: '/etc/x.db' }, { label: 'x', kind: 'sqlite', source: 'data/db.js', path: 'var/dev.db' }, { label: 'x', kind: 'sqlite', source: 'apps/db.js', path: 'var/dev.db', password: 'p' }, { label: 'x', kind: 'postgres', source: 'apps/db.js', urlEnv: 'postgres://u:p@h/db' }]) {
      assert.throws(() => validateStores([bad], s.root), error => error.refusal && !/postgres:\/\/|:p@/.test(error.message))
    }
    assert.throws(() => validateStores([], s.root), /entityStores/)
    symlinkSync(join(s.root, 'var/dev.db'), join(s.root, 'var/link.db'))
    await assert.rejects(introspectEntities({ root: s.root, project: { ...s.project, entityStores: [{ label: 'dev', kind: 'sqlite', source: 'apps/db.js', path: 'var/link.db' }] }, env: LOCAL }), /symlinks/)
    await assert.rejects(introspectEntities({ root: s.root, project: { ...s.project, entityStores: [{ label: 'dev', kind: 'sqlite', source: 'apps/db.js', path: 'var/missing.db' }] }, env: LOCAL }), /not found/)
    await assert.rejects(introspectEntities({ root: s.root, project: { ...s.project, entityStores: [{ label: 'dev', kind: 'sqlite', source: 'apps/missing.js', path: 'var/dev.db' }] }, env: LOCAL }), /source file/)
  } finally { s.cleanup() }
})

const fakePg = ({ ro = 'on', su = false, fail = false, log = [] } = {}) => ({
  log,
  connect: async url => ({
    async query(sql) {
      log.push(sql)
      if (fail && /information_schema\.columns/.test(sql)) throw Error('postgres://user:CANARY_PASSWORD@localhost/db exploded')
      if (/current_setting/.test(sql)) return { rows: [{ ro, su }] }
      if (/information_schema\.columns/.test(sql)) return { rows: [{ table_schema: 'public', table_name: 'accounts', column_name: 'id', data_type: 'uuid', is_nullable: 'NO' }, { table_schema: 'public', table_name: 'accounts', column_name: 'owner', data_type: 'text', is_nullable: 'YES' }, { table_schema: 'billing', table_name: 'invoices', column_name: 'account', data_type: 'uuid', is_nullable: 'NO' }] }
      if (/table_constraints/.test(sql)) return { rows: [{ table_schema: 'public', table_name: 'accounts', constraint_type: 'PRIMARY KEY', column_name: 'id' }, { table_schema: 'billing', table_name: 'invoices', constraint_type: 'FOREIGN KEY', column_name: 'account', target_schema: 'public', target_table: 'accounts', target_column: 'id' }] }
      if (/pg_index/.test(sql)) return { rows: [{ table_schema: 'public', table_name: 'accounts', index_name: 'accounts_owner_idx', is_unique: false, column_name: 'owner' }] }
      return { rows: [] }
    },
    async end() { log.push('END') },
  }),
})
const pgProject = { entityStores: [{ label: 'pg', kind: 'postgres', source: 'apps/db.js', urlEnv: 'PMO_ENTITY_PG_URL' }] }

test('Postgres: catalog-only queries in a READ ONLY transaction, loopback only, secrets from env or .env.local, value-free errors', async () => {
  const s = setup({ project: pgProject, db: false })
  try {
    const pg = fakePg()
    const r = await introspectEntities({ ...s, env: { ...LOCAL, PMO_ENTITY_PG_URL: 'postgres://reader:CANARY_PASSWORD@localhost:5432/dev' }, connect: pg.connect })
    assert.deepEqual(r.metadata.entities.map(e => e.id), ['store:pg:accounts', 'store:pg:billing.invoices'])
    assert.equal(r.metadata.entities[1].relationships[0].target, 'store:pg:accounts')
    assert.ok(!(r.text + r.persistenceText).includes('CANARY'))
    assert.equal(pg.log[0], 'BEGIN READ ONLY'); assert.equal(pg.log.at(-2), 'ROLLBACK'); assert.equal(pg.log.at(-1), 'END')
    for (const sql of pg.log.filter(q => q !== 'END')) assert.ok(/^(BEGIN READ ONLY|ROLLBACK|SET LOCAL statement_timeout|SELECT .*(information_schema|pg_index|current_setting))/.test(sql), `unexpected statement: ${sql}`)
    assert.ok(!pg.log.some(q => /FROM\s+(accounts|public\.accounts|invoices)\b/i.test(q)), 'no SELECT on user tables')
    // .env.local is the file source of the secret; the process environment wins when both exist.
    writeFileSync(join(s.root, '.env.local'), 'PMO_ENTITY_PG_URL="postgres://reader:CANARY_PASSWORD@127.0.0.1/dev"\n')
    assert.equal((await introspectEntities({ ...s, env: LOCAL, connect: fakePg().connect })).metadata.entities.length, 2)
    // Refusals: non-loopback, missing, superuser, writable transaction, non-Postgres URL.
    for (const [env, options, pattern] of [[{ PMO_ENTITY_PG_URL: 'postgres://u:CANARY_PASSWORD@db.example.invalid/x' }, {}, /loopback/], [{ PMO_ENTITY_PG_URL: 'mysql://localhost/x' }, {}, /not a Postgres URL/], [{ PMO_ENTITY_PG_URL: 'postgres://u:CANARY_PASSWORD@localhost/x' }, { su: true }, /read-only, non-superuser/], [{ PMO_ENTITY_PG_URL: 'postgres://u:CANARY_PASSWORD@localhost/x' }, { ro: 'off' }, /read-only, non-superuser/]]) {
      const p = fakePg(options)
      rmSync(join(s.root, '.env.local'), { force: true })
      await assert.rejects(introspectEntities({ ...s, env: { ...LOCAL, ...env }, connect: p.connect }), error => pattern.test(error.message) && !/CANARY/.test(error.message))
      assert.ok(p.log.every(q => q === 'BEGIN READ ONLY' || q === 'SET LOCAL statement_timeout = 5000' || /current_setting|ROLLBACK|END/.test(q)), 'refusals read no catalog')
    }
    await assert.rejects(introspectEntities({ ...s, env: LOCAL, connect: fakePg().connect }), /not set/)
    const failing = fakePg({ fail: true })
    await assert.rejects(introspectEntities({ ...s, env: { ...LOCAL, PMO_ENTITY_PG_URL: 'postgres://u:CANARY_PASSWORD@localhost/x' }, connect: failing.connect }), error => /could not read the schema/.test(error.message) && !/CANARY|exploded/.test(error.message))
    assert.equal(failing.log.at(-1), 'END'); assert.ok(failing.log.includes('ROLLBACK'))
  } finally { s.cleanup() }
})
test('Redis: key patterns are declared and unverified; nothing connects', async () => {
  const s = setup({ project: { entityStores: [{ label: 'cache', kind: 'redis', source: 'apps/db.js', keyPatterns: [{ pattern: 'session:*', type: 'hash', owner: 'auth' }] }] }, db: false })
  try {
    const r = await introspectEntities({ ...s, env: LOCAL, connect: () => { throw Error('must not connect') } })
    const e = r.metadata.entities[0]
    assert.equal(e.id, 'store:cache:session:*'.replace('*', '_')); assert.equal(e.coverage, 'not-recorded'); assert.deepEqual(e.fields, [])
    const v = JSON.parse(r.persistenceText).variants[0]
    assert.equal(v.backend, 'key-value'); assert.equal(v.evidence[0].kind, 'declaration'); assert.equal(v.layers[0].coverage, 'not-recorded')
    assert.equal(persistedFieldPresence({ ...scanSnapshot(s, r), }, e.id, 'logical', 'anything'), 'unknown')
  } finally { s.cleanup() }
})
const scanSnapshot = (s, r) => { writeEntities({ result: r }); return scanEntities({ root: s.root }) }

test('literal DDL and introspected variants stay separate; disagreement is a visible conflict', sqlite, async () => {
  const s = setup({ project: { entitySources: ['apps/ddl.js'] } })
  try {
    writeEntities({ result: generateEntities({ root: s.root, project: s.project }) })
    const r = await introspectEntities({ ...s, env: LOCAL })
    writeEntities({ result: r })
    const snap = scanEntities({ root: s.root })
    const byId = Object.fromEntries(snap.entities.map(e => [e.id, e]))
    assert.ok(byId['table:orders'] && byId['store:dev:orders'] && byId['store:dev:people'])
    assert.equal(byId['store:dev:orders'].override.baseEntity, 'table:orders') // columns differ: person, extra vs total
    assert.equal(byId['store:dev:orders'].conflict, true); assert.equal(byId['table:orders'].conflict, false)
    assert.equal(byId['store:dev:people'].override, null)
    assert.ok(snap.warnings.some(w => /store:dev:orders: reviewed declaration variant/.test(w)))
  } finally { s.cleanup() }
})
test('generate carries store entities and persistence forward and rebinds the persistence base', sqlite, async () => {
  const s = setup({ project: { entitySources: ['apps/ddl.js'] } })
  try {
    writeEntities({ result: await introspectEntities({ ...s, env: LOCAL }) })
    const before = JSON.parse(readFileSync(join(s.root, 'pmo/data/entities.persistence.json'), 'utf8'))
    const r = generateEntities({ root: s.root, project: s.project })
    writeEntities({ result: r })
    const snap = scanEntities({ root: s.root })
    assert.equal(snap.persistence.status, 'current')
    assert.ok(snap.entities.some(e => e.id === 'table:orders') && snap.entities.some(e => e.id === 'store:dev:people'))
    const after = JSON.parse(readFileSync(join(s.root, 'pmo/data/entities.persistence.json'), 'utf8'))
    assert.notEqual(after.base.metadataIdentity, before.base.metadataIdentity)
    assert.deepEqual(after.variants.map(v => v.entityId), before.variants.map(v => v.entityId))
  } finally { s.cleanup() }
})
test('CLI: introspect writes, --check ignores only the timestamp, CI refuses, errors are value-free', sqlite, async () => {
  const s = setup()
  const previous = process.env.CI; delete process.env.CI
  try {
    const go = (...argv) => run(['entities', ...argv], { root: s.root, out: quiet })
    assert.equal(await go('introspect', '--check'), 1)
    assert.equal(await go('introspect'), 0)
    assert.equal(await go('introspect', '--check'), 0)
    const d = new DatabaseSync(join(s.root, 'var/dev.db')); d.exec('CREATE TABLE added(id TEXT)'); d.close()
    assert.equal(await go('introspect', '--check'), 1)
    process.env.CI = 'true'
    assert.equal(await go('introspect'), 1)
  } finally { if (previous === undefined) delete process.env.CI; else process.env.CI = previous; s.cleanup() }
})
test('the PMO server, browser and Agent import no database client and never call introspection', () => {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]))
  const root = new URL('..', import.meta.url).pathname
  const allowed = new Set(['node/entity-introspect.js', 'node/entity-introspect.test.js'])
  for (const file of walk(root).filter(f => /\.(?:[cm]?[jt]sx?)$/.test(f) && !/\.test\.[cm]?[jt]sx?$/.test(f))) {
    const name = file.slice(root.length)
    const source = readFileSync(file, 'utf8')
    if (!allowed.has(name)) assert.ok(!/from\s+['"](?:pg|redis|ioredis|mysql2?|better-sqlite3|node:sqlite)['"]|import\(\s*['"](?:pg|redis|ioredis|node:sqlite)['"]\)/.test(source), `${name} imports a database client`)
    if (!allowed.has(name) && name !== 'cli.js') assert.ok(!/entity-introspect/.test(source), `${name} reaches introspection`)
  }
})
