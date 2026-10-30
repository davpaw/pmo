import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  STEP_TEMPLATE, TEMPLATE_HINTS, insertEpic, insertStep, insertWorkstream, nextStepId, prepareEpic, prepareRemove, prepareSet, prepareStep, prepareWorkstream, removeStep, renderStep, replaceStep,
} from './plan-edit.js'
import { validatePlan } from './schema.js'

const PLAN_TEXT = readFileSync(fileURLToPath(new URL('../data/plan.json', import.meta.url)), 'utf8')
const plan = JSON.parse(PLAN_TEXT)
const MODULES = ['pmo', 'schedule-optimizer', 'pilot-scheduler']

const draft = (overrides = {}) => ({
  title: 'A new step',
  summary: 'What it does.',
  modules: ['pmo'],
  effort: { size: 'S' },
  risk: { level: 'low', notes: 'Nothing shared changes.' },
  value: { score: 3, why: 'It is wanted.' },
  acceptance: ['It works'],
  ...overrides,
})

const allSteps = (p) => p.workstreams.flatMap((ws) => ws.epics.flatMap((epic) => epic.steps))
const epicSteps = (p, id) => p.workstreams.flatMap((ws) => ws.epics).find((epic) => epic.id === id).steps

test('the next id follows the highest in the epic', () => {
  const highest = Math.max(...epicSteps(plan, '4.1').map((s) => Number(s.id.split('.')[2])))
  assert.equal(nextStepId(plan, '4.1'), `4.1.${highest + 1}`)
  assert.equal(nextStepId(plan, '9.9'), null)
})

test('a valid draft gets the next id and is added as roadmap', () => {
  const { step, problems } = prepareStep(plan, '6.1', draft(), { moduleIds: MODULES })
  assert.deepEqual(problems, [])
  assert.equal(step.id, nextStepId(plan, '6.1'))
  assert.equal(step.status, 'roadmap')
})

test('empty optional lists are not written', () => {
  const { step } = prepareStep(plan, '6.1', draft({ dependsOn: [], tags: [], questions: [] }), { moduleIds: MODULES })
  for (const key of ['dependsOn', 'tags', 'questions']) assert.equal(key in step, false)
})

test('every problem in a bad draft is reported', () => {
  const { step, problems } = prepareStep(plan, '6.1', { title: 'No more than this' }, { moduleIds: MODULES })
  assert.equal(step, null)
  const text = problems.join('\n')
  for (const part of ['summary is required', 'modules is required', 'effort.size', 'risk needs', 'value needs', 'acceptance']) assert.match(text, new RegExp(part))
})

test('the template fails validation until it is filled in', () => {
  assert.equal(prepareStep(plan, '6.1', structuredClone(STEP_TEMPLATE), { moduleIds: MODULES }).step, null)
})

test('the template and its hints list the fields a draft needs', () => {
  assert.ok(TEMPLATE_HINTS.some((line) => /effort/.test(line)))
  assert.ok(!('onboarding' in STEP_TEMPLATE))
})

test('a draft cannot be complete, carry completion fields, or take another epic\'s or a used id', () => {
  const refuse = (overrides, pattern) => {
    const { step, problems } = prepareStep(plan, '6.1', draft(overrides), { moduleIds: MODULES })
    assert.equal(step, null)
    assert.match(problems.join('\n'), pattern)
  }
  refuse({ status: 'complete' }, /added as roadmap/)
  refuse({ evidence: ['packages/pmo/src/cli.js'] }, /evidence is set when a step is completed/)
  refuse({ completedAt: '2026-10-22' }, /completedAt is set/)
  refuse({ id: '4.4.1' }, /does not belong to epic 6\.1/)
  refuse({ id: '6.1.1' }, /already used/)
})

test('an unknown epic or module and a dependency on a missing step are refused', () => {
  assert.match(prepareStep(plan, '9.9', draft()).problems[0], /epic 9\.9 is not in the plan/)
  assert.match(prepareStep(plan, '6.1', draft({ modules: ['nope'] }), { moduleIds: MODULES }).problems.join(), /unknown module "nope"/)
  assert.match(prepareStep(plan, '6.1', draft({ dependsOn: ['9.9.9'] }), { moduleIds: MODULES }).problems.join(), /unknown step 9\.9\.9/)
})

