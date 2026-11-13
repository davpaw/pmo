/**
 * Persistence extension v1 for entity metadata (step 4.2.8). Browser-safe and pure.
 *
 * It is a separate, optional, closed document (`<pmo>/data/entities.persistence.json`) bound to the entity v1 metadata by
 * `base.metadataIdentity`, so entity v1 is unchanged: an older consumer never sees the file and shows legacy metadata with
 * persistence unknown. A newer consumer negotiates the version explicitly. An unknown version, an invalid document or a
 * document bound to different metadata is reported with a value-free status and contributes no facts.
 *
 * No tenant key, record, sample, default, raw source, private URL or executable capability belongs in this format.
 */
import { entityValidators, validateEntityEvidence } from './entities.js'

// entities.js imports this module for snapshot validation, so nothing from it may be used while modules load: bind lazily.
const fail = () => entityValidators.fail()
const object = (...args) => entityValidators.object(...args)
const text = (...args) => entityValidators.text(...args)
const id = (...args) => entityValidators.id(...args)
const list = (...args) => entityValidators.list(...args)
const unique = (...args) => entityValidators.unique(...args)
const bool = (...args) => entityValidators.bool(...args)

export const PERSISTENCE_EXTENSION = 'persistence'
export const PERSISTENCE_VERSIONS = Object.freeze([1])
export const PERSISTENCE_LIMITS = Object.freeze({ bytes: 512 * 1024, variants: 200, layers: 6, fields: 100, indexes: 50, migrations: 100, serializers: 20, evidence: 20, dependencies: 500, notes: 20 })
export const PERSISTENCE_LAYERS = Object.freeze(['physical-ddl', 'payload', 'logical', 'import', 'demo', 'customer'])
export const PERSISTENCE_BACKENDS = Object.freeze(['sqlite', 'postgres', 'mysql', 'document', 'key-value', 'file', 'memory', 'api', 'unknown'])
export const DEPENDENCY_KINDS = Object.freeze(['reads', 'writes', 'references', 'derives', 'imports', 'exports'])
export const DEPENDENCY_BASES = Object.freeze(['observed', 'reviewed', 'hypothesis'])
const MISSING = ['omitted', 'null', 'either', 'unknown']
const CONFIDENCE = ['low', 'medium', 'high', 'unknown']
const oneOf = (value, allowed) => { if (!allowed.includes(value)) fail() }

