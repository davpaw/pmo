import { lstatSync, realpathSync, openSync, readSync, closeSync, constants, fstatSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { ENTITY_LIMITS, safeEntityPath, validateEntityMetadata, validateEntityGovernance } from '../entities.js'
import { pmoDirectory } from './paths.js'

export const contentIdentity = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
/** Fixed host-owned JSON binding. Never import a host adapter, evaluate source or enumerate data stores. */
export function scanEntities({ root, now = () => new Date().toISOString(), publicMetadata: suppliedMetadata, governance: suppliedGovernance }) {
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
  if (!metadata.entities.length) warnings.push('Field schema not recorded. No application or deployment schema was discovered.')
  const identity = contentIdentity({ metadata, coverage })
  // Scan dates are provenance, not authority. Keep every validated governance
  // field except generatedAt in the digest; retain the original dated projection.
  const authority = governance && { version: governance.version, mode: governance.mode, deployment: governance.deployment, declarations: governance.declarations }
  return { version: 1, identity: contentIdentity({ identity, governance: authority }), generatedAt: now(), revision, workingTree: 'working source included; evidence content and declared revision checked separately', stale: false, entities: metadata.entities, coverage, warnings, binding: metadataPath, mode: 'local', ...(governance ? { governance } : {}) }
}