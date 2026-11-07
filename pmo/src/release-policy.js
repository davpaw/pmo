/** Stable semver and version-only release manifests, shared by CLI and guards. */
export const stableVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && value.split('.').every(n => Number.isSafeInteger(Number(n)))
export const nextVersion = (current, bump = 'patch') => {
  if (!stableVersion(current)) throw new Error('Current version must be stable semver (major.minor.patch).')
  const parts = current.split('.').map(Number)
  const index = ['major', 'minor', 'patch'].indexOf(bump)
  let next = bump
  if (index !== -1) {
    parts[index] += 1
    for (let i = index + 1; i < 3; i += 1) parts[i] = 0
    next = parts.join('.')
  }
  if (!stableVersion(next)) throw new Error('Use patch, minor, major or an explicit stable semver version.')
  const target = next.split('.').map(Number), prior = current.split('.').map(Number)
  const first = target.findIndex((n, i) => n !== prior[i])
  if (first === -1 || target[first] < prior[first]) throw new Error('Release version must increase.')
  return next
}
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
export const releaseManifestProblems = changes => {
  const problems = []
  for (const change of changes.filter(c => /(^|\/)package(?:-lock)?\.json$/.test(c.file))) {
    try {
      if (!change.before || !change.after) throw new Error('Manifest additions/deletions are not version bumps.')
      const before = JSON.parse(change.before), after = JSON.parse(change.after)
      const strip = value => {
        const copy = structuredClone(value)
        if (copy.version !== undefined && !stableVersion(copy.version)) throw new Error('Invalid stable version.')
        delete copy.version
        if (change.file.endsWith('package-lock.json') && copy.packages) {
          for (const [path, entry] of Object.entries(copy.packages)) {
            if (path === '' || !path.startsWith('node_modules/')) {
              if (entry.version !== undefined && !stableVersion(entry.version)) throw new Error('Invalid workspace version.')
              delete entry.version
            }
          }
        }
        return copy
      }
      if (!change.file.endsWith('package-lock.json')) nextVersion(before.version, after.version)
      if (canonical(strip(before)) !== canonical(strip(after))) throw new Error('Release branches may change versions only.')
    } catch (error) { problems.push(`${change.file}: ${error.message}`) }
  }
  return problems
}