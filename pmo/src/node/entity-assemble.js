import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateEntityMetadata } from '../entities.js'
import { negotiatePersistence } from '../entity-persistence.js'
import { contentIdentity } from './entity-scan.js'
import { pmoDirectory } from './paths.js'

/**
 * Both producers (`entities generate` from literal DDL, `entities introspect` from local stores) write the same two host
 * files. Each owns one kind of entity (`table:*` and everything else vs `store:*`) and carries the other's forward verbatim,
 * so neither run erases or rewrites the other's facts, and the persistence binding is always recomputed.
 */
export const isStoreEntity = entity => entity.id.startsWith('store:')
const CONFLICT_OWNER = 'pmo entities introspect'

const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null } }
export const existingEntityFiles = (root, project) => {
  const dir = resolve(realpathSync(root), pmoDirectory(realpathSync(root), project), 'data')
  const entitiesFile = resolve(dir, 'entities.json'), persistenceFile = resolve(dir, 'entities.persistence.json')
  let metadata = null, persistence = null
  const raw = existsSync(entitiesFile) ? readJson(entitiesFile) : null
  if (raw) { try { metadata = validateEntityMetadata(raw) } catch { metadata = null } }
  const rawPersistence = existsSync(persistenceFile) ? readJson(persistenceFile) : null
  if (rawPersistence && metadata) { const n = negotiatePersistence(rawPersistence, metadata); persistence = n.persistence }
  return { entitiesFile, persistenceFile, metadata, persistence, persistenceFileExists: existsSync(persistenceFile) }
}

/** A store entity whose field names disagree with the literal-DDL entity of the same table is marked as a reviewed variant (a visible conflict). */
const markConflicts = entities => {
  const literal = new Map(entities.filter(e => e.id.startsWith('table:')).map(e => [e.name, e]))
  for (const entity of entities) {
    if (!isStoreEntity(entity) || entity.fields.length === 0) continue
    const table = entity.name.includes('.') ? entity.name.split('.').pop() : entity.name
    const base = literal.get(table)
    entity.override = null
    if (!base) continue
    const a = base.fields.map(f => f.name.toLowerCase()).sort().join(','), b = entity.fields.map(f => f.name.toLowerCase()).sort().join(',')
    if (a !== b) entity.override = { baseEntity: base.id, baseIdentity: contentIdentity(base), owner: CONFLICT_OWNER, version: 'introspection', evidence: [entity.evidence[0].id] }
  }
}

/** Pure: combine literal and store parts into the final documents. */
export const assembleEntities = ({ literal, stores, previous }) => {
  const entities = [...literal.entities, ...stores.entities]
  markConflicts(entities)
  entities.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const metadata = validateEntityMetadata({ version: 1, entities, coverage: literal.coverage })
  const ids = new Set(metadata.entities.map(e => e.id))
  const keep = (previous?.variants ?? []).filter(v => !v.entityId.startsWith('store:') && ids.has(v.entityId))
  const variants = [...keep, ...stores.variants.filter(v => ids.has(v.entityId))].sort((a, b) => (a.entityId < b.entityId ? -1 : 1))
  let persistence = null
  if (variants.length || previous) {
    const hasStore = variants.some(v => v.evidence.some(e => 'kind' in e))
    persistence = {
      extension: 'persistence', version: hasStore ? 2 : previous?.version ?? 1, base: { metadataIdentity: contentIdentity(metadata) }, variants,
      dependencies: (previous?.dependencies ?? []).filter(d => ids.has(d.from) && ids.has(d.to) && variants.some(v => v.entityId === d.from)),
      assessment: previous?.assessment ?? { rubricVersion: null, confidence: 'unknown', assumptions: [], unknowns: [] },
    }
    persistence = negotiatePersistence(persistence, metadata).persistence
    if (!persistence) throw Error('Generated persistence metadata was rejected by the public format.')
  }
  return { metadata, persistence }
}

export const documentTexts = ({ metadata, persistence }) => ({ text: `${JSON.stringify(metadata, null, 2)}\n`, persistenceText: persistence ? `${JSON.stringify(persistence, null, 2)}\n` : null })

/** Write (or with check only compare) both files. Returns what differs. */
export const writeAssembled = ({ files, texts, check = false }) => {
  const differs = (file, text) => text !== null && (!existsSync(file) || readFileSync(file, 'utf8') !== text)
  const entitiesChanged = differs(files.entitiesFile, texts.text), persistenceChanged = differs(files.persistenceFile, texts.persistenceText)
  if (!check) {
    if (entitiesChanged) writeFileSync(files.entitiesFile, texts.text)
    if (persistenceChanged) writeFileSync(files.persistenceFile, texts.persistenceText)
  }
  return { entitiesChanged, persistenceChanged, changed: entitiesChanged || persistenceChanged, missing: !existsSync(files.entitiesFile) }
}
