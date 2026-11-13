import { validatePersistenceSnapshot } from './entity-persistence.js'
/** Public metadata v1. Closed schema: no values, executable adapters or arbitrary context. */
export const ENTITY_LIMITS = Object.freeze({ bytes: 512 * 1024, entities: 200, fields: 100, relationships: 100, evidence: 20 })
export const EVIDENCE_CLASSES = ['logical', 'import', 'schema', 'demo', 'deployment-unverified']
const ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/
const PRIVATE = /(?:Bearer\s|(?:sk|ghp|gho)_[\w-]+|-----BEGIN|\b(?:password|token|secret)\s*[:=]|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/|[\x00-\x1f])/i
export const safeEntityPath = path => typeof path === 'string' && path.length <= 240 && !path.includes('\\') && path.split('/').every(p => p && p !== '.' && p !== '..' && !p.startsWith('.')) && !/(?:^|\/)(?:node_modules|dist|build|public|coverage|vendor|fixtures|secrets?|credentials|data|datasets?)(?:\/|$)|\.(?:env|pem|key|db|sqlite|csv|lock)$/i.test(path) && /\.(?:[cm]?[jt]sx?|json)$/.test(path)
const fail = () => { throw Error('Invalid public entity metadata; check the version, closed schema, public text and limits.') }
const object = (value, keys, required = keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)) || required.some(k => !(k in value))) fail()
}
const text = (value, nullable = false) => { if (nullable && value === null) return; if (typeof value !== 'string' || !value.trim() || value.length > 240 || PRIVATE.test(value)) fail() }
const id = value => { if (typeof value !== 'string' || !ID.test(value)) fail() }
const list = (value, check, max) => { if (!Array.isArray(value) || value.length > max) fail(); value.forEach(check) }
const unique = values => { if (new Set(values).size !== values.length) fail() }
const bool = value => { if (value !== null && typeof value !== 'boolean') fail() }
/** Shared closed validators for the v1 contract and its optional extensions. */
export const entityValidators = Object.freeze({ fail, object, text, id, list, unique, bool })
export const validateEntityEvidence = ev => {
  object(ev, ['id', 'path', 'line', 'endLine', 'symbol', 'sha256', 'revision', 'schemaVersion'])
  id(ev.id); if (!safeEntityPath(ev.path)) fail()
  if (!Number.isInteger(ev.line) || ev.line < 1 || !Number.isInteger(ev.endLine) || ev.endLine < ev.line || ev.endLine > 1000000) fail()
  text(ev.symbol); text(ev.schemaVersion, true)
  if (!/^[a-f0-9]{64}$/.test(ev.sha256) || (ev.revision !== null && !/^[a-f0-9]{40}$/.test(ev.revision))) fail()
}
export const validateEntityMetadata = value => {
  object(value, ['version', 'entities', 'coverage'])
  if (value.version !== 1 || JSON.stringify(value).length > ENTITY_LIMITS.bytes) fail()
  object(value.coverage, ['unsupported', 'skipped', 'unresolved', 'truncated'])
  for (const k of ['unsupported', 'skipped', 'unresolved']) if (!Number.isInteger(value.coverage[k]) || value.coverage[k] < 0 || value.coverage[k] > 10000) fail()
  if (typeof value.coverage.truncated !== 'boolean') fail()
  const evidence = validateEntityEvidence
  list(value.entities, entity => {
    object(entity, ['id', 'name', 'aliases', 'variant', 'evidenceClass', 'schemaOwner', 'steward', 'consumers', 'workspaces', 'supply', 'sourceSystem', 'privacy', 'coverage', 'evidence', 'fields', 'relationships', 'override'])
    id(entity.id); text(entity.name); text(entity.variant)
    list(entity.aliases, text, 10); list(entity.consumers, text, 50); list(entity.workspaces, text, 50)
    for (const k of ['schemaOwner', 'steward', 'supply', 'sourceSystem']) text(entity[k], true)
    if (!EVIDENCE_CLASSES.includes(entity.evidenceClass) || !['public-metadata', 'sensitive-schema', 'unknown'].includes(entity.privacy) || !['complete', 'partial', 'not-recorded'].includes(entity.coverage)) fail()
    if (entity.coverage === 'complete' && !['import', 'schema', 'demo'].includes(entity.evidenceClass)) fail()
    list(entity.evidence, evidence, ENTITY_LIMITS.evidence); unique(entity.evidence.map(e => e.id))
    if (entity.coverage === 'complete' && !entity.evidence.length) fail()
    const refs = refs => { list(refs, id, 20); if (!refs.length || refs.some(ref => !entity.evidence.some(e => e.id === ref))) fail() }
    list(entity.fields, field => {
      object(field, ['id', 'name', 'type', 'required', 'nullable', 'constraints', 'key', 'privacy', 'evidence'])
      id(field.id); text(field.name); text(field.type, true); bool(field.required); bool(field.nullable); bool(field.key)
      list(field.constraints, text, 10); refs(field.evidence)
      if (!['public-metadata', 'sensitive-schema', 'unknown'].includes(field.privacy)) fail()
    }, ENTITY_LIMITS.fields)
    unique(entity.fields.map(f => f.id)); unique(entity.fields.map(f => f.name))
    if (entity.coverage === 'not-recorded' && entity.fields.length) fail()
    list(entity.relationships, rel => {
      object(rel, ['id', 'target', 'field', 'targetField', 'cardinality', 'evidence'])
      id(rel.id); id(rel.target); text(rel.field, true); text(rel.targetField, true); refs(rel.evidence)
      if (rel.cardinality !== null && !['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'].includes(rel.cardinality)) fail()
      if (rel.field !== null && !entity.fields.some(f => f.id === rel.field)) fail()
    }, ENTITY_LIMITS.relationships)
    unique(entity.relationships.map(r => r.id))
    if (entity.override !== null) {
      object(entity.override, ['baseEntity', 'baseIdentity', 'owner', 'version', 'evidence'])
      id(entity.override.baseEntity); text(entity.override.owner); text(entity.override.version); refs(entity.override.evidence)
      if (!/^[a-f0-9]{64}$/.test(entity.override.baseIdentity) || entity.override.baseEntity === entity.id) fail()
    }
  }, ENTITY_LIMITS.entities)
  unique(value.entities.map(e => e.id))
  for (const entity of value.entities) for (const rel of entity.relationships) {
    const target = value.entities.find(e => e.id === rel.target)
    if (!target || (rel.targetField !== null && !target.fields.some(f => f.id === rel.targetField))) fail()
  }
  return structuredClone(value)
}
export const entityCommand = message => /^(?:show|open|refresh)\s+(?:the\s+)?(?:entities|entity browser)\s*[.!]?$/i.test(message.trim()) ? (/^refresh/i.test(message.trim()) ? 'refresh' : 'show') : null
export const fieldPresence = (snapshot, entity, name) => {
  if (!entity || snapshot.stale || snapshot.coverage.truncated || entity.stale || entity.conflict) return 'unknown'
  if (entity.fields.some(f => f.name.toLowerCase() === name.toLowerCase())) return 'present'
  return entity.coverage === 'complete' ? 'absent-in-variant' : 'unknown'
}
export const visibleEntities = (snapshot, state) => (snapshot?.entities || []).filter(e => {
  const query = state.query.toLowerCase()
  return [e.name, e.id, ...e.aliases, ...e.fields.map(f => f.name)].some(s => s.toLowerCase().includes(query)) &&
    ['schemaOwner', 'supply', 'evidenceClass', 'coverage'].every(k => !state[k] || e[k] === state[k]) &&
    (!state.workspace || e.workspaces.includes(state.workspace)) && (!state.consumer || e.consumers.includes(state.consumer))
})
/** Closed, deliberately small public projection of host declaration governance. */
export const validateEntityGovernance = value => {
  object(value, ['version', 'generatedAt', 'mode', 'deployment', 'declarations'])
  if (value.version !== 1 || !['local', 'static'].includes(value.mode) || value.deployment !== 'unverified') fail()
  if (value.generatedAt !== null && (typeof value.generatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.generatedAt) || !Number.isFinite(Date.parse(value.generatedAt)))) fail()
  list(value.declarations, d => { object(d, ['entityId', 'status']); if (d.entityId !== null) id(d.entityId); text(d.status) }, 200)
  return structuredClone(value)
}
export const entityEvidenceLink = (repository, evidence) => {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || repository.split('/').some(p => p === '.' || p === '..') || !evidence.verifiedRevision || !/^[a-f0-9]{40}$/.test(evidence.revision || '') || !safeEntityPath(evidence.path) || !Number.isInteger(evidence.line) || evidence.line < 1 || !Number.isInteger(evidence.endLine) || evidence.endLine < evidence.line) return null
  return `https://github.com/${repository}/blob/${evidence.revision}/${evidence.path.split('/').map(encodeURIComponent).join('/')}#L${evidence.line}-L${evidence.endLine}`
}
/** Never accept arbitrary response fields as browser context. */
export const validateEntitySnapshot = value => {
  object(value, ['version', 'identity', 'generatedAt', 'revision', 'workingTree', 'stale', 'entities', 'coverage', 'warnings', 'binding', 'governance', 'mode', 'persistence'], ['version', 'identity', 'entities', 'coverage'])
  if (JSON.stringify(value).length > ENTITY_LIMITS.bytes) fail()
  if (!/^[a-f0-9]{64}$/.test(value.identity || '')) fail()
  const entities = structuredClone(value.entities)
  for (const entity of entities) {
    if (entity.identity !== undefined && !/^[a-f0-9]{64}$/.test(entity.identity)) fail()
    for (const k of ['stale', 'conflict']) if (entity[k] !== undefined && typeof entity[k] !== 'boolean') fail()
    delete entity.identity; delete entity.stale; delete entity.conflict
    for (const ev of entity.evidence || []) { for (const k of ['verifiedCurrentContent', 'verifiedRevision']) if (ev[k] !== undefined && typeof ev[k] !== 'boolean') fail(); delete ev.verifiedCurrentContent; delete ev.verifiedRevision }
  }
  validateEntityMetadata({ version: value.version, entities, coverage: value.coverage })
  if (value.generatedAt !== undefined && (typeof value.generatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.generatedAt) || !Number.isFinite(Date.parse(value.generatedAt)))) fail()
  if (value.revision !== undefined && value.revision !== null && !/^[a-f0-9]{40}$/.test(value.revision)) fail()
  if (value.workingTree !== undefined) text(value.workingTree)
  if (value.binding !== undefined) text(value.binding)
  if (value.stale !== undefined && typeof value.stale !== 'boolean') fail()
  if (value.warnings !== undefined) list(value.warnings, text, 400)
  if (value.governance !== undefined) validateEntityGovernance(value.governance)
  if (value.mode !== undefined && !['local', 'static'].includes(value.mode)) fail()
  if (value.persistence !== undefined) validatePersistenceSnapshot(value.persistence, { entities })
  return structuredClone(value)
}
export const createEntityClient = ({ fetchImpl = (...args) => fetch(...args), staticPath = '/data/entities.json' } = {}) => {
  const state = { snapshot: null, busy: false, error: '', selected: null, query: '', schemaOwner: '', consumer: '', workspace: '', supply: '', evidenceClass: '', coverage: '' }
  let pending = null
  const listeners = new Set(), notify = () => listeners.forEach(fn => fn())
  return { state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }, update(patch) { Object.assign(state, patch); notify() }, load(refresh = false) {
    if (pending) return pending
    if (state.snapshot && !refresh) return Promise.resolve(state.snapshot)
    state.busy = true; state.error = ''; notify()
    pending = Promise.resolve().then(async () => {
      let snapshot
      try {
        const response = await fetchImpl('/api/pmo/entities', { method: refresh ? 'POST' : 'GET', cache: 'no-store' })
        if (!response.ok) throw Error('unavailable')
        snapshot = validateEntitySnapshot((await response.json()).snapshot)
        snapshot.mode = 'local'
      } catch {
        // A failed refresh never replaces valid live results with an older build artifact.
        if (state.snapshot || refresh || staticPath !== '/data/entities.json') throw Error('Entity metadata unavailable. Use the local PMO server and check public declarations.')
        const response = await fetchImpl(staticPath, { cache: 'no-store' })
        if (!response.ok) throw Error('Entity metadata unavailable.')
        snapshot = validateEntitySnapshot(await response.json())
        if (!snapshot.generatedAt) throw Error('Static entity metadata needs an artifact date.')
        snapshot = { ...snapshot, mode: 'static', stale: true, workingTree: 'dated build artifact; local and production freshness unverified' }
      }
      state.snapshot = snapshot
      if (!snapshot.entities.some(e => e.id === state.selected)) state.selected = null
      return snapshot
    }).catch(error => { state.error = error.message; if (state.snapshot) state.snapshot = { ...state.snapshot, stale: true }; throw error }).finally(() => { state.busy = false; pending = null; notify() })
    return pending
  } }
}