test('problems the plan already had are not blamed on the new step', () => {
  const broken = structuredClone(plan)
  allSteps(broken).find((s) => s.status === 'roadmap').acceptance = []
  const { step, problems } = prepareStep(broken, '6.1', draft(), { moduleIds: MODULES })
  assert.deepEqual(problems, [])
  assert.ok(step)
})

test('insertion adds only the new step to the real plan file, and the plan stays valid', () => {
  const { step } = prepareStep(plan, '6.1', draft({ dependsOn: ['6.1.1'], tags: ['pmo'] }), { moduleIds: MODULES })
  const next = insertStep(PLAN_TEXT, '6.1', step)
  const parsed = JSON.parse(next)
  assert.equal(allSteps(parsed).length, allSteps(plan).length + 1)
  assert.deepEqual(epicSteps(parsed, '6.1').at(-1), step)
  assert.deepEqual(validatePlan(parsed, { moduleIds: MODULES }).filter((p) => p.includes(step.id)), [])
  // Everything before the end of the epic's steps is byte-for-byte what it was.
  const at = PLAN_TEXT.indexOf('"id": "6.1.9"')
  assert.equal(next.slice(0, at), PLAN_TEXT.slice(0, at))
  // And the rest of the file after the epic is untouched.
  const tail = PLAN_TEXT.slice(PLAN_TEXT.indexOf('"id": "7"'))
  assert.ok(next.endsWith(tail))
})

test('the inserted text uses the layout of the file around it', () => {
  const { step } = prepareStep(plan, '6.1', draft({ dependsOn: ['6.1.1'] }), { moduleIds: MODULES })
  const lines = renderStep(step, '            ').split('\n')
  assert.equal(lines[0], '            {')
  assert.match(lines[1], /^ {14}"id": "6\.1\.\d+", "title": "A new step", "summary": "What it does\."/)
  assert.match(lines[2], /^ {14}"status": "roadmap", "modules": \["pmo"\], "dependsOn": \["6\.1\.1"\]/)
  assert.ok(lines.some((l) => l === '              "effort": { "size": "S" },'))
  assert.ok(lines.includes('              "acceptance": ["It works"]'), 'acceptance is the last field, so it has no trailing comma')
  assert.match(lines.at(-2), /^ {14}"acceptance": \["It works"\]$/)
  assert.equal(lines.at(-1), '            }')
})

test('insertion works for a file written with plain two-space indentation', () => {
  const small = { version: 1, workstreams: [{ id: '1', title: 'W', summary: 's', epics: [{ id: '1.1', title: 'E', summary: 's', steps: [
    { id: '1.1.1', title: 'Done', summary: 's', status: 'complete', modules: ['alpha'], evidence: ['a'] },
  ] }] }] }
  const text = `${JSON.stringify(small, null, 2)}\n`
  const { step, problems } = prepareStep(small, '1.1', draft({ modules: ['alpha'] }), { moduleIds: ['alpha'], pathExists: () => true })
  assert.deepEqual(problems, [])
  const parsed = JSON.parse(insertStep(text, '1.1', step))
  assert.deepEqual(parsed.workstreams[0].epics[0].steps.map((s) => s.id), ['1.1.1', '1.1.2'])
})

test('insertion into an epic that is not in the file throws and returns nothing', () => {
  assert.throws(() => insertStep(PLAN_TEXT, '9.9', { id: '9.9.1' }), /epic 9\.9 not found/)
})

test('brackets and quotes inside strings do not confuse the insertion point', () => {
  const tricky = { version: 1, workstreams: [{ id: '1', title: 'W', summary: 's', epics: [{ id: '1.1', title: 'E ] [ "x"', summary: 's', steps: [
    { id: '1.1.1', title: 'a ] b [ "c" \\', summary: 'ends with ]', status: 'complete', modules: ['alpha'], evidence: ['a'] },
  ] }] }] }
  const { step } = prepareStep(tricky, '1.1', draft({ modules: ['alpha'], title: 'Has ] and [ and "quotes"' }), { moduleIds: ['alpha'], pathExists: () => true })
  const parsed = JSON.parse(insertStep(JSON.stringify(tricky, null, 2), '1.1', step))
  assert.equal(parsed.workstreams[0].epics[0].steps.length, 2)
  assert.equal(parsed.workstreams[0].epics[0].steps[1].title, 'Has ] and [ and "quotes"')
})

