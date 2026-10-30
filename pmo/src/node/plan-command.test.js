import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../cli.js'
import { validatePlan } from '../schema.js'
import { git } from './git.js'

const FIXTURE_MODULES = {
  alpha: { title: 'Alpha', summary: 's', kind: 'platform', maturity: 'prototype', owns: ['packages/alpha/**'], dependsOn: [], tags: [] },
  beta: { title: 'Beta', summary: 's', kind: 'platform', maturity: 'prototype', owns: ['packages/beta/**'], dependsOn: [], tags: [] },
}
const FIXTURE_CATALOG = { modules: Object.entries(FIXTURE_MODULES).map(([id, module]) => ({ id, ...module, exists: true, dependents: [] })) }
const DATA = fileURLToPath(new URL('../../data/', import.meta.url))
const PLAN = 'pmo/data/plan.json'

const fixturePlan = () => ({
  version: 1,
  workstreams: [{ id: '1', title: 'W', summary: 's', epics: [{ id: '1.1', title: 'E', summary: 's', steps: [
    { id: '1.1.1', title: 'Done', summary: 's', status: 'complete', modules: ['alpha'], evidence: ['packages/alpha/src/a.js'] },
  ] }] }],
})

const newStep = (overrides = {}) => ({
  title: 'Added by the command', summary: 's', modules: ['alpha'],
  effort: { size: 'S' }, risk: { level: 'low', notes: 'n' }, value: { score: 3, why: 'w' }, acceptance: ['a'], ...overrides,
})

const sandbox = () => {
  const root = mkdtempSync(join(tmpdir(), 'pmo-plan-'))
  const sh = (...args) => git(root, args)
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  sh('init', '-q', '-b', 'main')
  sh('config', 'user.email', 'pmo@example.com')
  sh('config', 'user.name', 'pmo')
  sh('config', 'commit.gpgsign', 'false')
  for (const name of ['project.json', 'guardrails.json']) write(`pmo/data/${name}`, readFileSync(join(DATA, name), 'utf8'))
  write(PLAN, `${JSON.stringify(fixturePlan(), null, 2)}\n`)
  write('pmo/data/catalog.generated.json', JSON.stringify(FIXTURE_CATALOG))
  write('pmo/data/modules.json', JSON.stringify({ version: 1, modules: FIXTURE_MODULES }))
  write('packages/alpha/package.json', '{"name":"@highered/alpha"}')
  write('packages/alpha/src/a.js', 'export const a = 1\n')
  sh('add', '-A')
  sh('commit', '-q', '-m', 'init')
  const lines = []
  const errors = []
  const out = { log: (m) => lines.push(String(m)), error: (m) => errors.push(String(m)) }
  return {
    root, sh, write, lines, errors,
    pmo: (...argv) => run(argv, { root, out }),
    // Runs a command whose questions are answered from `answers`; returns what was asked.
    ask: async (answers, ...argv) => {
      const queue = [...answers]
      const asked = []
      const prompt = async (question) => {
        asked.push(question)
        return queue.shift() ?? ''
      }
      const code = await run(argv, { root, out, prompt })
      return { code, asked, left: queue.length }
    },
    plan: () => JSON.parse(readFileSync(join(root, PLAN), 'utf8')),
    text: () => [...lines, ...errors].join('\n'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

const ids = (plan) => plan.workstreams[0].epics[0].steps.map((s) => s.id)

test('template prints a skeleton that parses, with the allowed values beside it', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  assert.equal(await s.pmo('plan', 'template'), 0)
  const skeleton = JSON.parse(s.lines.join('\n'))
  assert.deepEqual(Object.keys(skeleton).slice(0, 3), ['title', 'summary', 'kind'])
  assert.match(s.errors.join('\n'), /effort\.size: XS \| S \| M \| L \| XL/)
})

test('add refuses off a plan branch, and nothing is written', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  const before = readFileSync(join(s.root, PLAN), 'utf8')
  assert.equal(await s.pmo('plan', 'add', '--epic', '1.1', '--json', JSON.stringify(newStep())), 1)
  assert.match(s.text(), /runs on a plan\/<slug> branch/)
  assert.equal(readFileSync(join(s.root, PLAN), 'utf8'), before)
})

test('dry run checks a step on any branch without writing', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  const before = readFileSync(join(s.root, PLAN), 'utf8')
  assert.equal(await s.pmo('plan', 'add', '--epic', '1.1', '--json', JSON.stringify(newStep()), '--dry-run'), 0)
  assert.match(s.text(), /1\.1\.2 would be added/)
  assert.equal(readFileSync(join(s.root, PLAN), 'utf8'), before)
})

