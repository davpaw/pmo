import { readFileSync, existsSync, writeFileSync, realpathSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { git, isClean, showAt } from './git.js'
import { pmoDirectory } from './paths.js'
import { previewPlanEdit, planDiff } from '../plan-browser.js'
import { classifyBranch } from '../isolation.js'

const LIMIT = 128 * 1024
const TTL = 5 * 60_000

/** No shell, push, commit, publication, cleanup or deployment. New work remains owned. */
export const createPlanEditor = ({ root, now = Date.now }) => {
  root = realpathSync(root)
  const directory = pmoDirectory(root)
  const project = JSON.parse(readFileSync(join(root, directory, 'data/project.json'), 'utf8'))
  const path = `${directory}/data/plan.json`
  const base = `${project.remote}/${project.mainBranch}`
  const previews = new Map()
  const state = () => {
    if (!isClean(root)) throw Error('Serving checkout has uncommitted work. Commit it before editing a plan.')
    const head = git(root, ['rev-parse', 'HEAD'])
    const baseHead = git(root, ['rev-parse', '--verify', base])
    const text = showAt(root, baseHead, path)
    if (!text) throw Error('Canonical plan unavailable. Fetch main locally and retry.')
    const catalog = JSON.parse(showAt(root, baseHead, `${directory}/data/catalog.generated.json`))
    const moduleIds = catalog.modules.map(m => m.id)
    return { head, baseHead, text, context: { moduleIds, pathExists: p => typeof p === 'string' && !p.startsWith('/') && !p.split('/').includes('..') && showAt(root, baseHead, p) !== null } }
  }
  return {
    read: () => { const s = state(); return { plan: JSON.parse(s.text), base, baseHead: s.baseHead } },
    preview: request => {
      if (!request || typeof request.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,48}$/.test(request.slug)) throw Error('Use a lowercase plan slug, up to 49 characters.')
      const branch = `plan/${request.slug}`
      if (classifyBranch(branch, project).kind !== 'plan') throw Error('Invalid plan branch.')
      if (git(root, ['show-ref', '--verify', `refs/heads/${branch}`], { allowFail: true }) !== null) throw Error('That local plan branch already exists. Choose a new slug.')
      const s = state()
      const next = previewPlanEdit(s.text, request, s.context)
      for (const [key, value] of previews) if (value.expires <= now()) previews.delete(key)
      if (previews.size >= 20) throw Error('Too many pending previews. Wait five minutes and retry.')
      const token = randomUUID()
      previews.set(token, { ...s, next, branch, request: structuredClone(request), expires: now() + TTL })
      return { token, branch, base, baseHead: s.baseHead, diff: planDiff(s.text, next, path), expiresAt: new Date(now() + TTL).toISOString() }
    },
    confirm: request => {
      if (request?.confirmed !== true) throw Error('Explicit confirmation is required. Nothing was written.')
      const p = previews.get(request.token)
      previews.delete(request.token)
      if (!p || p.expires <= now()) throw Error('Preview expired or already used. Preview again.')
      const s = state()
      if (s.head !== p.head || s.baseHead !== p.baseHead || s.text !== p.text || previewPlanEdit(s.text, p.request, s.context) !== p.next) throw Error('Checkout or canonical plan changed. Preview again.')
      const worktree = resolve(dirname(root), `${basename(root)}-plan-${p.request.slug}-${randomUUID().slice(0, 8)}`)
      if (existsSync(worktree)) throw Error('Worktree location already exists.')
      git(root, ['worktree', 'add', '-b', p.branch, worktree, p.baseHead])
      try {
        writeFileSync(join(worktree, path), p.next)
        const files = git(worktree, ['diff', '--name-only']).split('\n')
        if (files.length !== 1 || files[0] !== path) throw Error('Unexpected worktree diff.')
      } catch (error) { throw Error(`Plan worktree retained at ${worktree} on ${p.branch}; inspect it before retrying: ${error.message}`) }
      return { branch: p.branch, worktree, path, message: 'Plan diff saved, not committed or pushed. Validate, commit as plan: ..., and open a reviewed PR. Main is unchanged.' }
    },
  }
}

export const createPlanMiddleware = ({ editor }) => async (req, res, next) => {
  const path = String(req.url).split('?')[0]
  if (!['/api/pmo/plan', '/api/pmo/plan/preview', '/api/pmo/plan/confirm'].includes(path)) return next()
  const send = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.end(JSON.stringify(body)) }
  const host = req.headers.host || ''
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return send(403, { error: 'Plan editing is loopback only.' })
  if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return send(403, { error: 'Use the same local origin.' })
  if (req.method === 'GET' && path === '/api/pmo/plan') {
    try { return send(200, editor.read()) } catch (e) { return send(409, { error: e.message }) }
  }
  if (req.method !== 'POST' || path === '/api/pmo/plan') return send(405, { error: 'Unsupported method.' })
  if (req.headers.origin !== `http://${host}` || req.headers['content-type']?.split(';')[0] !== 'application/json') return send(403, { error: 'Same-origin JSON requests are required.' })
  try {
    let body = '', bytes = 0
    for await (const chunk of req) { bytes += Buffer.byteLength(chunk); if (bytes > LIMIT) return send(413, { error: 'Request too large.' }); body += chunk }
    const request = JSON.parse(body)
    return send(200, path.endsWith('/preview') ? editor.preview(request) : editor.confirm(request))
  } catch (e) { return send(400, { error: e.message }) }
}

export const pmoPlanPlugin = ({ root }) => ({ name: 'pmo-plan-editor', configureServer(server) { server.middlewares.use(createPlanMiddleware({ editor: createPlanEditor({ root }) })) } })