/** Closed validation of one persistence document. `metadata` (validated entity v1) enables the referential checks. */
export const validatePersistence = (value, metadata = null) => {
  object(value, ['extension', 'version', 'base', 'variants', 'dependencies', 'assessment'])
  if (value.extension !== PERSISTENCE_EXTENSION || !PERSISTENCE_VERSIONS.includes(value.version) || JSON.stringify(value).length > PERSISTENCE_LIMITS.bytes) fail()
  object(value.base, ['metadataIdentity'])
  if (!/^[a-f0-9]{64}$/.test(value.base.metadataIdentity)) fail()
  const entityOf = new Map((metadata?.entities ?? []).map(e => [e.id, e]))
  list(value.variants, variant => {
    object(variant, ['entityId', 'owner', 'steward', 'backend', 'resource', 'layers', 'fields', 'indexes', 'migrations', 'serializers', 'evidence'])
    id(variant.entityId); text(variant.owner, true); text(variant.steward, true); text(variant.resource, true); oneOf(variant.backend, PERSISTENCE_BACKENDS)
    const entity = metadata ? entityOf.get(variant.entityId) : null
    if (metadata && !entity) fail()
    list(variant.evidence, validateEntityEvidence, PERSISTENCE_LIMITS.evidence); unique(variant.evidence.map(e => e.id))
    const refs = (refs, required = true) => { list(refs, id, 20); if ((required && !refs.length) || refs.some(ref => !variant.evidence.some(e => e.id === ref))) fail() }
    list(variant.layers, layer => {
      object(layer, ['kind', 'coverage', 'evidence', 'limitations'])
      oneOf(layer.kind, PERSISTENCE_LAYERS); oneOf(layer.coverage, ['complete', 'partial', 'not-recorded'])
      refs(layer.evidence, layer.coverage !== 'not-recorded'); list(layer.limitations, text, PERSISTENCE_LIMITS.notes)
    }, PERSISTENCE_LIMITS.layers)
    unique(variant.layers.map(l => l.kind))
    const layerKinds = variant.layers.map(l => l.kind)
    list(variant.fields, field => {
      object(field, ['fieldId', 'layer', 'required', 'nullable', 'missing', 'constraints', 'key', 'evidence'])
      id(field.fieldId); oneOf(field.layer, layerKinds); bool(field.required); bool(field.nullable); bool(field.key); oneOf(field.missing, MISSING)
      list(field.constraints, text, 10); refs(field.evidence)
      if (entity && !entity.fields.some(f => f.id === field.fieldId)) fail()
    }, PERSISTENCE_LIMITS.fields)
    unique(variant.fields.map(f => `${f.layer}/${f.fieldId}`))
    list(variant.indexes, index => {
      object(index, ['id', 'name', 'columns', 'unique', 'layer', 'evidence'])
      id(index.id); text(index.name); bool(index.unique); oneOf(index.layer, layerKinds); refs(index.evidence)
      list(index.columns, id, 20); if (!index.columns.length || index.columns.some(c => !variant.fields.some(f => f.fieldId === c && f.layer === index.layer))) fail()
    }, PERSISTENCE_LIMITS.indexes)
    unique(variant.indexes.map(i => i.id))
    list(variant.migrations, migration => {
      object(migration, ['id', 'order', 'summary', 'evidence'])
      id(migration.id); text(migration.summary); refs(migration.evidence)
      if (!Number.isInteger(migration.order) || migration.order < 1 || migration.order > 1000000) fail()
    }, PERSISTENCE_LIMITS.migrations)
    unique(variant.migrations.map(m => m.id)); unique(variant.migrations.map(m => m.order))
    if (variant.migrations.some((m, i) => i && m.order <= variant.migrations[i - 1].order)) fail() // ordered source migration ids
    list(variant.serializers, serializer => {
      object(serializer, ['id', 'role', 'symbol', 'evidence'])
      id(serializer.id); oneOf(serializer.role, ['serializer', 'reader', 'writer']); text(serializer.symbol); refs(serializer.evidence)
    }, PERSISTENCE_LIMITS.serializers)
    unique(variant.serializers.map(s => s.id))
  }, PERSISTENCE_LIMITS.variants)
  unique(value.variants.map(v => v.entityId))
  list(value.dependencies, dependency => {
    object(dependency, ['id', 'from', 'to', 'kind', 'basis', 'fieldId', 'evidence'])
    id(dependency.id); id(dependency.from); id(dependency.to); oneOf(dependency.kind, DEPENDENCY_KINDS); oneOf(dependency.basis, DEPENDENCY_BASES)
    if (dependency.fieldId !== null) id(dependency.fieldId)
    list(dependency.evidence, id, 20)
    const source = value.variants.find(v => v.entityId === dependency.from)
    // Observed and reviewed edges need scoped evidence in the source variant; a hypothesis may have none and is never proof.
    if (dependency.basis !== 'hypothesis' && (!source || !dependency.evidence.length)) fail()
    if (dependency.evidence.some(ref => !source?.evidence.some(e => e.id === ref))) fail()
    if (metadata) {
      const to = entityOf.get(dependency.to)
      if (!entityOf.has(dependency.from) || !to || (dependency.fieldId !== null && !to.fields.some(f => f.id === dependency.fieldId))) fail()
    }
  }, PERSISTENCE_LIMITS.dependencies)
  unique(value.dependencies.map(d => d.id))
  object(value.assessment, ['rubricVersion', 'confidence', 'assumptions', 'unknowns'])
  text(value.assessment.rubricVersion, true); oneOf(value.assessment.confidence, CONFIDENCE)
  list(value.assessment.assumptions, text, PERSISTENCE_LIMITS.notes); list(value.assessment.unknowns, text, PERSISTENCE_LIMITS.notes)
  return structuredClone(value)
}

