import { lstatSync, openSync, readSync, closeSync, fstatSync, readdirSync, realpathSync, constants } from 'node:fs'
import { resolve, relative, sep, posix } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ENTITY_LIMITS, safeEntityPath, validateEntityMetadata } from '../entities.js'
import { contentIdentity } from './entity-scan.js'
import { pmoDirectory } from './paths.js'
import { assembleEntities, documentTexts, existingEntityFiles, isStoreEntity, writeAssembled } from './entity-assemble.js'

/**
 * Producer for the fixed host binding pmo/data/entities.json.
 * Reads only the host-configured source files (project.json `entitySources`: repository-relative paths, or one-level
 * `dir/*.js` patterns), looks for literal CREATE TABLE statements in their text and records schema-only descriptors with
 * hash-bound evidence. Nothing is evaluated, no database or data file is opened, and values (defaults, CHECK
 * expressions) are never copied. Anything it cannot read literally is partial or counted, never guessed.
 */
export const GENERATOR_LIMITS = Object.freeze({ files: 200, aggregateBytes: 4 * ENTITY_LIMITS.bytes })

const unquote = name => name.replace(/^["`[]|["`\]]$/g, '')
const IDENT = String.raw`(?:"[^"]+"|` + '`[^`]+`' + String.raw`|\[[^\]]+\]|(?:\$\{[^}]*\}|[A-Za-z_])[\w$.]*)`
const CREATE = new RegExp(String.raw`\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})\s*\(`, 'gi')
const lineOf = (text, index) => text.slice(0, index).split('\n').length

/** Index of the parenthesis closing the one opened at `open`, ignoring quoted text; -1 when unbalanced. */
const closing = (text, open) => {
  let depth = 0, quote = null
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (quote) { if (c === quote) quote = null; continue }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return -1
}
const splitTop = body => {
  const parts = []; let depth = 0, quote = null, start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (quote) { if (c === quote) quote = null; continue }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) { parts.push(body.slice(start, i)); start = i + 1 }
  }
  parts.push(body.slice(start))
  return parts.map(p => p.trim().replace(/\s+/g, ' ')).filter(Boolean)
}
const columnList = text => text.split(',').map(s => unquote(s.trim())).filter(Boolean)

/** Parse one literal statement body. Pure: text in, descriptor out. */
export const parseTable = (body) => {
  const columns = [], tableConstraints = [], issues = []
  for (const part of splitTop(body)) {
    if (part.includes('${')) { issues.push('dynamic'); continue }
    if (/^(?:CONSTRAINT\b|PRIMARY\s+KEY\b|UNIQUE\b|FOREIGN\s+KEY\b|CHECK\b)/i.test(part)) {
      const text = part.replace(/^CONSTRAINT\s+\S+\s+/i, '')
      let m
      if ((m = /^PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(text))) tableConstraints.push({ kind: 'primary', columns: columnList(m[1]) })
      else if ((m = /^UNIQUE\s*\(([^)]*)\)/i.exec(text))) tableConstraints.push({ kind: 'unique', columns: columnList(m[1]) })
      else if ((m = new RegExp(String.raw`^FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+(${IDENT})\s*(?:\(([^)]*)\))?`, 'i').exec(text))) tableConstraints.push({ kind: 'reference', columns: columnList(m[1]), target: unquote(m[2]), targetColumns: m[3] ? columnList(m[3]) : [] })
      else if (!/^CHECK\b/i.test(text)) issues.push('unparsed')
      continue
    }
    const m = new RegExp(String.raw`^(${IDENT})\s*([A-Za-z]+(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)?(.*)$`, 'i').exec(part)
    if (!m) { issues.push('unparsed'); continue }
    const rest = m[3] ?? ''
    const ref = new RegExp(String.raw`\bREFERENCES\s+(${IDENT})\s*(?:\(([^)]*)\))?`, 'i').exec(rest)
    columns.push({
      name: unquote(m[1]), type: m[2] ? m[2].replace(/\s+/g, '').toUpperCase() : null,
      notNull: /\bNOT\s+NULL\b/i.test(rest), primary: /\bPRIMARY\s+KEY\b/i.test(rest), unique: /\bUNIQUE\b/i.test(rest),
      reference: ref ? { target: unquote(ref[1]), targetColumn: ref[2] ? columnList(ref[2])[0] ?? null : null } : null,
    })
  }
  return { columns, tableConstraints, issues }
}

const slug = name => name.replace(/[^A-Za-z0-9_.:-]/g, '_')

