import { readFileSync, lstatSync, realpathSync } from 'node:fs'
import { resolve, relative, posix, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { globToRegExp } from '../isolation.js'
import { unknownSecurity, validateDeclarations } from '../architecture/graph.js'
import { pmoDirectory } from './paths.js'

export const SCAN_LIMITS = Object.freeze({ files: 4000, bytesPerFile: 512 * 1024, totalBytes: 24 * 1024 * 1024, nodes: 6000, edges: 16000 })
const SOURCE = /\.(?:[cm]?[jt]sx?)$/
const EXCLUDE = /(?:^|\/)(?:\.[^/]+|node_modules|dist|build|coverage|vendor|public|fixtures|__tests__)(?:\/|$)|(?:^|\/)(?:credentials|secrets?)(?:[./_-]|$)|\.(?:pem|key|p12|pfx|crt|sqlite|db|lock)$|(?:\.test|\.spec|\.generated|\.min)\./i
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 20)
// Public labels are bounded; URL credentials, queries and fragments never leave the server.
export const publicText = value => String(value ?? '').replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, raw => {
  try { const u = new URL(raw); return `${u.protocol}//${u.host}` } catch { return '[location withheld]' }
}).replace(/(?:Bearer\s+\S+|(?:sk|ghp|gho)_[A-Za-z0-9_-]+|-----BEGIN[^-]+-----)/gi, '[redacted]').replace(/[\x00-\x1f]/g, ' ').slice(0, 240)
const publicLocation = value => publicText(String(value).split(/[?#]/)[0])
const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null
const mergeSecurity = value => ({ ...unknownSecurity(), ...value, transit: { ...unknownSecurity().transit, ...value?.transit }, atRest: { ...unknownSecurity().atRest, ...value?.atRest } })
const cleanSecurity = value => {
  const s = mergeSecurity(value)
  for (const k of ['transit', 'atRest']) s[k].type = publicText(s[k].type)
  s.authentication = publicText(s.authentication); s.authorization = publicText(s.authorization)
  return s
}

export function scanArchitecture({ root, limits = SCAN_LIMITS, now = () => new Date().toISOString() }) {
  const boundary = realpathSync(root), warnings = new Set(), nodes = new Map(), edges = new Map()
  const coverage = { scanned: 0, skipped: 0, unassigned: 0, unsupported: 0, unresolved: 0, bytes: 0, truncated: false }
  const read = file => {
    const full = resolve(boundary, file), rel = relative(boundary, full)
    if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || rel.startsWith(sep)) throw Error('Architecture path is outside the repository.')
    let part = boundary
    for (const component of rel.split(sep)) { part = resolve(part, component); if (lstatSync(part).isSymbolicLink()) throw Error('Architecture scan excludes symlinks.') }
    const stat = lstatSync(full)
    if (!stat.isFile() || stat.size > limits.bytesPerFile || coverage.bytes + stat.size > limits.totalBytes) { coverage.truncated = true; throw Error('Architecture scan size limit reached.') }
    coverage.bytes += stat.size
    const value = readFileSync(full, 'utf8')
    if (value.includes('\0')) throw Error('Binary input excluded.')
    return value
  }
  const directory = pmoDirectory(boundary), modulesPath = `${directory}/data/modules.json`, metadataPath = `${directory}/data/architecture.json`
  let modules
  try { modules = JSON.parse(read(modulesPath)).modules } catch { throw Error('Cannot read safe, bounded PMO module declarations.') }
  if (!modules || typeof modules !== 'object' || Array.isArray(modules) || Object.keys(modules).length > 1000) throw Error('Invalid module declarations.')
  const evidence = (file, line = 1) => ({ file: publicText(file), line })
  const addNode = n => {
    if (!nodes.has(n.id) && nodes.size >= limits.nodes) { coverage.truncated = true; return null }
    const existing = nodes.get(n.id)
    if (existing) { for (const e of n.evidence ?? []) if (existing.evidence.length < 20 && !existing.evidence.some(x => x.file === e.file && x.line === e.line)) existing.evidence.push(e); return existing }
    const node = { security: unknownSecurity(), evidence: [], ...n }
    nodes.set(n.id, node); return node
  }
  const addEdge = (source, target, label, origin, ev, security) => {
    if (!nodes.has(source) || !nodes.has(target)) return
    const id = `edge:${hash(`${source}|${target}|${label}`)}`
    if (edges.size >= limits.edges && !edges.has(id)) { coverage.truncated = true; return }
    if (!edges.has(id)) edges.set(id, { id, source, target, label, origin, evidence: [ev], security: security ?? unknownSecurity() })
    else if (edges.get(id).evidence.length < 20) edges.get(id).evidence.push(ev)
  }
  const ownership = Object.entries(modules).map(([id, m]) => {
    if (!/^[\w.-]{1,100}$/.test(id) || !m || !Array.isArray(m.owns) || !m.owns.every(g => typeof g === 'string' && g.length < 300) || (m.dependsOn && (!Array.isArray(m.dependsOn) || !m.dependsOn.every(d => typeof d === 'string')))) throw Error('Invalid module ownership declarations.')
    addNode({ id: `module:${id}`, kind: 'module', label: publicText(m.title || id), location: publicText(m.owns.join(', ')), planned: true, origin: 'declared', evidence: [evidence(modulesPath)] })
    return { id: `module:${id}`, matchers: m.owns.map(globToRegExp) }
  })
  for (const [id, m] of Object.entries(modules)) for (const dep of m.dependsOn ?? []) {
    if (!nodes.has(`module:${dep}`)) warnings.add('Some declared module dependencies reference missing modules.')
    addEdge(`module:${id}`, `module:${dep}`, 'depends on', 'declared', evidence(modulesPath))
  }
  let files
  try {
    const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: boundary, encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024 })
    files = [...new Set(output.split('\0').filter(Boolean))].sort()
    let ignored = ''
    try { ignored = execFileSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], { cwd: boundary, input: files.join('\0') + '\0', encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024 }) } catch (e) { if (e.status !== 1) throw e }
    const ignoredSet = new Set(ignored.split('\0'))
    files = files.filter(f => !ignoredSet.has(f) && !EXCLUDE.test(f))
  } catch { throw Error('Cannot enumerate repository files safely.') }
  const owners = file => ownership.filter(o => o.matchers.some(m => m.test(file)))
  const fileSet = new Set(files), sources = new Map()
  for (const file of files) {
    if (coverage.scanned >= limits.files) { coverage.truncated = true; break }
    if (!SOURCE.test(file) && !file.endsWith('/package.json') && file !== 'package.json') { if (/\.(py|go|rs|java|cs|rb|php|ya?ml|tf)$/.test(file)) coverage.unsupported++; continue }
    let source
    try { source = read(file) } catch { coverage.skipped++; continue }
    coverage.scanned++
    const owned = owners(file)
    if (!owned.length) coverage.unassigned++
    if (owned.length > 1) warnings.add('Overlapping module ownership found; connections may have multiple owners.')
    for (const owner of owned) nodes.get(owner.id).planned = false
    if (SOURCE.test(file)) sources.set(file, { source, owned })
    else {
      try {
        const pkg = JSON.parse(source)
        for (const dependency of Object.keys(pkg.dependencies ?? {})) for (const owner of owned) {
          const id = `package:${hash(dependency)}`
          addNode({ id, kind: 'package', label: publicText(dependency), origin: 'declared', evidence: [evidence(file)] })
          addEdge(owner.id, id, 'package dependency', 'declared', evidence(file))
        }
      } catch { warnings.add('Some package manifests could not be parsed.') }
    }
  }
  const resolveImport = (file, spec) => {
    if (!spec.startsWith('.')) return null
    const stem = posix.normalize(posix.join(posix.dirname(file), spec))
    const candidates = [stem, ...['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '/index.js', '/index.ts', '/index.tsx'].map(ext => stem + ext)]
    if (/\.[cm]?js$/.test(stem)) candidates.push(stem.replace(/\.[cm]?js$/, '.ts'), stem.replace(/\.[cm]?js$/, '.tsx'))
    return candidates.find(p => fileSet.has(p) && sources.has(p))
  }
  for (const [file, { source, owned }] of sources) {
    if (!owned.length) continue
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    if (ast.parseDiagnostics.length) { warnings.add('Some source has parse errors; observations may be incomplete.'); coverage.unresolved++ }
    const ev = node => evidence(file, ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1)
    const imports = new Map()
    const connection = (node, spec) => {
      if (!spec) { coverage.unresolved++; return }
      if (spec.startsWith('.')) {
        const target = resolveImport(file, spec)
        if (!target) { coverage.unresolved++; return }
        for (const from of owned) for (const to of owners(target)) if (from.id !== to.id) addEdge(from.id, to.id, 'imports', 'observed', ev(node))
      } else if (!spec.startsWith('node:')) {
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
        if (!/^(@[\w.-]+\/)?[\w.-]+$/.test(name)) { coverage.unresolved++; return }
        const id = `package:${hash(name)}`
        addNode({ id, kind: 'package', label: name, origin: 'observed', evidence: [ev(node)] })
        for (const owner of owned) addEdge(owner.id, id, 'imports package', 'observed', ev(node))
      }
    }
    const resource = (node, kind, label, location, relation, security) => {
      for (const owner of owned) {
        const id = `${kind}:${hash(`${owner.id}|${label}|${location || ''}`)}`
        addNode({ id, kind, module: owner.id, label: publicText(label), location: location ? publicLocation(location) : 'Unknown', origin: 'observed', evidence: [ev(node)], security: security ?? unknownSecurity() })
        addEdge(owner.id, id, relation, 'observed', ev(node), security)
      }
    }
    const visit = node => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const spec = literal(node.moduleSpecifier)
        connection(node, spec)
        if (ts.isImportDeclaration(node) && spec) {
          if (node.importClause?.name) imports.set(node.importClause.name.text, spec)
          const binding = node.importClause?.namedBindings
          if (binding && ts.isNamespaceImport(binding)) imports.set(binding.name.text, spec)
          if (binding && ts.isNamedImports(binding)) for (const el of binding.elements) imports.set(el.name.text, `${spec}#${el.propertyName?.text ?? el.name.text}`)
        }
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const expression = node.expression, args = node.arguments ?? [], value = literal(args[0])
        const name = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : ''
        const receiver = ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) ? expression.expression.text : ''
        const binding = imports.get(receiver || name) ?? ''
        if (name === 'require' || expression.kind === ts.SyntaxKind.ImportKeyword) connection(node, value)
        if (/^(get|post|put|patch|delete|options|head|all)$/.test(name) && /^(app|router|server)$/.test(receiver)) {
          if (value?.startsWith('/')) resource(node, 'offered', `${name.toUpperCase()} ${value.split(/[?#]/)[0]}`, value.split(/[?#]/)[0], 'offers')
          else coverage.unresolved++
        }
        if (name === 'fetch' || /^axios(?:#|$)/.test(binding) || /^(axios)$/.test(receiver)) {
          if (value && (/^https?:\/\//.test(value) || value.startsWith('/'))) {
            let location = value.split(/[?#]/)[0], secure = unknownSecurity()
            if (/^https?:/.test(value)) {
              let url
              try { url = new URL(value) } catch { coverage.unresolved++; ts.forEachChild(node, visit); return }
              location = `${url.protocol}//${url.host}`
              secure.transit = { status: 'observed', type: url.protocol === 'https:' ? 'HTTPS (TLS parameters unknown)' : 'HTTP (unencrypted URL)', keyBits: null }
              resource(node, 'integration', location, location, 'calls integration', secure)
            }
            resource(node, 'called', location, location, 'calls', secure)
          } else coverage.unresolved++
        }
        const fsBinding = /^(?:node:)?fs(?:\/promises)?(?:#|$)/.test(binding)
        const fsName = binding.includes('#') ? binding.split('#')[1] : name
        if (fsBinding && /^(readFile|writeFile|appendFile|createReadStream|createWriteStream)(Sync)?$/.test(fsName)) resource(node, 'persistence', 'Filesystem', value && !value.startsWith('/') && !value.includes('..') ? value : 'Unknown / dynamic path', /^(read|createRead)/.test(fsName) ? 'reads' : 'writes')
        if (ts.isNewExpression(node) && /^(better-sqlite3|sqlite3|node:sqlite)(?:#|$)/.test(binding)) resource(node, 'persistence', 'SQLite', value && !value.startsWith('/') ? value : 'Unknown / dynamic path', 'stores in')
        if (/^(pg|redis|ioredis|mongodb)(?:#|$)/.test(binding) && (ts.isNewExpression(node) || /^(createClient|connect)$/.test(name))) resource(node, 'persistence', binding.split('#')[0], 'Unknown / configured at runtime', 'connects to')
        if (/^(?:node:)?crypto(?:#|$)/.test(binding) && /^(createCipheriv|createDecipheriv)$/.test(binding.split('#')[1] ?? name) && value && /^aes-(128|192|256)-(gcm|cbc|ctr)$/i.test(value)) {
          for (const owner of owned) {
            const n = nodes.get(owner.id)
            n.securityObservations ??= []
            if (n.securityObservations.length < 20) n.securityObservations.push({ type: value, keyBits: Number(value.split('-')[1]), evidence: ev(node), note: 'Cipher usage observed; storage/transport coverage unknown.' })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  for (const called of [...nodes.values()].filter(n => n.kind === 'called' && n.location.startsWith('/'))) {
    const offers = [...nodes.values()].filter(n => n.kind === 'offered' && n.location === called.location)
    if (offers.length === 1) addEdge(called.id, offers[0].id, 'matching route (unverified)', 'observed', called.evidence[0])
    else if (offers.length > 1) coverage.unresolved++
  }
  let applicationSecurity = unknownSecurity()
  // Metadata is optional, but a present unsafe or malformed file is an error, never silently ignored.
  let metadataExists = false
  try { lstatSync(resolve(boundary, metadataPath)); metadataExists = true } catch (e) { if (e.code !== 'ENOENT') throw Error('Cannot inspect architecture metadata.') }
  if (metadataExists) {
    let metadata
    try { metadata = JSON.parse(read(metadataPath)) } catch { throw Error('Cannot read safe architecture.json metadata.') }
    const errors = validateDeclarations(metadata)
    if (errors.length) throw Object.assign(Error(errors.join(' ')), { code: 'ARCH_METADATA' })
    applicationSecurity = cleanSecurity(metadata.security)
    for (const n of metadata.nodes) {
      if (n.kind === 'module') {
        const existing = nodes.get(n.id)
        if (!existing || existing.kind !== 'module') { warnings.add('Architecture metadata references a missing module.'); continue }
        existing.security = cleanSecurity(n.security); existing.securityOrigin = 'declared'; existing.evidence.push(evidence(metadataPath))
        if (n.location) existing.location = publicLocation(n.location)
      } else {
        if (nodes.has(n.id) || edges.has(n.id)) throw Error('Architecture metadata ID collides with a discovered resource.')
        if (n.module && !nodes.has(n.module)) { warnings.add('Architecture metadata references a missing module.'); continue }
        addNode({ ...n, label: publicText(n.label), location: publicLocation(n.location || 'Unknown'), security: cleanSecurity(n.security), origin: 'declared', evidence: [evidence(metadataPath)] })
        if (n.module) addEdge(n.module, n.id, n.kind === 'offered' ? 'offers' : 'uses', 'declared', evidence(metadataPath))
      }
    }
    for (const e of metadata.edges) {
      if (!nodes.has(e.source) || !nodes.has(e.target)) { warnings.add('Architecture metadata has unresolved connection references.'); continue }
      if (edges.has(e.id) || nodes.has(e.id)) throw Error('Architecture metadata edge ID collides with a discovered connection.')
      edges.set(e.id, { ...e, label: publicText(e.label), origin: 'declared', evidence: [evidence(metadataPath)], security: cleanSecurity(e.security) })
    }
  }
  warnings.add('Static source evidence is not runtime verification. Dynamic calls, aliases, middleware, deployment and unsupported languages may be missing.')
  if (coverage.truncated) warnings.add('Scan limits reached; this diagram is partial.')
  let revision = 'Unknown'
  try { revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: boundary, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim() } catch { /* unborn repository */ }
  return { version: 1, generatedAt: now(), revision, security: applicationSecurity, evidence: metadataExists ? [evidence(metadataPath)] : [], nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)), coverage, warnings: [...warnings] }
}
