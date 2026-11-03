import { pmoDirectory } from './paths.js'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { git } from './git.js'

const repositoryName = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
const safePath = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.split('/').some(p => p === '..' || p === '.' || !p) && !value.includes('\\')
export const fileDigest = bytes => createHash('sha256').update(bytes).digest('hex')
export const projectData = path => !/\.(?:[cm]?[jt]sx?)$/.test(path) && (/^(?:data\/|public\/data\/|\.data\/|\.runtime\/|node_modules\/|dist\/)/.test(path) || /^\.env(?:\.|$)/.test(path))
export const validateUpstream = config => {
  const errors = []
  if (config?.version !== 1 || !repositoryName(config.repository)) errors.push('Upstream needs version 1 and owner/repository.')
  if (!safePath(config?.packagePath) || !safePath(config?.sourcePath)) errors.push('Upstream packagePath and sourcePath must be repository-relative paths.')
  if (!/^[0-9a-f]{40}$/.test(config?.revision || '')) errors.push('Pin the upstream revision to a full Git commit.')
  if (!Array.isArray(config?.contributions)) errors.push('Upstream contributions must be a list.')
  return errors
}
const jsonAt = (root, ref, path) => { try { return JSON.parse(git(root, ['show', `${ref}:${path}`])) } catch { return null } }
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
export const readUpstream = (root, packagePath = pmoDirectory(root)) => {
  const path = join(root, packagePath, 'data/upstream.json')
  return existsSync(path) ? readJson(path) : null
}
const ghFile = (repository, revision, path) => { const data = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/contents/${path}?ref=${revision}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 16 * 1024 * 1024 })); if (data.encoding !== 'base64') throw Error('Source content unavailable'); return Buffer.from(data.content, 'base64') }
const ghRevision = (repository, revision, main) => { const data = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/compare/${revision}...${main}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 })); return ['ahead', 'identical'].includes(data.status) }
const ghPr = (repository, number) => JSON.parse(execFileSync('gh', ['pr', 'view', String(number), '--repo', repository, '--json', 'state,baseRefName,mergeCommit,files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 16 * 1024 * 1024 }))

/** Default source classification is generic. Host exceptions come from the already approved base plan. */
export const checkUpstream = ({ root, packagePath = pmoDirectory(root), base = 'origin/main', planPath = `${packagePath}/data/plan.json`, branch, verifyRemote = false, getPullRequest = ghPr, getSourceFile = ghFile, verifyRevision = ghRevision, config = readUpstream(root, packagePath), changed, basePlan } = {}) => {
  if (!config) return { ok: true, configured: false, errors: [], checked: [] }
  const errors = validateUpstream(config)
  if (errors.length) return { ok: false, configured: true, errors, checked: [] }
  if (config.packagePath !== packagePath) return { ok: false, configured: true, errors: ['Upstream packagePath does not match the checked package.'], checked: [] }
  const since = git(root, ['merge-base', base, 'HEAD'])
  const priorConfig = jsonAt(root, since, `${packagePath}/data/upstream.json`)
  if (priorConfig && ['repository','sourcePath','mainBranch','packagePath'].some(key => (priorConfig[key] || (key === 'mainBranch' ? 'main' : undefined)) !== (config[key] || (key === 'mainBranch' ? 'main' : undefined)))) errors.push('Upstream identity cannot be changed by a host contribution; use a reviewed source migration.')
  const approved = basePlan ?? jsonAt(root, since, planPath)
  const id = /^step\/(\d+\.\d+\.\d+)-/.exec(branch || git(root, ['rev-parse', '--abbrev-ref', 'HEAD']))?.[1]
  const step = approved?.workstreams?.flatMap(w => w.epics).flatMap(e => e.steps).find(s => s.id === id)
  const exceptions = step?.scope?.upstreamExceptions || []
  const files = changed ?? [...new Set([
    ...git(root, ['diff', '--name-only', `${since}...HEAD`]).split('\n'),
    ...git(root, ['diff', '--name-only', 'HEAD']).split('\n'),
    ...git(root, ['ls-files', '--others', '--exclude-standard']).split('\n'),
  ])].filter(Boolean)
  const checked = [], verified = new Map()
  let revisionVerified = null
  for (const file of files) {
    if (!file.startsWith(`${packagePath}/`)) continue
    const relative = file.slice(packagePath.length + 1)
    if (projectData(relative)) continue
    const digest = existsSync(join(root, file)) ? fileDigest(readFileSync(join(root, file))) : 'deleted'
    if (!priorConfig && config.importedFiles?.[relative] === digest) {
      if (verifyRemote) {
        try {
          if (revisionVerified === null) revisionVerified = verifyRevision(config.repository, config.revision, config.mainBranch || 'main')
          if (!revisionVerified || fileDigest(getSourceFile(config.repository, config.revision, `${config.sourcePath}/${relative}`)) !== digest) errors.push(`${file}: imported source does not match the verified upstream revision.`)
        } catch { errors.push(`${file}: upstream import verification unavailable.`) }
      }
      checked.push({ file, kind: 'import', sha256: digest }); continue
    }
    const records = config.contributions.filter(record => record.files?.some(item => item.path === relative && item.sha256 === digest))
    const receipt = records.find(record => record.kind === 'generic' || record.kind === 'host-specific')
    if (!receipt) { errors.push(`${file}: changed PMO source has no content-bound upstream receipt.`); continue }
    if (receipt.kind === 'host-specific') {
      const exception = exceptions.find(entry => entry.path === relative && typeof entry.reason === 'string' && entry.reason.trim().length >= 20)
      if (!exception || typeof receipt.reason !== 'string' || receipt.reason.trim().length < 20) errors.push(`${file}: a host-specific exception needs a reason approved in this step's base plan.`)
      checked.push({ file, kind: 'host-specific', sha256: digest }); continue
    }
    const upstream = receipt.upstream
    const item = receipt.files.find(item => item.path === relative && item.sha256 === digest)
    if (upstream?.repository !== config.repository || !Number.isSafeInteger(upstream?.pullRequest) || upstream.pullRequest <= 0 || !/^[0-9a-f]{40}$/.test(upstream?.commit || '') || !safePath(item.upstreamPath)) {
      errors.push(`${file}: generic receipt needs a repository, PR, full merge commit and upstream source path.`); continue
    }
    if (verifyRemote) {
      const key = `${upstream.repository}#${upstream.pullRequest}`
      if (!verified.has(key)) {
        try { verified.set(key, getPullRequest(upstream.repository, upstream.pullRequest)) } catch { verified.set(key, null) }
      }
      const pr = verified.get(key)
      if (!pr || pr.state !== 'MERGED' || pr.baseRefName !== (config.mainBranch || 'main') || pr.mergeCommit?.oid !== upstream.commit || !pr.files?.some(entry => entry.path === item.upstreamPath)) errors.push(`${file}: upstream contribution is not a verified merged source change on PMO main.`)
    }
    checked.push({ file, kind: 'generic', sha256: digest, upstream: `${upstream.repository}#${upstream.pullRequest}` })
  }
  return { ok: errors.length === 0, configured: true, errors, checked }
}