/** Build entity descriptors from {path, text, hash} sources. Pure; shared by tests. */
export const entitiesFromSources = sources => {
  const coverage = { unsupported: 0, skipped: 0, unresolved: 0, truncated: false }, notes = [], found = []
  const alters = new Set()
  for (const s of sources) for (const m of s.text.matchAll(new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(${IDENT})`, 'gi'))) alters.add(unquote(m[1]).toLowerCase())
  for (const s of sources) {
    CREATE.lastIndex = 0
    for (let m; (m = CREATE.exec(s.text));) {
      const open = m.index + m[0].length - 1, end = closing(s.text, open)
      if (m[1].includes('${') || end < 0) { coverage.unresolved++; notes.push(`${s.path}:${lineOf(s.text, m.index)}: table not readable literally; skipped.`); continue }
      const parsed = parseTable(s.text.slice(open + 1, end))
      found.push({ source: s, table: unquote(m[1]), line: lineOf(s.text, m.index), endLine: lineOf(s.text, end), ...parsed })
      CREATE.lastIndex = end
    }
  }
  const ids = new Set(), entities = []
  const idOf = table => `table:${table}`
  const known = new Set(found.map(f => idOf(f.table)))
  for (const f of found) {
    const id = idOf(f.table)
    if (ids.has(id)) { coverage.unresolved++; notes.push(`${f.source.path}:${f.line}: table ${f.table} is already defined elsewhere; later definition skipped.`); continue }
    const byName = new Map(f.columns.map(c => [c.name, c]))
    const keyed = new Set(), unique = new Map(), relationships = []
    let partial = f.issues.length > 0 || alters.has(f.table.toLowerCase())
    if (f.columns.length > ENTITY_LIMITS.fields) { partial = true; coverage.truncated = true }
    for (const c of f.columns) { if (c.primary) keyed.add(c.name); if (c.unique) unique.set(c.name, [`unique`]) }
    for (const t of f.tableConstraints) {
      if (t.kind === 'primary') t.columns.forEach(c => keyed.add(c))
      else if (t.kind === 'unique') for (const c of t.columns) unique.set(c, [...(unique.get(c) ?? []), `unique(${t.columns.join(',')})`])
    }
    const refs = [
      ...f.columns.filter(c => c.reference).map(c => ({ column: c.name, ...c.reference })),
      ...f.tableConstraints.filter(t => t.kind === 'reference').flatMap(t => t.columns.map((column, i) => ({ column, target: t.target, targetColumn: t.targetColumns[i] ?? null }))),
    ]
    const fields = f.columns.slice(0, ENTITY_LIMITS.fields).map(c => {
      const key = keyed.has(c.name), constraints = [...new Set([...(key ? ['primary key'] : []), ...(unique.get(c.name) ?? [])])].slice(0, 10)
      // SQLite lets a non-integer PRIMARY KEY hold NULL, so requiredness stays unknown unless NOT NULL is explicit.
      return { id: c.name, name: c.name, type: c.type, required: c.notNull ? true : key ? null : false, nullable: c.notNull ? false : key ? null : true, constraints, key, privacy: 'unknown', evidence: ['ddl'] }
    })
    for (const r of refs) {
      const field = byName.has(r.column) ? r.column : null
      const target = idOf(r.target)
      if (!field || !known.has(target)) { coverage.unresolved++; notes.push(`${f.source.path}:${f.line}: reference ${f.table}.${r.column} -> ${r.target} not resolvable to a generated table.`); continue }
      relationships.push({ id: `ref_${slug(r.column)}_${slug(r.target)}`, target, field, targetField: r.targetColumn, cardinality: 'many-to-one', evidence: ['ddl'] })
    }
    // A reference to a column that was not declared literally cannot name a target field: drop only that detail.
    for (const rel of relationships) if (rel.targetField !== null) {
      const t = found.find(x => idOf(x.table) === rel.target)
      if (!t || !t.columns.some(c => c.name === rel.targetField)) rel.targetField = null
    }
    const seen = new Set()
    const uniqueRels = relationships.filter(r => !seen.has(r.id) && seen.add(r.id))
    entities.push({
      id, name: f.table, aliases: [], variant: `Physical SQL columns in ${f.source.path}`.slice(0, 240), evidenceClass: 'schema', schemaOwner: null, steward: null,
      consumers: [], workspaces: [], supply: null, sourceSystem: 'Literal CREATE TABLE statement', privacy: 'unknown', coverage: partial ? 'partial' : 'complete',
      evidence: [{ id: 'ddl', path: f.source.path, line: f.line, endLine: f.endLine, symbol: f.table, sha256: f.source.hash, revision: null, schemaVersion: null }],
      fields, relationships: uniqueRels, override: null,
    })
    ids.add(id)
    if (partial) notes.push(`${f.source.path}:${f.line}: ${f.table} is partial (${f.issues.length ? 'part of the statement was not literal' : alters.has(f.table.toLowerCase()) ? 'ALTER TABLE seen' : 'field limit'}).`)
  }
  entities.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  // Validate each descriptor alone: one unacceptable name or text must not hide the other tables or leak into the file.
  const valid = []
  for (const entity of entities) {
    const others = new Set(entity.relationships.map(r => r.target))
    try {
      validateEntityMetadata({ version: 1, coverage, entities: [entity, ...entities.filter(e => others.has(e.id) && e !== entity)] })
      valid.push(entity)
    } catch { coverage.skipped++; notes.push(`${entity.evidence[0].path}:${entity.evidence[0].line}: ${entity.id} has a name or text the public format rejects; skipped.`) }
  }
  // A relationship to a skipped table would fail validation of the whole file.
  const kept = new Set(valid.map(e => e.id))
  for (const entity of valid) entity.relationships = entity.relationships.filter(r => kept.has(r.target) || (coverage.unresolved++, false))
  if (valid.length > ENTITY_LIMITS.entities) { coverage.truncated = true; coverage.skipped += valid.length - ENTITY_LIMITS.entities; valid.length = ENTITY_LIMITS.entities }
  return { metadata: validateEntityMetadata({ version: 1, entities: valid, coverage }), notes }
}

/** Expand configured entries: exact safe paths, or `dir/*.ext` for one directory level. Never recursive, never follows links. */
export const expandSources = (boundary, configured) => {
  if (!Array.isArray(configured) || !configured.length) throw Error('Set entitySources in pmo/data/project.json: a list of repository-relative .js/.ts paths or dir/*.js patterns.')
  const paths = new Set(), skipped = []
  for (const entry of configured) {
    if (typeof entry !== 'string') throw Error('entitySources entries must be strings.')
    const star = /^(.*)\/\*(\.[cm]?[jt]sx?)$/.exec(entry)
    if (star) {
      const dir = resolve(boundary, star[1])
      if (!safeEntityPath(`${star[1]}/x${star[2]}`)) throw Error(`Unsupported entitySources entry: ${entry}`)
      let names = []
      try { names = readdirSync(dir, { withFileTypes: true }).filter(d => (d.isFile() || d.isSymbolicLink()) && d.name.endsWith(star[2]) && !/\.test\.[cm]?[jt]sx?$/.test(d.name)).map(d => d.name).sort() } catch { skipped.push(entry) }
      for (const name of names) if (safeEntityPath(`${star[1]}/${name}`)) paths.add(`${star[1]}/${name}`)
    } else {
      if (!safeEntityPath(entry) || entry.includes('*')) throw Error(`Unsupported entitySources entry: ${entry}`)
      paths.add(entry)
    }
  }
  return { paths: [...paths].sort(), skipped }
}

export const readSource = (boundary, path, budget) => {
  const full = resolve(boundary, path), rel = relative(boundary, full)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw Error('Outside root.')
  let part = boundary
  for (const component of rel.split(sep)) { part = resolve(part, component); if (lstatSync(part).isSymbolicLink()) throw Error('Symlinks excluded.') }
  try { execFileSync('git', ['check-ignore', '--no-index', '--quiet', '--', path], { cwd: boundary, timeout: 2000, stdio: 'ignore' }); throw Error('Ignored source excluded.') }
  catch (error) { if (error.status !== 1) throw error }
  const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > ENTITY_LIMITS.bytes || budget.used + stat.size > GENERATOR_LIMITS.aggregateBytes) throw Error('Byte limit.')
    budget.used += stat.size
    const buffer = Buffer.alloc(stat.size + 1)
    if (readSync(fd, buffer, 0, buffer.length, 0) !== stat.size) throw Error('Source changed during read.')
    return buffer.subarray(0, stat.size)
  } finally { closeSync(fd) }
}

export const generateEntities = ({ root, project = {} }) => {
  const boundary = realpathSync(root)
  const { paths, skipped } = expandSources(boundary, project.entitySources)
  const sources = [], notes = [], budget = { used: 0 }
  let truncated = false, unreadable = 0
  for (const path of paths) {
    if (sources.length >= GENERATOR_LIMITS.files) { truncated = true; unreadable++; continue }
    try { const bytes = readSource(boundary, path, budget); sources.push({ path, text: bytes.toString('utf8'), hash: contentIdentity(bytes) }) }
    catch (error) { unreadable++; notes.push(`${path}: not read (${error.message.replace(/\.$/, '')}).`) }
  }
  for (const entry of skipped) notes.push(`${entry}: directory not readable.`)
  const result = entitiesFromSources(sources)
  const coverage = result.metadata.coverage
  coverage.skipped += unreadable; if (truncated) coverage.truncated = true
  const literal = validateEntityMetadata({ ...result.metadata, coverage })
  // Entities from `entities introspect` (store:*) and their persistence variants are carried forward untouched.
  const files = existingEntityFiles(root, project)
  const stores = { entities: files.metadata?.entities.filter(isStoreEntity) ?? [], variants: files.persistence?.variants.filter(v => v.entityId.startsWith('store:')) ?? [] }
  const assembled = assembleEntities({ literal, stores, previous: files.persistence })
  const target = `${pmoDirectory(boundary, project)}/data/entities.json`
  return { metadata: assembled.metadata, notes: [...notes, ...result.notes], target, ...documentTexts(assembled), files: sources.length, entityFiles: files }
}

/** Write, or with check only compare. Returns { changed, missing, file }. */
export const writeEntities = ({ result, check = false }) => ({ ...writeAssembled({ files: result.entityFiles, texts: result, check }), file: posix.normalize(result.target) })
