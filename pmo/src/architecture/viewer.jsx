// Canvas adapted from scheduler's FlowDesigner.tsx: React Flow, background,
// controls, minimap, node/edge selection and side inspector. No scheduler API required.
import React, { useEffect, useReducer, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import ReactFlow, { Background, Controls, MiniMap, MarkerType, Handle, Position } from 'reactflow'
import 'reactflow/dist/style.css'
import { FlowEdge } from './FlowEdge.tsx'
import { visibleGraph, securitySummary, graphPositions } from './graph.js'
import './viewer.css'

const COLORS = { module: '#355f98', offered: '#297963', called: '#6a58a0', persistence: '#9b702b', integration: '#9a526f', package: '#5e6877' }
const LABELS = { offered: 'Services offered', called: 'Services called', persistence: 'Persistence', integration: 'Integrations', package: 'External packages', locations: 'Locations', security: 'Security', evidence: 'Evidence', planned: 'Planned modules' }
function ArchitectureNode({ data }) {
  const n = data.item
  return <div className="architecture-node" style={{ borderColor: COLORS[n.kind], opacity: n.planned ? .7 : 1 }}>
    <Handle type="target" position={Position.Left} />
    <span className="architecture-kind">{n.kind} · {n.origin}{n.planned ? ' · no scanned source' : ''}</span>
    <strong>{n.label}</strong>
    {data.options.locations && <small>{n.location || 'Location unknown'}</small>}
    {data.options.security && <small className="architecture-security">{securitySummary(n.security)}</small>}
    {data.options.evidence && <small>{n.evidence[0]?.file}:{n.evidence[0]?.line}</small>}
    <Handle type="source" position={Position.Right} />
  </div>
}
const NODE_TYPES = { architecture: ArchitectureNode }, EDGE_TYPES = { flowEdge: FlowEdge }
function Inspector({ item, graph }) {
  const target = item || { label: 'Application', origin: 'declared / unknown', security: graph.security, evidence: graph.evidence ?? [] }
  return <aside className="architecture-inspector" aria-label="Architecture inspector">
    <h3>{target.label}</h3>
    <p>{target.source ? 'Connection' : target.kind || 'Application'} · {target.origin}</p>
    {target.source && <p>{graph.nodes.find(n => n.id === target.source)?.label} → {graph.nodes.find(n => n.id === target.target)?.label}</p>}
    <p><strong>Location:</strong> {target.location || 'Unknown / not recorded'}</p>
    <h4>Security</h4><p className="architecture-security">{securitySummary(target.security)}</p>
    <p>Authentication: {target.security?.authentication || 'Unknown'}<br />Authorization: {target.security?.authorization || 'Unknown'}</p>
    <p className="muted">Source observations and declarations do not verify deployed security.</p>
    {target.securityObservations?.map((s, i) => <p key={i}>{s.type} · {s.keyBits} bits<br />{s.note}<br />{s.evidence.file}:{s.evidence.line}</p>)}
    <h4>Evidence</h4>
    {target.evidence.length ? <ul>{target.evidence.map((e, i) => <li key={i}>{e.file}:{e.line}</li>)}</ul> : <p>No security evidence recorded. Select a module, resource or connection to inspect it.</p>}
  </aside>
}
export function ArchitectureViewer({ client }) {
  const [, redraw] = useReducer(n => n + 1, 0)
  useEffect(() => client.subscribe(redraw), [client])
  useEffect(() => { client.load().catch(() => {}) }, [client])
  const { graph, busy, error, options, query, focus, selected } = client.state
  const visible = useMemo(() => graph ? visibleGraph(graph, options, query, focus) : { nodes: [], edges: [] }, [graph, options, query, focus])
  const nodes = useMemo(() => {
    const modules = visible.nodes.filter(n => n.kind === 'module'), other = visible.nodes.filter(n => n.kind !== 'module')
    const ordered = [...modules, ...other]
    const positions = graphPositions(visible, options.security)
    return ordered.map(n => ({ id: n.id, type: 'architecture', position: positions.get(n.id), data: { item: n, options }, selected: n.id === selected }))
  }, [visible, options, selected])
  const edges = useMemo(() => {
    const groups = new Map()
    for (const e of visible.edges) { const key = `${e.source}|${e.target}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(e.id) }
    return visible.edges.map(e => {
      const group = groups.get(`${e.source}|${e.target}`)
      return { ...e, type: 'flowEdge', selected: e.id === selected, markerEnd: { type: MarkerType.ArrowClosed, color: '#8293a8' }, data: { lane: group.indexOf(e.id) - (group.length - 1) / 2, displayLabel: `${e.label}${options.security ? ` · transit ${e.security.transit.type} · disk ${e.security.atRest.type}` : ''}`, tone: e.origin === 'declared' ? 'yes' : 'neutral' } }
    })
  }, [visible, selected, options.security])
  const chosen = graph && [...graph.nodes, ...graph.edges].find(n => n.id === selected)
  return <section className="architecture">
    <div className="architecture-heading"><div><h2>Logical architecture</h2><p>Explore modules and their connections. Add layers to inspect services, data and security.</p></div>
      <button type="button" className="button" onClick={() => client.load(true).catch(() => {})} disabled={busy}>{busy ? 'Scanning…' : 'Refresh diagram'}</button></div>
    <div className="architecture-options" aria-label="Diagram layers">{Object.entries(LABELS).map(([key, label]) => <label key={key}><input type="checkbox" checked={options[key]} onChange={e => client.update({ options: { ...options, [key]: e.target.checked } })} />{label}</label>)}</div>
    <div className="architecture-filters"><label>Find a node <input type="search" value={query} onChange={e => client.update({ query: e.target.value })} /></label>
      <label>Focus module <select value={focus} onChange={e => client.update({ focus: e.target.value })}><option value="">All modules</option>{graph?.nodes.filter(n => n.kind === 'module').map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select></label></div>
    <div role="status" aria-live="polite">{busy ? 'Scanning the current application…' : graph ? `${visible.nodes.length} nodes · ${visible.edges.length} connections${graph.coverage.truncated ? ' · PARTIAL SCAN' : ''} · scanned ${new Date(graph.generatedAt).toLocaleString()} · revision ${graph.revision} (working files included)` : 'No diagram yet.'}</div>
    {error && <p role="alert" className="architecture-error">{error} {graph ? 'Showing the previous scan.' : 'Use the local PMO dev or preview server to scan.'}</p>}
    {graph && <>
      <p className="muted">Dashed green: declared relationship. Solid: source observation. Arrows point from consumer to dependency or from module to resource.</p>
      <div className="architecture-workspace"><div className="architecture-canvas">
        {nodes.length ? <ReactFlow key={`${graph.generatedAt}:${query}:${focus}:${Object.values(options).join()}`} nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} nodesDraggable={false} nodesConnectable={false} deleteKeyCode={null} onlyRenderVisibleElements
          onNodeClick={(_, n) => client.update({ selected: n.id })} onEdgeClick={(_, e) => client.update({ selected: e.id })} onPaneClick={() => client.update({ selected: null })}
          fitView fitViewOptions={{ maxZoom: .9 }} minZoom={.05}>
          <Background gap={24} size={1} color="#c0cbd9" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={n => COLORS[n.data.item.kind]} />
        </ReactFlow> : <p>No nodes match these layers and filters.</p>}
      </div><Inspector item={chosen} graph={graph} /></div>
      <details className="architecture-coverage"><summary>Scan coverage and limitations</summary><p>{graph.coverage.scanned} files scanned; {graph.coverage.unassigned} unassigned; {graph.coverage.unsupported} unsupported; {graph.coverage.unresolved} unresolved constructs; {graph.coverage.skipped} skipped.</p><ul>{graph.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
      <details><summary>Accessible node and connection list</summary><ul>{visible.nodes.map(n => <li key={n.id}><button onClick={() => client.update({ selected: n.id })}>{n.label} ({n.kind})</button></li>)}</ul><ul>{visible.edges.map(e => <li key={e.id}><button onClick={() => client.update({ selected: e.id })}>{graph.nodes.find(n => n.id === e.source)?.label} → {graph.nodes.find(n => n.id === e.target)?.label}: {e.label}</button></li>)}</ul></details>
    </>}
  </section>
}
export const mountArchitecture = (host, client) => {
  const root = createRoot(host)
  root.render(<ArchitectureViewer client={client} />)
  return () => root.unmount()
}