/* ---------------------------------------------------- change or remove a step */

const open = (p) => allSteps(p).find((s) => s.status === 'roadmap' && !allSteps(p).some((o) => (o.dependsOn ?? []).includes(s.id)))
const lineDiff = (a, b) => {
  const left = a.split('\n')
  const right = b.split('\n')
  return { removed: left.filter((l) => !right.includes(l)), added: right.filter((l) => !left.includes(l)) }
}

test('set changes fields of a roadmap step; null removes one', () => {
  const target = open(plan)
  const { step, problems } = prepareSet(plan, target.id, { value: { score: 5, why: 'Changed.' }, tags: null }, { moduleIds: MODULES.concat(target.modules) })
  assert.deepEqual(problems, [])
  assert.deepEqual(step.value, { score: 5, why: 'Changed.' })
  assert.equal('tags' in step, false)
  assert.equal(step.id, target.id)
})

test('set refuses a step that is not roadmap, fixed fields, an empty change and a no-op', () => {
  const done = allSteps(plan).find((s) => s.status === 'complete')
  assert.match(prepareSet(plan, done.id, { title: 'x' }).problems.join(), /only roadmap steps can be changed/)
  assert.match(prepareSet(plan, '9.9.9', { title: 'x' }).problems.join(), /not in the plan/)
  const target = open(plan)
  for (const field of ['id', 'status', 'evidence', 'completedAt', 'notes']) assert.match(prepareSet(plan, target.id, { [field]: 'x' }).problems.join(), new RegExp(`${field} cannot be changed`))
  assert.match(prepareSet(plan, target.id, {}).problems.join(), /non-empty JSON object/)
  assert.match(prepareSet(plan, target.id, { title: target.title }).problems.join(), /nothing would change/)
})

test('set reports only what the change breaks', () => {
  const target = open(plan)
  const { step, problems } = prepareSet(plan, target.id, { acceptance: [], dependsOn: [target.id] }, { moduleIds: MODULES.concat(target.modules) })
  assert.equal(step, null)
  const text = problems.join('\n')
  assert.match(text, /acceptance/)
  assert.match(text, /cannot depend on itself/)
})

test('replaceStep rewrites one step and leaves every other line of the file as it was', () => {
  const target = open(plan)
  const changed = { ...target, value: { score: 5, why: 'Changed.' } }
  const next = replaceStep(PLAN_TEXT, target.id, changed)
  assert.deepEqual(allSteps(JSON.parse(next)).find((s) => s.id === target.id).value, changed.value)
  const { removed, added } = lineDiff(PLAN_TEXT, next)
  assert.ok(removed.length <= 12 && added.length <= 12, `${removed.length} removed, ${added.length} added`)
  assert.equal(allSteps(JSON.parse(next)).length, allSteps(plan).length)
})

test('remove refuses a step something depends on, a step that is not roadmap and the last step of an epic', () => {
  const withRoadmap = structuredClone(plan)
  const depended = allSteps(withRoadmap).find((s) => s.status !== 'complete' && allSteps(withRoadmap).some((o) => (o.dependsOn ?? []).includes(s.id)))
  depended.status = 'roadmap'
  assert.match(prepareRemove(withRoadmap, depended.id).problems.join(), /depends? on/)
  const done = allSteps(plan).find((s) => s.status === 'complete')
  assert.match(prepareRemove(plan, done.id).problems.join(), /only roadmap steps can be removed/)
  const lone = structuredClone(plan)
  lone.workstreams[0].epics[0].steps = [{ ...draft(), id: '1.1.1', status: 'roadmap' }]
  assert.match(prepareRemove(lone, '1.1.1').problems.join(), /only step in epic 1\.1/)
})

