import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateGuardrails, validatePlan, compareIds } from './schema.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'))
const exists = (path) => existsSync(join(ROOT, path))
const moduleIds = Object.keys(read('pmo/data/modules.json').modules)

const openStep = (overrides = {}) => ({
  id: '1.1.1', title: 'T', summary: 'S', status: 'incomplete', modules: ['alpha'],
  effort: { size: 'M' }, risk: { level: 'low', notes: 'n' }, value: { score: 3, why: 'w' }, acceptance: ['a'],
  ...overrides,
})
const planWith = (...steps) => ({ workstreams: [{ id: '1', title: 'W', summary: 's', epics: [{ id: '1.1', title: 'E', summary: 's', steps }] }] })

test('the real plan, guardrails and evidence paths are valid', () => {
  assert.deepEqual(validatePlan(read('pmo/data/plan.json'), { moduleIds, pathExists: exists }), [])
  assert.deepEqual(validateGuardrails(read('pmo/data/guardrails.json'), { pathExists: exists }), [])
})

test('an open step needs effort, risk, value and acceptance criteria', () => {
  const problems = validatePlan(planWith({ id: '1.1.1', title: 'T', summary: 'S', status: 'incomplete', modules: ['alpha'] }))
  const text = problems.join('\n')
  for (const word of ['effort.size', 'risk needs', 'value needs', 'acceptance']) assert.match(text, new RegExp(word))
  assert.deepEqual(validatePlan(planWith(openStep())), [])
})

test('the real plan only uses declared modules, and every module dependency exists', () => {
  const { modules } = read('pmo/data/modules.json')
  for (const [id, module] of Object.entries(modules)) {
    for (const dep of module.dependsOn ?? []) assert.ok(dep in modules, `${id} depends on unknown ${dep}`)
    assert.ok((module.owns ?? []).length > 0, `${id} owns nothing`)
  }
})

test('a complete step passes with evidence', () => {
  const done = { id: '1.1.1', title: 'T', summary: 'S', status: 'complete', modules: ['alpha'], evidence: ['x'] }
  assert.deepEqual(validatePlan(planWith(done), { pathExists: () => true }), [])
})

test('a complete step needs evidence that exists', () => {
  const done = { id: '1.1.1', title: 'T', summary: 'S', status: 'complete', modules: ['alpha'] }
  assert.match(validatePlan(planWith(done)).join('\n'), /needs evidence/)
  assert.match(validatePlan(planWith({ ...done, evidence: ['nope/missing.js'] }), { pathExists: () => false }).join('\n'), /evidence path not found/)
  assert.deepEqual(validatePlan(planWith({ ...done, evidence: ['x'] }), { pathExists: () => true }), [])
})

test('multi-module steps must justify crossing modules', () => {
  assert.match(validatePlan(planWith(openStep({ modules: ['alpha', 'beta'] }))).join('\n'), /crossModuleReason/)
  assert.deepEqual(validatePlan(planWith(openStep({ modules: ['alpha', 'beta'], scope: { crossModuleReason: 'both change together' } }))), [])
})

test('non-blocking questions need a default; unknown modules are reported', () => {
  const question = { id: 'q', ask: 'a', why: 'w', blocking: false }
  assert.match(validatePlan(planWith(openStep({ questions: [question] }))).join('\n'), /needs a default/)
  assert.deepEqual(validatePlan(planWith(openStep({ questions: [{ ...question, default: 'd' }] }))), [])
  assert.match(validatePlan(planWith(openStep()), { moduleIds: ['beta'] }).join('\n'), /unknown module "alpha"/)
})

test('dependency problems: unknown targets, cycles and complete-before-dependency', () => {
  const a = openStep({ id: '1.1.1', dependsOn: ['1.1.2'] })
  const b = openStep({ id: '1.1.2', dependsOn: ['1.1.1'] })
  assert.match(validatePlan(planWith(a, b)).join('\n'), /dependency cycle/)
  assert.match(validatePlan(planWith(openStep({ dependsOn: ['9.9.9'] }))).join('\n'), /unknown step 9\.9\.9/)
  const done = { id: '1.1.2', title: 'T', summary: 'S', status: 'complete', evidence: ['x'], dependsOn: ['1.1.1'] }
  assert.match(validatePlan(planWith(openStep(), done), { pathExists: () => true }).join('\n'), /is complete but depends on 1\.1\.1/)
})

test('ids are numeric, nested and unique', () => {
  assert.match(validatePlan(planWith(openStep({ id: '2.1.1' }))).join('\n'), /must start with "1\.1\."/)
  assert.match(validatePlan(planWith(openStep(), openStep())).join('\n'), /duplicate id 1\.1\.1/)
  assert.deepEqual(['2.10.1', '2.2.1', '1.9.9'].sort(compareIds), ['1.9.9', '2.2.1', '2.10.1'])
})
