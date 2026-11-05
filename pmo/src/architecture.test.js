import test from 'node:test'
import assert from 'node:assert/strict'
import { architectureCommand, DEFAULT_OPTIONS, unknownSecurity, visibleGraph, validateDeclarations } from './architecture/graph.js'
import { createArchitectureClient } from './architecture/client.js'
import { mountAgentPanel } from './agent-panel.js'

test('explicit local architecture commands cannot become arbitrary scan arguments', () => {
  for (const text of ['Show logical flow chart', 'open logical architecture', 'Please build a logical flowchart']) assert.equal(architectureCommand(text), 'open')
  assert.equal(architectureCommand('refresh logical flow chart'), 'refresh')
  for (const text of ['What is a flow chart?', 'refresh logical flow chart && rm -rf /', 'scan /etc', 'show logical flow chart for /private']) assert.equal(architectureCommand(text), null)
})
const graph = () => ({ version: 1, nodes: [{ id: 'a', kind: 'module' }, { id: 'b', kind: 'module', planned: true }, { id: 'db', kind: 'persistence', module: 'a' }].map(n => ({ label: n.id, evidence: [], security: unknownSecurity(), ...n })), edges: [{ id: 'ab', source: 'a', target: 'b' }, { id: 'adb', source: 'a', target: 'db' }] })
test('default view shows module relationships; overlays, planned modules, query and focus filter edges', () => {
  assert.equal(visibleGraph(graph()).nodes.length, 2)
  assert.equal(visibleGraph(graph()).edges.length, 1)
  assert.equal(visibleGraph(graph(), { ...DEFAULT_OPTIONS, persistence: true }).nodes.length, 3)
  assert.equal(visibleGraph(graph(), { ...DEFAULT_OPTIONS, planned: false }).edges.length, 0)
  assert.equal(visibleGraph(graph(), DEFAULT_OPTIONS, 'a').nodes.length, 1)
  assert.equal(visibleGraph(graph(), { ...DEFAULT_OPTIONS, persistence: true }, '', 'a').nodes.length, 3)
})
test('client refresh preserves options, removes deleted selection and retains graph on failures', async () => {
  let revision = 0, fail = false
  const methods = []
  const client = createArchitectureClient({ fetchImpl: async (_, options) => { methods.push(options.method); if (fail) throw Error('offline'); const g = graph(); if (revision++) g.nodes = g.nodes.filter(n => n.id !== 'b'); return { ok: true, json: async () => ({ graph: g }) } } })
  await client.load()
  client.update({ selected: 'b', options: { ...DEFAULT_OPTIONS, security: true } })
  await client.load(true)
  assert.equal(client.state.selected, null); assert.equal(client.state.options.security, true)
  const good = client.state.graph
  fail = true; await assert.rejects(client.load(true), /offline/)
  assert.equal(client.state.graph, good); assert.equal(client.state.busy, false)
  assert.deepEqual(methods, ['GET', 'POST', 'POST'])
})
test('metadata disallows secrets, invalid keys and duplicate IDs', () => {
  assert.deepEqual(validateDeclarations({ version: 1, nodes: [], edges: [] }), [])
  assert.ok(validateDeclarations({ version: 1, nodes: [], edges: [], token: 'secret' }).length)
  assert.ok(validateDeclarations({ version: 1, nodes: [{ id: 'x', kind: 'module', label: 'x', security: { transit: { status: 'declared', type: 'AES', keyBits: -1 } } }], edges: [] }).length)
})
test('agent local commands work without a model and never call the model endpoint', async () => {
  const calls = [], commands = []
  const host = { innerHTML: '', querySelector: () => null, addEventListener() {} }
  const doc = { activeElement: null, body: { dataset: {} } }
  const panel = mountAgentPanel(host, { doc, getRoute: () => '#/', fetchImpl: async path => { calls.push(path); return { ok: true, json: async () => ({ configured: false, usable: false }) } }, onArchitecture: async command => { commands.push(command) } })
  await panel.refreshStatus()
  await panel.ask('show logical flow chart'); await panel.ask('refresh logical flow chart'); await panel.ask('What is next?')
  assert.deepEqual(commands, ['open', 'refresh'])
  assert.ok(calls.every(p => p === '/api/agent/status'))
  assert.match(panel.state.messages.at(-1).text, /Model setup/)
})

test('directed layout keeps dependencies to the right and handles cycles deterministically', async () => {
  const { graphPositions } = await import('./architecture/graph.js')
  const g = graph(), positions = graphPositions(g)
  assert.ok(positions.get('a').x < positions.get('b').x)
  g.edges.push({ id: 'ba', source: 'b', target: 'a' })
  const cyclic = graphPositions(g)
  assert.equal(cyclic.size, 3)
  assert.notDeepEqual(cyclic.get('a'), cyclic.get('b'))
  assert.deepEqual(cyclic, graphPositions(g))
})
