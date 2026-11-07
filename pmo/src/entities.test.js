import test from 'node:test'
import assert from 'node:assert/strict'
import { validateEntityMetadata, fieldPresence, entityCommand, createEntityClient, safeEntityPath, visibleEntities } from './entities.js'
export const fixture = () => ({ version: 1, coverage: { unsupported: 0, skipped: 0, unresolved: 0, truncated: false }, entities: [{
  id: 'person:import', name: 'Person', aliases: ['People'], variant: 'CSV import v1', evidenceClass: 'import', schemaOwner: 'importer', steward: 'operations', consumers: ['directory'], workspaces: ['directory'], supply: 'import', sourceSystem: 'directory source', privacy: 'sensitive-schema', coverage: 'complete', override: null,
  evidence: [{ id: 'schema', path: 'src/person.js', line: 1, endLine: 1, symbol: 'PERSON', sha256: 'a'.repeat(64), revision: null, schemaVersion: '1' }],
  fields: [{ id: 'id', name: 'person_id', type: 'string', required: true, nullable: null, constraints: ['unique'], key: true, privacy: 'sensitive-schema', evidence: ['schema'] }], relationships: [],
}] })
test('closed public contract preserves explicit unknowns and scoped absence', () => {
  const metadata = validateEntityMetadata(fixture()), e = metadata.entities[0]
  assert.equal(e.fields[0].nullable, null)
  assert.equal(fieldPresence(metadata, e, 'pronouns'), 'absent-in-variant')
  e.coverage = 'partial'; assert.equal(fieldPresence(metadata, e, 'pronouns'), 'unknown')
  e.fields.push({ ...e.fields[0], id: 'pronouns', name: 'pronouns', required: false })
  assert.equal(fieldPresence(metadata, e, 'pronouns'), 'present')
  e.stale = true; assert.equal(fieldPresence(metadata, e, 'pronouns'), 'unknown')
  e.stale = false; metadata.coverage.truncated = true; assert.equal(fieldPresence(metadata, e, 'pronouns'), 'unknown')
})
test('reject records/defaults/examples, unsafe prose, paths, invalid references and unproven completeness', () => {
  for (const change of [m => { m.entities[0].rows = ['ROW_CANARY'] }, m => { m.entities[0].fields[0].default = 'VALUE_CANARY' }, m => { m.entities[0].fields[0].examples = ['VALUE_CANARY'] }, m => { m.entities[0].name = 'ghp_FAKE_SECRET_CANARY' }, m => { m.entities[0].steward = 'private@example.invalid' }, m => { m.entities[0].evidence[0].path = '../secrets.json' }, m => { m.entities[0].evidenceClass = 'logical' }, m => { m.entities[0].fields[0].evidence = ['missing'] }, m => { m.entities[0].relationships = [{ id: 'rel', target: 'absent', field: null, targetField: null, cardinality: null, evidence: ['schema'] }] }, m => { m.entities[0].fields = Array(101).fill(m.entities[0].fields[0]) }]) {
    const m = fixture(); change(m); assert.throws(() => validateEntityMetadata(m), /Invalid public/)
  }
  for (const path of ['src/../private.js', '/src/file.js', 'src/.env', 'node_modules/x.js', 'datasets/people.json', 'src/people.csv', 'src\\people.js']) assert.equal(safeEntityPath(path), false)
})
test('model-free entity commands are exact and filters use field/owner/workspace declarations', () => {
  assert.equal(entityCommand('Refresh entities'), 'refresh'); assert.equal(entityCommand('Open entity browser.'), 'show'); assert.equal(entityCommand('show all student rows'), null)
  const state = { query: 'person_id', schemaOwner: 'importer', consumer: 'directory', workspace: 'directory', supply: '', evidenceClass: 'import', coverage: 'complete' }
  assert.equal(visibleEntities(fixture(), state).length, 1)
  assert.equal(visibleEntities(fixture(), { ...state, consumer: 'other' }).length, 0)
})
test('coalesced refresh retains marked stale snapshot on failure and clears removed selection', async () => {
  let calls = 0
  const snapshot = { ...fixture(), identity: 'a'.repeat(64) }
  const client = createEntityClient({ fetchImpl: async () => { calls++; return { ok: calls !== 2, json: async () => ({ snapshot: calls === 3 ? { ...snapshot, entities: [] } : snapshot }) } } })
  await Promise.all([client.load(), client.load()]); assert.equal(calls, 1)
  client.update({ selected: 'person:import' }); await assert.rejects(client.load(true)); assert.equal(client.state.snapshot.stale, true)
  await client.load(true); assert.equal(client.state.selected, null)
})