test('add on a plan branch inserts the step with the next id and leaves the rest alone', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  s.sh('switch', '-q', '-c', 'plan/more')
  assert.equal(await s.pmo('plan', 'add', '--epic', '1.1', '--json', JSON.stringify(newStep())), 0)
  assert.match(s.text(), /added 1\.1\.2: Added by the command/)
  const plan = s.plan()
  assert.deepEqual(ids(plan), ['1.1.1', '1.1.2'])
  assert.equal(plan.workstreams[0].epics[0].steps[1].status, 'roadmap')
  assert.deepEqual(plan.workstreams[0].epics[0].steps[0], fixturePlan().workstreams[0].epics[0].steps[0])
})

test('the epic can come from the step id, and the step can be read from a file', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  s.sh('switch', '-q', '-c', 'plan/more')
  const file = join(s.root, 'step.json')
  writeFileSync(file, JSON.stringify(newStep({ id: '1.1.5' })))
  assert.equal(await s.pmo('plan', 'add', '--file', file), 0)
  assert.deepEqual(ids(s.plan()), ['1.1.1', '1.1.5'])
})

test('a step that fails the schema lists every problem and writes nothing', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  s.sh('switch', '-q', '-c', 'plan/more')
  const before = readFileSync(join(s.root, PLAN), 'utf8')
  assert.equal(await s.pmo('plan', 'add', '--epic', '1.1', '--json', JSON.stringify({ title: 'Only a title', modules: ['nope'] })), 1)
  const text = s.text()
  for (const part of ['summary is required', 'unknown module "nope"', 'effort.size', 'acceptance', 'Nothing was written']) assert.match(text, new RegExp(part))
  assert.equal(readFileSync(join(s.root, PLAN), 'utf8'), before)
})

test('add needs exactly one source, valid JSON and a known epic', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  s.sh('switch', '-q', '-c', 'plan/more')
  assert.equal(await s.pmo('plan', 'add', '--epic', '1.1'), 1)
  assert.match(s.text(), /--file <step\.json> or --json/)
  assert.equal(await s.pmo('plan', 'add', '--epic', '1.1', '--json', '{not json'), 1)
  assert.match(s.text(), /not valid JSON/)
  assert.equal(await s.pmo('plan', 'add', '--epic', '7.7', '--json', JSON.stringify(newStep())), 1)
  assert.match(s.text(), /epic 7\.7 is not in the plan/)
  assert.equal(await s.pmo('plan', 'add', '--json', JSON.stringify(newStep())), 1)
  assert.match(s.text(), /name the epic/)
})

test('an unknown plan subcommand prints usage and fails', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  assert.equal(await s.pmo('plan', 'nope'), 1)
  assert.match(s.text(), /usage: pmo plan/)
})

const second = () => newStep({ title: 'Second step' })

const planBranch = (s) => {
  s.sh('switch', '-q', '-c', 'plan/more')
}

const withTwoSteps = async (s) => {
  planBranch(s)
  assert.equal(await s.pmo('plan', 'add', '--epic', '1.1', '--json', JSON.stringify(second())), 0)
  assert.equal(await s.pmo('plan', 'add', '--epic', '1.1', '--json', JSON.stringify(newStep({ title: 'Third step', dependsOn: ['1.1.2'] }))), 0)
}

test('set changes a roadmap step on a plan branch and refuses elsewhere and for fixed fields', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  await withTwoSteps(s)
  assert.equal(await s.pmo('plan', 'set', '1.1.2', '--json', JSON.stringify({ title: 'Renamed', value: { score: 5, why: 'w' } })), 0)
  assert.match(s.text(), /changed 1\.1\.2: Renamed/)
  assert.equal(s.plan().workstreams[0].epics[0].steps[1].title, 'Renamed')
  assert.equal(await s.pmo('plan', 'set', '1.1.2', '--json', JSON.stringify({ status: 'complete' })), 1)
  assert.match(s.text(), /status cannot be changed/)
  assert.equal(await s.pmo('plan', 'set', '1.1.1', '--json', JSON.stringify({ title: 'x' })), 1)
  assert.match(s.text(), /only roadmap steps can be changed/)
  assert.equal(await s.pmo('plan', 'set'), 1)
  assert.match(s.text(), /usage: pmo plan set/)
  s.sh('switch', '-q', 'main')
  assert.equal(await s.pmo('plan', 'set', '1.1.2', '--json', JSON.stringify({ title: 'Other' })), 1)
  assert.match(s.text(), /runs on a plan\/<slug> branch/)
})

test('remove deletes a roadmap step and refuses one that others depend on', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  await withTwoSteps(s)
  assert.equal(await s.pmo('plan', 'remove', '1.1.2'), 1)
  assert.match(s.text(), /1\.1\.3 depends on 1\.1\.2/)
  assert.equal(await s.pmo('plan', 'remove', '1.1.3', '--dry-run'), 0)
  assert.deepEqual(ids(s.plan()), ['1.1.1', '1.1.2', '1.1.3'])
  assert.equal(await s.pmo('plan', 'remove', '1.1.3'), 0)
  assert.match(s.text(), /removed 1\.1\.3/)
  assert.deepEqual(ids(s.plan()), ['1.1.1', '1.1.2'])
  assert.equal(await s.pmo('plan', 'remove', '1.1.1'), 1)
  assert.match(s.text(), /only roadmap steps can be removed/)
})

