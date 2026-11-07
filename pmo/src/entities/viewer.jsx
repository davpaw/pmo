import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ReactFlow, { Background, Controls } from 'reactflow'
import 'reactflow/dist/style.css'
import { visibleEntities } from '../entities.js'

const shown = value => value === null ? 'unknown' : typeof value === 'boolean' ? value ? 'yes' : 'no' : value
const Evidence = ({ entity, ids = entity.evidence.map(e => e.id) }) => <ul>{entity.evidence.filter(e => ids.includes(e.id)).map(e => <li key={e.id}>
  <code>{e.path}:{e.line}–{e.endLine}</code> · {e.symbol} · content SHA-256 <code>{e.sha256}</code> · declared revision {e.revision || 'unknown'} ({e.verifiedRevision ? 'reachable matching commit' : 'not commit-verified'}) · schema version {e.schemaVersion || 'not recorded'} · {e.verifiedCurrentContent ? 'current content matches declaration; not proof of claim truth' : 'unverified/stale evidence'}
</li>)}</ul>
export function EntityViewer({ client, onAsk = null }) {
  const [, repaint] = useState(0)
  const [layers, setLayers] = useState({ relationships: true, owners: false, consumers: false })
  useEffect(() => { const off = client.subscribe(() => repaint(n => n + 1)); client.load().catch(() => {}); return off }, [client])
  const state = client.state, snapshot = state.snapshot, visible = visibleEntities(snapshot, state)
  const selected = snapshot?.entities.find(e => e.id === state.selected)
  const nodes = visible.map((e, i) => ({ id: e.id, position: { x: (i % 3) * 240, y: Math.floor(i / 3) * 140 }, data: { label: `${e.name} · ${e.variant}` } }))
  const edges = layers.relationships ? visible.flatMap(e => e.relationships.filter(r => visible.some(t => t.id === r.target)).map(r => ({ id: `${e.id}:${r.id}`, source: e.id, target: r.target, label: `declared · ${r.cardinality || 'cardinality unknown'}` }))) : []
  const modules = new Map()
  for (const entity of visible) for (const [kind, values] of [['owners', entity.schemaOwner ? [entity.schemaOwner] : []], ['consumers', entity.consumers]]) if (layers[kind]) for (const label of values) {
    const id = `module:${label}`
    if (!modules.has(id)) modules.set(id, { id, position: { x: 760, y: modules.size * 100 }, data: { label: `${kind === 'owners' ? 'schema owner' : 'consumer'}: ${label}` } })
    edges.push({ id: `${entity.id}:${kind}:${id}`, source: kind === 'owners' ? id : entity.id, target: kind === 'owners' ? entity.id : id, label: `declared ${kind}` })
  }
  const filter = (key, label, values) => <label key={key}>{label} <select value={state[key]} onChange={e => client.update({ [key]: e.target.value })}><option value="">All</option>{[...new Set(values.filter(Boolean))].sort().map(v => <option key={v}>{v}</option>)}</select></label>
  return <section className="entities" aria-label="Entity metadata browser">
    <header className="architecture-heading"><div><h2>Entities</h2><p>Public schema metadata only. No records or live deployment verification.</p></div><button type="button" disabled={state.busy} onClick={() => client.load(true).catch(() => {})}>Refresh entities</button></header>
    <div className="architecture-filters"><label>Search entities and fields <input type="search" value={state.query} onChange={e => client.update({ query: e.target.value })} /></label>
      {filter('schemaOwner', 'Schema owner', snapshot?.entities.map(e => e.schemaOwner) || [])}
      {filter('consumer', 'Consumer', snapshot?.entities.flatMap(e => e.consumers) || [])}
      {filter('workspace', 'Workspace', snapshot?.entities.flatMap(e => e.workspaces) || [])}
      {filter('supply', 'Supply', snapshot?.entities.map(e => e.supply) || [])}
      {filter('evidenceClass', 'Evidence class', snapshot?.entities.map(e => e.evidenceClass) || [])}
      {filter('coverage', 'Field coverage', snapshot?.entities.map(e => e.coverage) || [])}</div>
    <p role="status" aria-live="polite">{state.busy ? 'Refreshing public metadata…' : snapshot ? `${visible.length} entities · generated ${snapshot.generatedAt} · ${snapshot.stale ? 'STALE snapshot' : 'current local read'} · ${snapshot.coverage.truncated ? 'TRUNCATED' : 'bounded metadata'} · selected ${selected?.name || 'none'}` : 'Field schema not recorded.'}</p>
    {state.error && <p role="alert">{state.error} {snapshot ? 'Previous valid metadata retained, marked stale.' : ''}</p>}
    {snapshot && <><p>Snapshot identity <code>{snapshot.identity}</code>. Generation time is not production freshness. {snapshot.workingTree}</p>
      <fieldset><legend>Graph layers</legend>{Object.keys(layers).map(key => <label key={key}><input type="checkbox" checked={layers[key]} onChange={e => setLayers({ ...layers, [key]: e.target.checked })} />{key} </label>)}</fieldset>
      <div className="entity-canvas" aria-label="Optional relationship graph; equivalent information follows in lists"><ReactFlow nodes={[...nodes, ...modules.values()]} edges={edges} fitView nodesDraggable={false} nodesConnectable={false} deleteKeyCode={null} onNodeClick={(_, node) => { if (snapshot.entities.some(e => e.id === node.id)) client.update({ selected: node.id }) }}><Background /><Controls showInteractive={false} /></ReactFlow></div>
      <h3>Accessible entity list</h3><ul>{visible.map(e => <li key={e.id}><button type="button" aria-pressed={state.selected === e.id} onClick={() => client.update({ selected: e.id })}>{e.name} · {e.variant} · {e.coverage}{e.stale ? ' · stale' : ''}{e.conflict ? ' · declaration conflict' : ''}</button></li>)}</ul>
      <aside aria-label="Entity inspector">{selected ? <>
        <h3>{selected.name} · {selected.variant}</h3><button type="button" onClick={() => client.update({ selected: null })}>Clear selection</button>{onAsk && <button type="button" onClick={() => onAsk({ entityId: selected.id, snapshotIdentity: snapshot.identity })}>Ask PMO Agent about entity</button>}
        <dl>{['id', 'schemaOwner', 'steward', 'supply', 'sourceSystem', 'privacy', 'evidenceClass', 'coverage'].map(k => <React.Fragment key={k}><dt>{k}</dt><dd>{shown(selected[k])}</dd></React.Fragment>)}<dt>Consumers</dt><dd>{selected.consumers.join(', ') || 'unknown'}</dd><dt>Workspaces</dt><dd>{selected.workspaces.join(', ') || 'unknown'}</dd></dl>
        {selected.conflict && <p role="note">Separate declaration variant: compare base {selected.override.baseEntity}, identity {selected.override.baseIdentity}, owner {selected.override.owner}, version {selected.override.version}. No source facts are overwritten.</p>}
        {selected.coverage === 'not-recorded' && <p>Field schema not recorded; missing fields are unknown, not proven absent.</p>}
        <div className="entity-table"><table><caption>Fields in this scoped variant, not production records</caption><thead><tr>{['Field', 'Type', 'Required', 'Nullable', 'Key', 'Privacy', 'Constraints', 'Evidence'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{selected.fields.map(f => <tr key={f.id}><th scope="row">{f.name}</th><td>{shown(f.type)}</td><td>{shown(f.required)}</td><td>{shown(f.nullable)}</td><td>{shown(f.key)}</td><td>{f.privacy}</td><td>{f.constraints.join(', ') || 'not recorded'}</td><td><Evidence entity={selected} ids={f.evidence} /></td></tr>)}</tbody></table></div>
        <h4>Explicit relationships</h4><ul>{selected.relationships.map(r => <li key={r.id}><button type="button" onClick={() => client.update({ selected: r.target })}>Inspect {snapshot.entities.find(e => e.id === r.target)?.name}</button> · {r.field || 'field unknown'} → {r.targetField || 'target field unknown'} · {r.cardinality || 'cardinality unknown'}<Evidence entity={selected} ids={r.evidence} /></li>)}</ul>
        <h4>Source provenance</h4><Evidence entity={selected} />
      </> : <p>Select an entity in the list or graph.</p>}</aside>
      <details><summary>Coverage and limitations</summary><p>Unsupported {snapshot.coverage.unsupported}; skipped {snapshot.coverage.skipped}; unresolved {snapshot.coverage.unresolved}; truncated {String(snapshot.coverage.truncated)}. Only reviewed JSON descriptors are supported; arbitrary language extraction and deployment introspection are unsupported.</p><ul>{snapshot.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
    </>}
  </section>
}
export const mountEntities = (host, client, options = {}) => { const root = createRoot(host); root.render(<EntityViewer client={client} {...options} />); return () => root.unmount() }