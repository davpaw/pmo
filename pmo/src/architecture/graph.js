/** Version 1 public architecture contract; contains metadata, never source or credentials. */
export const KINDS = ['module', 'offered', 'called', 'persistence', 'integration', 'package']
export const DEFAULT_OPTIONS = Object.freeze({ offered: false, called: false, persistence: false, integration: false, package: false, locations: false, security: false, evidence: false, planned: true })
export const unknownSecurity = () => ({ transit: { status: 'unknown', type: 'Unknown', keyBits: null }, atRest: { status: 'unknown', type: 'Unknown', keyBits: null }, authentication: 'Unknown', authorization: 'Unknown' })
export const architectureCommand = (message) => {
  const text = String(message ?? '').trim().toLowerCase().replace(/[.!?]$/, '')
  if (/^(?:please )?(?:show|open|build|generate)(?: me)?(?: the| a)? (?:logical (?:flow ?chart|architecture)(?: diagram)?|application (?:architecture|flow ?chart)(?: diagram)?)$/.test(text)) return 'open'
  if (/^(?:please )?(?:refresh|rescan|redraw)(?: the)? (?:logical (?:flow ?chart|architecture)(?: diagram)?|application (?:architecture|flow ?chart)(?: diagram)?)$/.test(text)) return 'refresh'
  return null
}
export const visibleGraph = (graph, options = DEFAULT_OPTIONS, query = '', focus = '') => {
  const eligible = graph.nodes.filter(n => (n.kind === 'module' || options[n.kind]) && (options.planned || !n.planned))
  const matching = new Set(eligible.filter(n => (!query || `${n.label} ${n.location ?? ''}`.toLowerCase().includes(query.toLowerCase())) && (!focus || n.id === focus || n.module === focus)).map(n => n.id))
  // Focus includes directly connected modules/resources so direction remains interpretable.
  if (focus) for (const edge of graph.edges) {
    if (edge.source === focus) matching.add(edge.target)
    if (edge.target === focus) matching.add(edge.source)
  }
  const nodes = eligible.filter(n => matching.has(n.id)), ids = new Set(nodes.map(n => n.id))
  return { nodes, edges: graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)) }
}
export const securitySummary = security => ['transit', 'atRest'].map(key => {
  const s = security?.[key] ?? unknownSecurity()[key]
  return `${key === 'transit' ? 'In transit' : 'On disk'}: ${s.status} · ${s.type} · key ${s.keyBits == null ? 'unknown' : `${s.keyBits} bits`}`
}).join('\n')

const object = v => v && typeof v === 'object' && !Array.isArray(v)
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 240 && !/[\x00-\x1f]/.test(v)
const id = v => typeof v === 'string' && /^[\w.:/-]{1,160}$/.test(v) && !v.includes('..')
const allowed = (v, keys) => Object.keys(v).every(k => keys.includes(k))
export function validateDeclarations(value) {
  const errors = [], bad = message => errors.push(message)
  if (!object(value) || value.version !== 1 || !allowed(value, ['version', 'nodes', 'edges', 'security'])) return ['architecture.json requires version 1, nodes, edges and optional security only.']
  for (const name of ['nodes', 'edges']) if (!Array.isArray(value[name]) || value[name].length > 1000) bad(`${name} must be an array of at most 1000 items.`)
  const security = (s, where) => {
    if (!object(s) || !allowed(s, ['transit', 'atRest', 'authentication', 'authorization'])) return bad(`${where}: invalid security fields.`)
    for (const k of ['authentication', 'authorization']) if (s[k] !== undefined && !text(s[k])) bad(`${where}: invalid ${k}.`)
    for (const k of ['transit', 'atRest']) if (s[k] !== undefined) {
      const r = s[k]
      if (!object(r) || !allowed(r, ['status', 'type', 'keyBits']) || !['unknown', 'declared', 'none', 'not-applicable'].includes(r.status) || !text(r.type) || !(r.keyBits == null || (Number.isInteger(r.keyBits) && r.keyBits > 0 && r.keyBits <= 65536))) bad(`${where}: invalid ${k} security record.`)
    }
  }
  if (value.security !== undefined) security(value.security, 'application')
  for (const [i, n] of (Array.isArray(value.nodes) ? value.nodes : []).entries()) {
    if (!object(n) || !allowed(n, ['id', 'kind', 'label', 'module', 'location', 'security']) || !id(n.id) || !KINDS.includes(n.kind) || !text(n.label) || (n.module !== undefined && !id(n.module)) || (n.location !== undefined && !text(n.location))) bad(`nodes[${i}]: invalid node.`)
    if (n?.security !== undefined) security(n.security, `nodes[${i}]`)
  }
  for (const [i, e] of (Array.isArray(value.edges) ? value.edges : []).entries()) {
    if (!object(e) || !allowed(e, ['id', 'source', 'target', 'label', 'security']) || !id(e.id) || !id(e.source) || !id(e.target) || !text(e.label)) bad(`edges[${i}]: invalid edge.`)
    if (e?.security !== undefined) security(e.security, `edges[${i}]`)
  }
  for (const kind of ['nodes', 'edges']) {
    const ids = (Array.isArray(value[kind]) ? value[kind] : []).map(n => n?.id)
    if (new Set(ids).size !== ids.length) bad(`${kind}: duplicate IDs.`)
  }
  if (Array.isArray(value.nodes) && Array.isArray(value.edges)) {
    const nodeIds = new Set(value.nodes.map(n => n?.id))
    if (value.edges.some(e => nodeIds.has(e?.id))) bad('Node and edge IDs must not overlap.')
  }
  return errors
}

/** Directed layers keep edges out of node interiors; cycles get a deterministic final column. */
export const graphPositions = (graph, tall = false) => {
  const ids = new Set(graph.nodes.map(n => n.id)), degree = new Map([...ids].map(id => [id, 0])), out = new Map([...ids].map(id => [id, new Set()])), depth = new Map([...ids].map(id => [id, 0]))
  for (const edge of graph.edges) if (ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target && !out.get(edge.source).has(edge.target)) { out.get(edge.source).add(edge.target); degree.set(edge.target, degree.get(edge.target) + 1) }
  const queue = [...ids].filter(id => degree.get(id) === 0).sort(), visited = new Set()
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]; visited.add(id)
    for (const target of out.get(id)) {
      depth.set(target, Math.max(depth.get(target), depth.get(id) + 1))
      degree.set(target, degree.get(target) - 1)
      if (degree.get(target) === 0) queue.push(target)
    }
  }
  const rows = new Map(), result = new Map()
  const cycleDepth = Math.max(0, ...[...visited].map(id => depth.get(id))) + 1
  for (const n of graph.nodes) {
    const level = visited.has(n.id) ? depth.get(n.id) : cycleDepth
    const row = rows.get(level) || 0; rows.set(level, row + 1)
    result.set(n.id, { x: level * 380, y: row * (tall ? 300 : 190) })
  }
  return result
}
