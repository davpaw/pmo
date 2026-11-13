import { lstatSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { resolve, relative, sep, posix } from 'node:path'
import { ENTITY_LIMITS, safeEntityPath, validateEntityMetadata } from '../entities.js'
import { negotiatePersistence } from '../entity-persistence.js'
import { contentIdentity } from './entity-scan.js'
import { readSource } from './entity-generate.js'
import { assembleEntities, documentTexts, existingEntityFiles, isStoreEntity, writeAssembled } from './entity-assemble.js'
import { pmoDirectory } from './paths.js'

/**
 * `pmo entities introspect` (4.2.13), as approved by the 4.2.12 decision (docs/ENTITY-PERSISTENCE-ASSESSMENT-PLAN.md):
 * local development only, schema only, host CLI only, secrets from .env.local, read-only access.
 *
 *  - Refused when CI is set. SQLite files must be repository-relative regular files, opened read-only. Postgres must resolve to
 *    a loopback host, run inside a READ ONLY transaction and not be a superuser role. Redis is never contacted: only reviewed
 *    key-pattern declarations are recorded, marked unverified.
 *  - Only catalogs are queried (PRAGMA table_info and friends, information_schema, pg_index). Never SELECT from a user table.
 *    Defaults, comments, row counts and values are never read into the output.
 *  - Every error is a fixed value-free message: connection strings, hosts and credentials never reach output.
 */
export const INTROSPECT_LIMITS = Object.freeze({ stores: 20, tables: ENTITY_LIMITS.entities, columns: ENTITY_LIMITS.fields, patterns: 50 })
const LABEL = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/
const NAME = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const SYSTEM_SCHEMAS = "('pg_catalog','information_schema','pg_toast')"
const refuse = message => { const error = Error(message); error.refusal = true; return error }

export const validateStores = (stores, boundary) => {
  if (!Array.isArray(stores) || !stores.length) throw refuse('Set entityStores in pmo/data/project.json: a list of { label, kind, source, ... } for local stores.')
  if (stores.length > INTROSPECT_LIMITS.stores) throw refuse('Too many entityStores.')
  const labels = new Set()
  return stores.map(store => {
    if (!store || typeof store !== 'object' || Array.isArray(store)) throw refuse('entityStores entries must be objects.')
    if (!LABEL.test(store.label || '') || labels.has(store.label)) throw refuse('Each store needs a unique short label (letters, digits, - and _).')
    labels.add(store.label)
    if (!['sqlite', 'postgres', 'redis'].includes(store.kind)) throw refuse(`Store ${store.label}: kind must be sqlite, postgres or redis.`)
    if (!safeEntityPath(store.source)) throw refuse(`Store ${store.label}: source must be a safe repository-relative .js/.ts path that declares the store.`)
    const allowed = { sqlite: ['label', 'kind', 'source', 'path'], postgres: ['label', 'kind', 'source', 'urlEnv'], redis: ['label', 'kind', 'source', 'keyPatterns'] }[store.kind]
    if (Object.keys(store).some(k => !allowed.includes(k))) throw refuse(`Store ${store.label}: unsupported setting.`)
    if (store.kind === 'sqlite') {
      const path = store.path
      if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..' || p === '.git' || p.startsWith('.env'))) throw refuse(`Store ${store.label}: path must be a repository-relative local file.`)
    }
    if (store.kind === 'postgres' && !/^[A-Z][A-Z0-9_]{1,63}$/.test(store.urlEnv || '')) throw refuse(`Store ${store.label}: urlEnv must name an environment variable (the URL itself never goes in project data).`)
    if (store.kind === 'redis') {
      const patterns = store.keyPatterns
      if (!Array.isArray(patterns) || !patterns.length || patterns.length > INTROSPECT_LIMITS.patterns || patterns.some(p => !p || typeof p !== 'object' || Object.keys(p).some(k => !['pattern', 'type', 'owner'].includes(k)) || typeof p.pattern !== 'string' || typeof p.type !== 'string')) throw refuse(`Store ${store.label}: keyPatterns needs { pattern, type, owner } entries.`)
    }
    return store
  })
}

/** Secrets come from the environment or .env.local only; never .env, never project data. */
const secretFrom = (root, name, env) => {
  if (env[name]) return env[name]
  const file = resolve(root, '.env.local')
  if (!existsSync(file)) return null
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && m[1] === name) return m[2].replace(/^(["'])(.*)\1$/, '$2')
  }
  return null
}

const columnRecord = (name, type, notNull, key) => ({ name, type: type ? String(type).toUpperCase().slice(0, 60) : null, notNull, key })

export const introspectSqlite = async (root, store) => {
  const full = resolve(root, store.path)
  const rel = relative(root, full)
  if (!rel || rel.startsWith('..') || rel.startsWith(sep)) throw refuse(`Store ${store.label}: path leaves the repository.`)
  let part = root
  for (const component of rel.split(sep)) { part = resolve(part, component); let stat; try { stat = lstatSync(part) } catch { throw refuse(`Store ${store.label}: database file not found.`) }; if (stat.isSymbolicLink()) throw refuse(`Store ${store.label}: symlinks are not followed.`) }
  if (!lstatSync(full).isFile()) throw refuse(`Store ${store.label}: path is not a regular file.`)
  let DatabaseSync
  try { ({ DatabaseSync } = await import('node:sqlite')) } catch { throw refuse('SQLite introspection needs a Node.js version with node:sqlite (22.5 or newer).') }
  let db
  try { db = new DatabaseSync(full, { readOnly: true }) } catch { throw refuse(`Store ${store.label}: could not open the database read-only.`) }
  try {
    db.exec('PRAGMA query_only = ON')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name").all().map(r => r.name)
    const out = [], skipped = []
    for (const table of tables.slice(0, INTROSPECT_LIMITS.tables)) {
      if (!NAME.test(table)) { skipped.push(table); continue }
      const info = db.prepare(`PRAGMA table_info("${table}")`).all()
      const foreign = db.prepare(`PRAGMA foreign_key_list("${table}")`).all()
      const indexes = db.prepare(`PRAGMA index_list("${table}")`).all().map(index => ({ name: index.name, unique: Boolean(index.unique), columns: NAME.test(index.name) || /^sqlite_autoindex_/.test(index.name) ? db.prepare(`PRAGMA index_info("${index.name.replace(/"/g, '')}")`).all().map(c => c.name) : [] }))
      out.push({
        table, columns: info.slice(0, INTROSPECT_LIMITS.columns).map(c => columnRecord(c.name, c.type, Boolean(c.notnull), Boolean(c.pk))),
        references: foreign.map(f => ({ column: f.from, targetTable: f.table, targetColumn: f.to ?? null })), indexes,
        truncated: info.length > INTROSPECT_LIMITS.columns,
      })
    }
    return { tables: out, skipped, truncated: tables.length > INTROSPECT_LIMITS.tables, query: 'sqlite-pragma-v1' }
  } catch (error) { if (error.refusal) throw error; throw refuse(`Store ${store.label}: schema could not be read.`) } finally { db.close() }
}

const defaultPgConnect = async url => {
  let pg
  try { pg = await import('pg') } catch { throw refuse('Postgres introspection needs the optional "pg" package installed by the host (npm install pg).') }
  const client = new (pg.default?.Client ?? pg.Client)({ connectionString: url, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
  await client.connect()
  return client
}

export const introspectPostgres = async (root, store, { env = process.env, connect = defaultPgConnect } = {}) => {
  const value = secretFrom(root, store.urlEnv, env)
  if (!value) throw refuse(`Store ${store.label}: ${store.urlEnv} is not set in the environment or .env.local.`)
  let url
  try { url = new URL(value) } catch { throw refuse(`Store ${store.label}: ${store.urlEnv} is not a valid connection URL.`) }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw refuse(`Store ${store.label}: ${store.urlEnv} is not a Postgres URL.`)
  if (!LOOPBACK.has(url.hostname)) throw refuse(`Store ${store.label}: only a loopback host is allowed (local development).`)
  let client
  try {
    client = await connect(value)
    await client.query('BEGIN READ ONLY')
    await client.query('SET LOCAL statement_timeout = 5000')
    const guard = (await client.query("SELECT current_setting('transaction_read_only') AS ro, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su")).rows[0]
    if (guard?.ro !== 'on' || guard?.su === true) throw refuse(`Store ${store.label}: needs a read-only, non-superuser role.`)
    const columns = (await client.query(`SELECT table_schema, table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema NOT IN ${SYSTEM_SCHEMAS} ORDER BY table_schema, table_name, ordinal_position`)).rows
    const constraints = (await client.query(`SELECT tc.table_schema, tc.table_name, tc.constraint_type, kcu.column_name, ccu.table_schema AS target_schema, ccu.table_name AS target_table, ccu.column_name AS target_column FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND tc.constraint_type = 'FOREIGN KEY' WHERE tc.table_schema NOT IN ${SYSTEM_SCHEMAS} AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE','FOREIGN KEY')`)).rows
    const indexRows = (await client.query(`SELECT n.nspname AS table_schema, t.relname AS table_name, i.relname AS index_name, ix.indisunique AS is_unique, a.attname AS column_name FROM pg_index ix JOIN pg_class t ON t.oid = ix.indrelid JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey) WHERE n.nspname NOT IN ${SYSTEM_SCHEMAS} ORDER BY n.nspname, t.relname, i.relname`)).rows
    await client.query('ROLLBACK')
    const byTable = new Map()
    for (const row of columns) {
      const name = row.table_schema === 'public' ? row.table_name : `${row.table_schema}.${row.table_name}`
      if (!byTable.has(name)) byTable.set(name, { table: name, schema: row.table_schema, raw: row.table_name, columns: [], references: [], indexes: [], truncated: false })
      const t = byTable.get(name)
      if (t.columns.length >= INTROSPECT_LIMITS.columns) { t.truncated = true; continue }
      t.columns.push(columnRecord(row.column_name, row.data_type, row.is_nullable === 'NO', false))
    }
    const nameOf = (schema, table) => (schema === 'public' ? table : `${schema}.${table}`)
    for (const row of constraints) {
      const t = byTable.get(nameOf(row.table_schema, row.table_name)); if (!t) continue
      const column = t.columns.find(c => c.name === row.column_name)
      if (row.constraint_type === 'PRIMARY KEY' && column) column.key = true
      if (row.constraint_type === 'UNIQUE') t.indexes.push({ name: null, unique: true, columns: [row.column_name] })
      if (row.constraint_type === 'FOREIGN KEY' && row.target_table) t.references.push({ column: row.column_name, targetTable: nameOf(row.target_schema, row.target_table), targetColumn: row.target_column ?? null })
    }
    const named = new Map()
    for (const row of indexRows) {
      const t = byTable.get(nameOf(row.table_schema, row.table_name)); if (!t) continue
      const key = `${t.table}/${row.index_name}`
      if (!named.has(key)) { const index = { name: row.index_name, unique: Boolean(row.is_unique), columns: [] }; named.set(key, index); t.indexes.push(index) }
      named.get(key).columns.push(row.column_name)
    }
    const all = [...byTable.values()]
    return { tables: all.slice(0, INTROSPECT_LIMITS.tables), skipped: [], truncated: all.length > INTROSPECT_LIMITS.tables, query: 'postgres-catalog-v1' }
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK') } catch { /* connection may already be gone */ } }
    if (error.refusal) throw error
    throw refuse(`Store ${store.label}: could not read the schema (connection or permission).`)
  } finally { if (client) { try { await client.end() } catch { /* nothing to report */ } } }
}

const slug = value => value.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 60)
const LIMITATION = 'Read from one local store at one time; says nothing about other environments, deployments or serialized payloads.'

/** Pure: catalog -> entity + persistence-variant records for one store. */
export const storeParts = ({ store, catalog, declaration, at }) => {
  const entities = [], variants = [], notes = []
  const evidence = { id: 'decl', path: declaration.path, line: 1, endLine: declaration.lines, symbol: store.label, sha256: declaration.hash, revision: null, schemaVersion: null }
  const known = new Set(catalog.tables.map(t => `store:${store.label}:${slug(t.table)}`))
  for (const t of catalog.tables) {
    const id = `store:${store.label}:${slug(t.table)}`
    const live = { id: 'live', kind: 'introspection', store: store.kind, label: store.label, at, query: catalog.query }
    const fields = t.columns.map(c => ({ id: c.name, name: c.name, type: c.type, required: c.notNull ? true : c.key ? null : false, nullable: c.notNull ? false : c.key ? null : true, constraints: c.key ? ['primary key'] : [], key: c.key, privacy: 'unknown', evidence: ['decl'] }))
    const relationships = t.references.filter(r => known.has(`store:${store.label}:${slug(r.targetTable)}`) && t.columns.some(c => c.name === r.column)).map(r => ({ id: `ref_${slug(r.column)}_${slug(r.targetTable)}`, target: `store:${store.label}:${slug(r.targetTable)}`, field: r.column, targetField: null, cardinality: 'many-to-one', evidence: ['decl'] }))
    const seen = new Set()
    entities.push({
      id, name: t.table, aliases: [], variant: `Introspected from ${store.kind} store ${store.label}`, evidenceClass: 'deployment-unverified', schemaOwner: null, steward: null, consumers: [], workspaces: [], supply: null,
      sourceSystem: `Local ${store.kind} catalog`, privacy: 'unknown', coverage: 'partial', evidence: [evidence], fields, relationships: relationships.filter(r => !seen.has(r.id) && seen.add(r.id)), override: null,
    })
    const indexes = t.indexes.filter(i => i.name && NAME.test(i.name) && i.columns.length && i.columns.every(c => t.columns.some(col => col.name === c))).map(i => ({ id: slug(i.name), name: i.name, columns: i.columns, unique: i.unique, layer: 'physical-ddl', evidence: ['live'] }))
    const idSeen = new Set()
    variants.push({
      entityId: id, owner: null, steward: null, backend: store.kind, resource: `${store.label}:${t.table}`.slice(0, 240),
      layers: [{ kind: 'physical-ddl', coverage: 'partial', evidence: ['live'], limitations: [LIMITATION] }],
      fields: t.columns.map(c => ({ fieldId: c.name, layer: 'physical-ddl', required: c.notNull ? true : c.key ? null : false, nullable: c.notNull ? false : c.key ? null : true, missing: 'unknown', constraints: c.key ? ['primary key'] : [], key: c.key, evidence: ['live'] })),
      indexes: indexes.filter(i => !idSeen.has(i.id) && idSeen.add(i.id)), migrations: [], serializers: [], evidence: [live],
    })
    if (t.truncated) notes.push(`${store.label}.${t.table}: more than ${INTROSPECT_LIMITS.columns} columns; extra columns not recorded.`)
  }
  for (const name of catalog.skipped) notes.push(`${store.label}: table with an unsupported name skipped.`)
  if (catalog.truncated) notes.push(`${store.label}: more than ${INTROSPECT_LIMITS.tables} tables; extra tables not recorded.`)
  return { entities, variants, notes, evidence }
}

/** Redis has no schema: only reviewed key-pattern declarations are recorded, unverified. No connection, no SCAN/KEYS/GET. */
export const redisParts = ({ store, declaration }) => {
  const entities = [], variants = [], notes = []
  const evidence = { id: 'decl', path: declaration.path, line: 1, endLine: declaration.lines, symbol: store.label, sha256: declaration.hash, revision: null, schemaVersion: null }
  for (const p of store.keyPatterns) {
    const id = `store:${store.label}:${slug(p.pattern)}`
    entities.push({
      id, name: p.pattern, aliases: [], variant: `Declared Redis key pattern (unverified) in ${store.label}`, evidenceClass: 'deployment-unverified', schemaOwner: typeof p.owner === 'string' ? p.owner : null, steward: null, consumers: [], workspaces: [], supply: null,
      sourceSystem: 'Declared key pattern; Redis was not contacted', privacy: 'unknown', coverage: 'not-recorded', evidence: [evidence], fields: [], relationships: [], override: null,
    })
    variants.push({
      entityId: id, owner: typeof p.owner === 'string' ? p.owner : null, steward: null, backend: 'key-value', resource: `${p.pattern} (${p.type})`.slice(0, 240),
      layers: [{ kind: 'logical', coverage: 'not-recorded', evidence: [], limitations: ['Declared key pattern; no key or value was read, so the structure is unknown.'] }],
      fields: [], indexes: [], migrations: [], serializers: [], evidence: [{ id: 'decl', kind: 'declaration', store: 'redis', label: store.label, at: null, query: 'declared-key-pattern' }],
    })
  }
  return { entities, variants, notes, evidence }
}

const redact = text => text.replace(/\b(?:postgres(?:ql)?|redis|https?):\/\/\S+/gi, '[url]')

/**
 * Orchestrates one introspection run. `connect` and `now` are injectable for tests; the PMO server, browser and Agent never call this.
 */
export const introspectEntities = async ({ root, project = {}, env = process.env, connect, now = () => new Date().toISOString() }) => {
  if (env.CI) throw refuse('Introspection is local development only and is refused when CI is set.')
  const boundary = realpathSync(root)
  const stores = validateStores(project.entityStores, boundary)
  const at = now(), budget = { used: 0 }, notes = [], parts = { entities: [], variants: [] }
  for (const store of stores) {
    let declaration
    try { const bytes = readSource(boundary, store.source, budget); declaration = { path: store.source, hash: contentIdentity(bytes), lines: bytes.toString('utf8').split('\n').length } }
    catch { throw refuse(`Store ${store.label}: source file could not be read (symlink, ignored, missing or too large).`) }
    let part
    if (store.kind === 'sqlite') part = storeParts({ store, catalog: await introspectSqlite(boundary, store), declaration, at })
    else if (store.kind === 'postgres') part = storeParts({ store, catalog: await introspectPostgres(boundary, store, { env, connect }), declaration, at })
    else part = redisParts({ store, declaration })
    parts.entities.push(...part.entities); parts.variants.push(...part.variants); notes.push(...part.notes)
  }
  // Validate each store entity with its variant alone, so one unacceptable name cannot hide the rest or break the file.
  const okEntities = [], okVariants = []
  for (const entity of parts.entities) {
    const variant = parts.variants.find(v => v.entityId === entity.id)
    try {
      const metadata = validateEntityMetadata({ version: 1, coverage: { unsupported: 0, skipped: 0, unresolved: 0, truncated: false }, entities: [{ ...entity, relationships: [] }] })
      if (!negotiatePersistence({ extension: 'persistence', version: 2, base: { metadataIdentity: contentIdentity(metadata) }, variants: [variant], dependencies: [], assessment: { rubricVersion: null, confidence: 'unknown', assumptions: [], unknowns: [] } }, metadata).persistence) throw Error('rejected')
      okEntities.push(entity); okVariants.push(variant)
    } catch { notes.push(`${entity.evidence[0].symbol}: a table or field name the public format rejects was skipped.`) }
  }
  const kept = new Set(okEntities.map(e => e.id))
  for (const entity of okEntities) entity.relationships = entity.relationships.filter(r => kept.has(r.target))
  const files = existingEntityFiles(boundary, project)
  const literal = { entities: (files.metadata?.entities ?? []).filter(e => !isStoreEntity(e)), coverage: files.metadata?.coverage ?? { unsupported: 0, skipped: 0, unresolved: 0, truncated: false } }
  const assembled = assembleEntities({ literal, stores: { entities: okEntities, variants: okVariants }, previous: files.persistence })
  return { metadata: assembled.metadata, notes: notes.map(redact), target: `${pmoDirectory(boundary, project)}/data/entities.json`, ...documentTexts(assembled), entityFiles: files, at, stores: stores.length }
}

/** `--check` compares everything except the introspection timestamp. */
export const normalizeTimes = text => (text === null ? null : text.replace(/"at": "\d{4}-\d\d-\d\dT[\d:.]+Z"/g, '"at": "<time>"'))
export const writeIntrospected = ({ result, check = false }) => {
  if (!check) return { ...writeAssembled({ files: result.entityFiles, texts: result }), file: posix.normalize(result.target) }
  const files = result.entityFiles
  const same = (file, text) => text === null || (existsSync(file) && normalizeTimes(readFileSync(file, 'utf8')) === normalizeTimes(text))
  const changed = !same(files.entitiesFile, result.text) || !same(files.persistenceFile, result.persistenceText)
  return { changed, missing: !existsSync(files.entitiesFile), file: posix.normalize(result.target) }
}