test('removeStep deletes a first, a middle and a last step and nothing else', () => {
  const epic = plan.workstreams.flatMap((ws) => ws.epics).find((e) => e.steps.length >= 3)
  for (const index of [0, 1, epic.steps.length - 1]) {
    const id = epic.steps[index].id
    const next = removeStep(PLAN_TEXT, id)
    const after = JSON.parse(next)
    assert.equal(allSteps(after).some((s) => s.id === id), false, id)
    assert.equal(allSteps(after).length, allSteps(plan).length - 1)
  }
})

test('replaceStep and removeStep refuse a step that is not in the file', () => {
  assert.throws(() => replaceStep(PLAN_TEXT, '4.1.99', { id: '4.1.99' }), /not found/)
  assert.throws(() => removeStep(PLAN_TEXT, '4.1.99'), /not found/)
})

/* ------------------------------------------------ add an epic or a workstream */

const epicDraft = (overrides = {}) => ({ title: 'A new epic', summary: 'Why it exists.', step: draft(), ...overrides })

test('an epic is added to a workstream with the next id and a first step', () => {
  const { epic, problems } = prepareEpic(plan, '6', epicDraft(), { moduleIds: MODULES })
  assert.deepEqual(problems, [])
  const ws6 = plan.workstreams.find((ws) => ws.id === '6')
  const highest = Math.max(...ws6.epics.map((e) => Number(e.id.split('.')[1])))
  assert.equal(epic.id, `6.${highest + 1}`)
  assert.equal(epic.steps[0].id, `${epic.id}.1`)
  assert.equal(epic.steps[0].status, 'roadmap')
})

test('an epic needs a first step, a known workstream and only known fields', () => {
  assert.match(prepareEpic(plan, '99', epicDraft()).problems.join(), /workstream 99 is not in the plan/)
  assert.match(prepareEpic(plan, '6', { title: 't', summary: 's' }).problems.join(), /step is required/)
  assert.match(prepareEpic(plan, '6', epicDraft({ extra: 1 })).problems.join(), /unknown field extra/)
  assert.match(prepareEpic(plan, '6', epicDraft({ step: { ...draft(), status: 'complete' } }), { moduleIds: MODULES }).problems.join(), /added as roadmap/)
  assert.match(prepareEpic(plan, '6', epicDraft({ title: '' }), { moduleIds: MODULES }).problems.join(), /title is required/)
})

test('insertEpic adds one epic to the workstream and changes nothing else', () => {
  const { epic } = prepareEpic(plan, '6', epicDraft(), { moduleIds: MODULES })
  const next = insertEpic(PLAN_TEXT, '6', epic)
  const after = JSON.parse(next)
  assert.deepEqual(validatePlan(after, { moduleIds: MODULES.concat(allSteps(plan).flatMap((s) => s.modules ?? [])) }), validatePlan(plan, { moduleIds: MODULES.concat(allSteps(plan).flatMap((s) => s.modules ?? [])) }))
  assert.equal(after.workstreams.find((ws) => ws.id === '6').epics.at(-1).id, epic.id)
  const { removed } = lineDiff(PLAN_TEXT, next)
  assert.equal(removed.length, 0)
  assert.throws(() => insertEpic(PLAN_TEXT, '99', epic), /workstream 99 not found/)
})

test('a workstream is added with its first epic and step, and its text keeps the file layout', () => {
  const draftWs = { title: 'A new workstream', summary: 'Why.', epic: epicDraft() }
  const { workstream, problems } = prepareWorkstream(plan, draftWs, { moduleIds: MODULES })
  assert.deepEqual(problems, [])
  const highest = Math.max(...plan.workstreams.map((ws) => Number(ws.id)))
  assert.equal(workstream.id, String(highest + 1))
  assert.equal(workstream.epics[0].id, `${workstream.id}.1`)
  assert.equal(workstream.epics[0].steps[0].id, `${workstream.id}.1.1`)
  const next = insertWorkstream(PLAN_TEXT, workstream)
  assert.equal(JSON.parse(next).workstreams.at(-1).id, workstream.id)
  assert.equal(lineDiff(PLAN_TEXT, next).removed.length, 0)
  assert.match(next, new RegExp(`\\n    \\{\\n      "id": "${workstream.id}",\\n      "title": "A new workstream"`))
  assert.match(prepareWorkstream(plan, { title: 't', summary: 's' }).problems.join(), /epic is required/)
})
