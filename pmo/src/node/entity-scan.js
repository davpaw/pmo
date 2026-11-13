import { lstatSync, realpathSync, openSync, readSync, closeSync, constants, fstatSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { ENTITY_LIMITS, safeEntityPath, validateEntityMetadata, validateEntityGovernance } from '../entities.js'
import { negotiatePersistence, isStoreEvidence } from '../entity-persistence.js'
import { pmoDirectory } from './paths.js'

export const contentIdentity = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
/** Fixed host-owned JSON binding. Never import a host adapter, evaluate source or enumerate data stores. */
export function scanEntities({ root, now = () => new Date().toISOString(), publicMetadata: suppliedMetadata, governance: suppliedGovernance, persistence: suppliedPersistence }) {
  const boundary = realpathSync(root)
  let bytes = 0
  const read = (path, metadata = false) => {
    if (!metadata && !safeEntityPath(path)) throw Error('Unsupported evidence path.')
    const full = resolve(boundary, path), rel = relative(boundary, full)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw Error('Outside root.')
    let part = boundary
    for (const component of rel.split(sep)) { part = resolve(part, component); if (lstatSync(part).isSymbolicLink()) throw Error('Symlinks excluded.') }
    try { execFileSync('git', ['check-ignore', '--no-index', '--quiet', '--', path], { cwd: boundary, timeout: 2000, stdio: 'ignore' }); throw Error('Ignored evidence excluded.') }
    catch (error) { if (error.status !== 1) throw error }
    const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > ENTITY_LIMITS.bytes || bytes + stat.size > 4 * ENTITY_LIMITS.bytes) throw Error('Metadata byte limit.')
      bytes += stat.size
      // Read at most the inspected size plus one; concurrent growth cannot allocate an unbounded buffer.
      const buffer = Buffer.alloc(stat.size + 1)
      const count = readSync(fd, buffer, 0, buffer.length, 0)
      if (count !== stat.size) throw Error('Evidence changed during read.')
      return buffer.subarray(0, count)
    } finally { closeSync(fd) }
  }
  const metadataPath = `${pmoDirectory(boundary)}/data/entities.json`
  let metadata
  try { metadata = validateEntityMetadata(suppliedMetadata ?? JSON.parse(read(metadataPath, true).toString('utf8'))) }
  catch (error) { if (error.code !== 'ENOENT') throw error; metadata = { version: 1, entities: [], coverage: { unsupported: 0, skipped: 0, unresolved: 1, truncated: false } } }
  // Identity of the declared v1 metadata before scan flags are added: the persistence extension is bound to exactly this.
  const metadataIdentity = contentIdentity(metadata)
  const governance = suppliedGovernance === undefined ? undefined : validateEntityGovernance(suppliedGovernance)
  const coverage = { ...metadata.coverage }, warnings = [], sources = new Map()
  let revision = null
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: boundary, timeout: 2000, encoding: 'utf8', maxBuffer: 4096 }).trim() } catch { /* No commit is an explicit unknown. */ }
  for (const entity of metadata.entities) {
    entity.identity = contentIdentity(entity)
    entity.stale = false; entity.conflict = false
    for (const ev of entity.evidence) {
      if (sources.size >= 200 && !sources.has(ev.path)) { entity.stale = true; coverage.truncated = true; coverage.skipped++; continue }
      if (!sources.has(ev.path)) {
        try { const source = read(ev.path); sources.set(ev.path, { hash: contentIdentity(source), lines: source.toString('utf8').split('\n').length }) }
        catch { sources.set(ev.path, null); coverage.unresolved++ }
      }
      const source = sources.get(ev.path)
      ev.verifiedCurrentContent = Boolean(source && source.hash === ev.sha256 && ev.endLine <= source.lines)
      ev.verifiedRevision = false
      if (ev.revision && source) {
        try {
          execFileSync('git', ['merge-base', '--is-ancestor', ev.revision, 'HEAD'], { cwd: boundary, timeout: 2000, stdio: 'ignore' })
          const committed = execFileSync('git', ['show', `${ev.revision}:${ev.path}`], { cwd: boundary, timeout: 2000, maxBuffer: ENTITY_LIMITS.bytes, stdio: ['ignore', 'pipe', 'ignore'] })
          ev.verifiedRevision = contentIdentity(committed) === ev.sha256
        } catch { /* Invalid, unrelated or missing revision is unverified, never trusted. */ }
      }
      if (ev.revision && !ev.verifiedRevision) entity.stale = true
      if (!ev.verifiedCurrentContent) entity.stale = true
    }
    if (entity.stale) warnings.push(`${entity.id}: evidence missing or content changed; completeness unverified.`)
  }
  for (const entity of metadata.entities) if (entity.override) {
    const base = metadata.entities.find(e => e.id === entity.override.baseEntity)
    entity.conflict = true // Separate variants remain visible; never overwrite facts or infer equivalence.
    if (!base || base.identity !== entity.override.baseIdentity || base.stale) entity.stale = true
    warnings.push(`${entity.id}: reviewed declaration variant; compare base identity and resolve differences explicitly.`)
  }
  // Optional persistence extension (4.2.8). Absent means legacy metadata with persistence unknown; an unknown version,
  // an invalid document or one bound to other metadata is reported by fixed status and contributes no facts.
  let persistence = { status: 'absent' }
  {
    let raw = suppliedPersistence
    if (raw === undefined) {
      try { raw = JSON.parse(read(`${pmoDirectory(boundary)}/data/entities.persistence.json`, true).toString('utf8')) }
      catch (error) { if (error.code !== 'ENOENT') persistence = { status: 'invalid' } }
    }
    if (persistence.status === 'absent' && raw !== undefined) {
      const negotiated = negotiatePersistence(raw, metadata)
      if (negotiated.status !== 'current') persistence = { status: negotiated.status }
      else if (negotiated.persistence.base.metadataIdentity !== metadataIdentity) persistence = { status: 'stale-base' }
      else {
        const document = negotiated.persistence, freshness = []
        for (const variant of document.variants) {
          const entry = { entityId: variant.entityId, stale: false, evidence: [] }
          for (const ev of variant.evidence) {
            // Introspected or declared store evidence has no source hash to verify; it is never reported as verified content.
            if (isStoreEvidence(ev)) { entry.evidence.push({ id: ev.id, verifiedCurrentContent: false }); continue }
            if (sources.size >= 200 && !sources.has(ev.path)) { entry.stale = true; coverage.truncated = true; coverage.skipped++; entry.evidence.push({ id: ev.id, verifiedCurrentContent: false }); continue }
            if (!sources.has(ev.path)) {
              try { const source = read(ev.path); sources.set(ev.path, { hash: contentIdentity(source), lines: source.toString('utf8').split('\n').length }) }
              catch { sources.set(ev.path, null); coverage.unresolved++ }
            }
            const source = sources.get(ev.path)
            const verified = Boolean(source && source.hash === ev.sha256 && ev.endLine <= source.lines)
            entry.evidence.push({ id: ev.id, verifiedCurrentContent: verified })
            if (!verified) entry.stale = true
          }
          if (entry.stale) warnings.push(`${variant.entityId}: persistence evidence missing or content changed; persistence completeness unverified.`)
          freshness.push(entry)
        }
        persistence = { status: 'current', identity: contentIdentity(document), document, freshness }
      }
    }
    if (persistence.status === 'unsupported-version' || persistence.status === 'invalid' || persistence.status === 'stale-base') warnings.push(`Persistence extension not used (${persistence.status}); persistence is unknown.`)
  }
  if (!metadata.entities.length) warnings.push('Field schema not recorded. No application or deployment schema was discovered.')
  const identity = contentIdentity({ metadata, coverage })
  // Scan dates are provenance, not authority. Keep every validated governance
  // field except generatedAt in the digest; retain the original dated projection.
  const extensionIdentity = persistence.status === 'current' ? persistence.identity : undefined
  const authority = governance && { version: governance.version, mode: governance.mode, deployment: governance.deployment, declarations: governance.declarations }
  return { version: 1, identity: contentIdentity({ identity, governance: authority, persistence: extensionIdentity }), generatedAt: now(), revision, workingTree: 'working source included; evidence content and declared revision checked separately', stale: false, entities: metadata.entities, coverage, warnings, binding: metadataPath, mode: 'local', ...(governance ? { governance } : {}), ...(persistence.status !== 'absent' ? { persistence } : {}) }
}