test('epic and workstream add their first step and take the next ids', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  planBranch(s)
  const epic = { title: 'E2', summary: 's', step: newStep() }
  assert.equal(await s.pmo('plan', 'epic', '--workstream', '1', '--json', JSON.stringify(epic)), 0)
  assert.match(s.text(), /added epic 1\.2: E2, with its first step 1\.2\.1/)
  assert.equal(await s.pmo('plan', 'epic', '--json', JSON.stringify(epic)), 1)
  assert.match(s.text(), /--workstream <id>/)
  const workstream = { title: 'W2', summary: 's', epic }
  assert.equal(await s.pmo('plan', 'workstream', '--json', JSON.stringify(workstream)), 0)
  assert.match(s.text(), /added workstream 2: W2, with epic 2\.1 and its first step 2\.1\.1/)
  const plan = s.plan()
  assert.deepEqual(plan.workstreams.map((ws) => ws.id), ['1', '2'])
  assert.deepEqual(plan.workstreams[0].epics.map((e) => e.id), ['1.1', '1.2'])
  assert.equal(plan.workstreams[1].epics[0].steps[0].id, '2.1.1')
  assert.deepEqual(validatePlan(plan, { moduleIds: ['alpha'] }), [])
})

test('epic and workstream write nothing when the first step is invalid', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  planBranch(s)
  const before = readFileSync(join(s.root, PLAN), 'utf8')
  assert.equal(await s.pmo('plan', 'epic', '--workstream', '1', '--json', JSON.stringify({ title: 'E', summary: 's', step: { title: 'x' } })), 1)
  assert.equal(await s.pmo('plan', 'workstream', '--json', JSON.stringify({ title: 'W', summary: 's' })), 1)
  assert.equal(readFileSync(join(s.root, PLAN), 'utf8'), before)
})

test('template prints epic and workstream skeletons', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  assert.equal(await s.pmo('plan', 'template', 'epic'), 0)
  assert.deepEqual(Object.keys(JSON.parse(s.lines.join('\n'))), ['title', 'summary', 'step'])
  s.lines.length = 0
  assert.equal(await s.pmo('plan', 'template', 'workstream'), 0)
  assert.deepEqual(Object.keys(JSON.parse(s.lines.join('\n'))), ['title', 'summary', 'epic'])
  assert.equal(await s.pmo('plan', 'template', 'nope'), 1)
})

const ANSWERS = ['Interactive step', 'Asked for', 'build', 'alpha', '', 'S', 'low', 'Nothing shared', '4', 'Wanted', '', 'n', 'It works', '']

test('add with no JSON asks for the step, shows it and writes it only after confirmation', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  planBranch(s)
  const before = readFileSync(join(s.root, PLAN), 'utf8')
  const declined = await s.ask(['1.1', ...ANSWERS, 'n'], 'plan', 'add')
  assert.equal(declined.code, 1)
  assert.match(s.text(), /Cancelled\. Nothing was written\./)
  assert.equal(readFileSync(join(s.root, PLAN), 'utf8'), before)

  const accepted = await s.ask(['1.1', ...ANSWERS, 'y'], 'plan', 'add')
  assert.equal(accepted.code, 0)
  assert.equal(accepted.left, 0)
  assert.match(s.text(), /added 1\.1\.2: Interactive step/)
  const step = s.plan().workstreams[0].epics[0].steps[1]
  assert.deepEqual([step.id, step.status, step.value.score, step.acceptance], ['1.1.2', 'roadmap', 4, ['It works']])
})

test('with --epic the epic is not asked for, and a dry run does not ask for confirmation', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  const run = await s.ask(ANSWERS, 'plan', 'add', '--epic', '1.1', '--dry-run')
  assert.equal(run.code, 0)
  assert.equal(run.asked.some((q) => q.startsWith('Epic')), false)
  assert.equal(run.asked.some((q) => q.startsWith('Add 1.1.2')), false)
  assert.match(s.text(), /1\.1\.2 would be added/)
})

test('prompting happens on a plan branch only, before any question is asked', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  const run = await s.ask(['1.1'], 'plan', 'add')
  assert.equal(run.code, 1)
  assert.deepEqual(run.asked, [])
  assert.match(s.text(), /runs on a plan\/<slug> branch/)
})

test('with no JSON and no terminal, add fails with the usage instead of waiting', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  planBranch(s)
  assert.equal(await s.pmo('plan', 'add', '--epic', '1.1'), 1)
  assert.match(s.text(), /--file <step\.json> or --json .*needs a terminal/)
})
