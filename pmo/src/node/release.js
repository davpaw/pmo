import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { classifyBranch, checkChangedFiles } from '../isolation.js'
import { nextVersion, releaseManifestProblems, stableVersion } from '../release-policy.js'
import { baseRef, currentBranch, git, hasRef, isClean, mergeBase, showAt } from './git.js'

/** Read-only module release facts. Only stable tags reachable from this checkout count. */
export const moduleRelease = (root, module) => {
  const unavailable = { state: 'unavailable', latestTag: null, commit: null, commitsSince: null }
  if (!module.path || !hasRef(root, 'HEAD')) return unavailable
  const prefixes = [...new Set([`${module.id}@`, ...(module.name ? [`${module.name}@`] : [])])]
  const output = git(root, ['tag', '--merged', 'HEAD', '--sort=-version:refname'], { allowFail: true })
  if (output === null) return unavailable
  const tags = output.split('\n').filter(tag => prefixes.some(prefix => tag.startsWith(prefix) && stableVersion(tag.slice(prefix.length))))
  tags.sort((a, b) => {
    const av = a.slice(a.lastIndexOf('@') + 1).split('.').map(Number)
    const bv = b.slice(b.lastIndexOf('@') + 1).split('.').map(Number)
    for (let i = 0; i < 3; i += 1) if (av[i] !== bv[i]) return bv[i] - av[i]
    return a.localeCompare(b)
  })
  const latestTag = tags[0] ?? null
  if (!latestTag) return { state: 'untagged', latestTag: null, commit: null, commitsSince: null }
  const commit = git(root, ['rev-parse', `${latestTag}^{commit}`], { allowFail: true })
  const count = git(root, ['rev-list', '--count', `${latestTag}..HEAD`, '--', `:(literal)${module.path}`], { allowFail: true })
  if (!commit || count === null) return unavailable
  return { state: 'tagged', latestTag, commit, commitsSince: Number(count) }
}

/** Explicit local release only. Never shells out to npm, publishes, pushes or runs integrity scripts. */
export const commandRelease = ({ root, data, args, out, evaluate }) => {
  try {
    if (args.positional.length < 2 || args.positional.length > 3 || Object.keys(args.flags).some(k => !['dry-run', 'base'].includes(k))) throw new Error('Usage: pmo release <module> [patch|minor|major|version] [--dry-run] [--base ref]')
    const branchName = currentBranch(root)
    if (classifyBranch(branchName, data.project).kind !== 'release') throw new Error('Release requires an existing release/<slug> branch; never a step or main branch.')
    if (!isClean(root)) throw new Error('Release requires a clean working tree and index; existing work is retained.')
    const requested = args.positional[1]
    const module = data.catalog.modules.find(m => m.id === requested || m.name === requested)
    if (!module || !/^[a-z0-9][a-z0-9-]*$/.test(module.id)) throw new Error('Choose a declared package module from the catalog.')
    if (!module.path || isAbsolute(module.path) || module.path.split(/[\\/]/).some(p => p === '..' || p === '.')) throw new Error('Module path must stay inside the repository.')
    const path = `${module.path}/package.json`, full = join(root, path)
    if (!existsSync(full)) throw new Error('Module has no package.json; virtual modules cannot be released.')
    if (relative(realpathSync(root), realpathSync(full)).startsWith('..')) throw new Error('Module manifest resolves outside the repository.')
    const base = args.flags.base ?? baseRef(root, data.project)
    if (![data.project.mainBranch, `${data.project.remote}/${data.project.mainBranch}`].includes(base)) throw new Error('Release base must be the configured main branch, not a step or arbitrary ref.')
    if (!hasRef(root, base)) throw new Error('Release base is unavailable; fetch main first.')
    const result = evaluate({ root, data, branchName, base })
    if (result.problems.length) throw new Error(result.problems.map(p => p.message).join('\n'))
    const original = readFileSync(full, 'utf8'), manifest = JSON.parse(original)
    const version = nextVersion(manifest.version, args.positional[2] ?? 'patch')
    const tag = `${module.id}@${version}`
    if (hasRef(root, `refs/tags/${tag}`) || (manifest.name && hasRef(root, `refs/tags/${manifest.name}@${version}`))) throw new Error(`Release tag already exists for ${version}.`)
    const changed = checkChangedFiles([path], { kind: 'release', ok: true }, null, data.project, Object.fromEntries(data.catalog.modules.map(m => [m.id, m])))
    if (changed.length) throw new Error(changed.map(c => `${c.file}: ${c.reason}`).join('\n'))
    // Replace only the top-level version value, preserving whitespace and all other bytes.
    const tokens = [...original.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g)]
    let depth = 0
    const values = []
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i][0]
      if (token === '{' || token === '[') depth += 1
      else if (token === '}' || token === ']') depth -= 1
      else if (depth === 1 && token.startsWith('"') && JSON.parse(token) === 'version' && tokens[i + 1]?.[0] === ':') values.push(tokens[i + 2])
    }
    if (values.length !== 1 || JSON.parse(values[0][0]) !== manifest.version) throw new Error('Manifest must have one unambiguous top-level version field.')
    const value = values[0]
    const updated = `${original.slice(0, value.index)}${JSON.stringify(version)}${original.slice(value.index + value[0].length)}`
    const since = mergeBase(root, base)
    const errors = releaseManifestProblems([{ file: path, before: showAt(root, since, path), after: updated }])
    if (errors.length) throw new Error(errors.join('\n'))
    out.log(`${args.flags['dry-run'] ? 'Would release' : 'Release'} ${tag} on ${branchName}: ${path} (${manifest.version} → ${version}). Local only; no publishing, push or deployment.`)
    if (args.flags['dry-run']) return 0
    writeFileSync(full, updated)
    const final = evaluate({ root, data, branchName, base, commits: false })
    if (final.problems.length) throw new Error(final.problems.map(p => p.message).join('\n'))
    git(root, ['add', '--', path])
    git(root, ['commit', '-m', `release: ${tag}`, '--', path])
    git(root, ['tag', '-a', tag, '-m', `Release ${tag}`])
    out.log(`Created local tag ${tag}. Review the release branch through a PR before any separately authorized publication.`)
    return 0
  } catch (error) {
    out.error(`${error.message}\nNo cleanup or reset is performed; any interrupted release work remains on its owning branch.`)
    return 1
  }
}