/**
 * Explicit version negotiation. Never throws and never carries input text: the status is a fixed word.
 *   absent              no document: legacy v1 metadata, persistence unknown
 *   unsupported-version a newer or unknown extension version: no facts, never treated as current authority
 *   invalid             malformed, over limits, or dangling references: no facts
 *   current             accepted and usable
 */
export const negotiatePersistence = (value, metadata = null) => {
  if (value === undefined || value === null) return { status: 'absent', persistence: null }
  if (typeof value !== 'object' || Array.isArray(value) || value.extension !== PERSISTENCE_EXTENSION) return { status: 'invalid', persistence: null }
  if (!PERSISTENCE_VERSIONS.includes(value.version)) return { status: 'unsupported-version', persistence: null }
  try { return { status: 'current', persistence: validatePersistence(value, metadata) } } catch { return { status: 'invalid', persistence: null } }
}

/**
 * What a layer of one entity variant says about a field name. Layers never vouch for each other: a physical column list
 * says nothing about fields inside a serialized payload, and a type does not establish persistence.
 *   present / absent-in-layer / unknown
 * Absence needs: the extension current and bound to this metadata, entity and variant not stale or conflicting, no truncation,
 * and the layer itself complete.
 */
export const persistedFieldPresence = (snapshot, entityId, layer, name) => {
  const entity = snapshot?.entities?.find(e => e.id === entityId)
  const extension = snapshot?.persistence
  if (!entity || !extension || extension.status !== 'current' || snapshot.stale || snapshot.coverage?.truncated || entity.stale || entity.conflict) return 'unknown'
  const variant = extension.document.variants.find(v => v.entityId === entityId)
  const found = variant?.layers.find(l => l.kind === layer)
  if (!variant || !found || extension.freshness.find(f => f.entityId === entityId)?.stale !== false) return 'unknown'
  const wanted = String(name).toLowerCase()
  const names = new Map(entity.fields.map(f => [f.id, f.name.toLowerCase()]))
  if (variant.fields.some(f => f.layer === layer && names.get(f.fieldId) === wanted)) return 'present'
  return found.coverage === 'complete' ? 'absent-in-layer' : 'unknown'
}

/** Runtime projection the browser may receive: the validated document plus the server's freshness flags per variant. */
export const validatePersistenceSnapshot = (value, metadata = null) => {
  object(value, ['status', 'identity', 'document', 'freshness'], ['status'])
  oneOf(value.status, ['absent', 'unsupported-version', 'invalid', 'stale-base', 'current'])
  if (value.status !== 'current') { if (['identity', 'document', 'freshness'].some(k => value[k] !== undefined)) fail(); return structuredClone(value) }
  if (!/^[a-f0-9]{64}$/.test(value.identity || '')) fail()
  const clean = validatePersistence(value.document, metadata)
  list(value.freshness, entry => {
    object(entry, ['entityId', 'stale', 'evidence'])
    id(entry.entityId); if (typeof entry.stale !== 'boolean') fail()
    list(entry.evidence, ev => { object(ev, ['id', 'verifiedCurrentContent']); id(ev.id); if (typeof ev.verifiedCurrentContent !== 'boolean') fail() }, PERSISTENCE_LIMITS.evidence)
  }, PERSISTENCE_LIMITS.variants)
  if (value.freshness.length !== clean.variants.length || value.freshness.some((f, i) => f.entityId !== clean.variants[i].entityId)) fail()
  return structuredClone(value)
}
