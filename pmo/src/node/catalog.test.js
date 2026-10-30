import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCatalog } from './catalog-build.js'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const committed = () => JSON.parse(readFileSync(join(ROOT, 'pmo/data/catalog.generated.json'), 'utf8'))

test('catalog.generated.json is fresh: regenerate with npm run pmo -- build', async () => {
  const fresh = await buildCatalog({ root: ROOT })
  assert.equal(JSON.stringify(fresh, null, 2), JSON.stringify(committed(), null, 2))
})

test('every module is declared with an owner, a kind and a state, and the pmo module exists', () => {
  const catalog = committed()
  assert.equal(catalog.modules.length, catalog.counts.modules)
  assert.equal(catalog.counts.built + catalog.counts.planned, catalog.counts.modules)
  for (const m of catalog.modules) {
    assert.ok(m.owns.length > 0, `${m.id} owns nothing`)
    assert.ok(m.kind && m.maturity, `${m.id} needs a kind and maturity`)
  }
  const pmo = catalog.modules.find((m) => m.id === 'pmo')
  assert.equal(pmo.exists, true)
  assert.equal(pmo.hasTests, true)
})

test('no file is owned by two modules', async () => {
  const { git } = await import('./git.js')
  const { globToRegExp } = await import('../isolation.js')
  const catalog = committed()
  const matchers = catalog.modules.map((m) => ({ id: m.id, tests: m.owns.map(globToRegExp) }))
  const files = git(ROOT, ['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean)
  for (const file of files) {
    const owners = matchers.filter((m) => m.tests.some((test) => test.test(file))).map((m) => m.id)
    assert.ok(owners.length <= 1, `${file} is owned by ${owners.join(' and ')}`)
  }
})

test('every module in the plan is declared, and a planned module is used by at least one step', () => {
  const catalog = committed()
  const plan = JSON.parse(readFileSync(join(ROOT, 'pmo/data/plan.json'), 'utf8'))
  const ids = new Set(catalog.modules.map((m) => m.id))
  const used = new Set(plan.workstreams.flatMap((ws) => ws.epics.flatMap((e) => e.steps.flatMap((step) => step.modules ?? []))))
  for (const id of used) assert.ok(ids.has(id), `plan uses undeclared module ${id}`)
  for (const m of catalog.modules.filter((module) => !module.exists)) assert.ok(used.has(m.id), `planned module ${m.id} has no step`)
})

test('an unknown dependency in modules.json is refused', async () => {
  const modulesFile = { modules: { a: { owns: ['a/**'], dependsOn: ['ghost'] } } }
  await assert.rejects(buildCatalog({ root: ROOT, modulesFile }), /unknown module "ghost"/)
})

test('each module that lists dependsOn is listed as a dependent of its targets', () => {
  const catalog = committed()
  const byId = Object.fromEntries(catalog.modules.map((m) => [m.id, m]))
  for (const m of catalog.modules) for (const dep of m.dependsOn) assert.ok(byId[dep]?.dependents.includes(m.id), `${dep} should list ${m.id}`)
})

test('module dependencies have no cycles', () => {
  const byId = Object.fromEntries(committed().modules.map((m) => [m.id, m]))
  const visiting = new Set()
  const done = new Set()
  const visit = (id, path) => {
    assert.ok(!visiting.has(id), `dependency cycle: ${[...path, id].join(' -> ')}`)
    if (done.has(id)) return
    visiting.add(id)
    for (const dep of byId[id].dependsOn) visit(dep, [...path, id])
    visiting.delete(id)
    done.add(id)
  }
  for (const id of Object.keys(byId)) visit(id, [])
})
