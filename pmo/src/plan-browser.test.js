import test from 'node:test'
import assert from 'node:assert/strict'
import { previewPlanEdit, planDiff } from './plan-browser.js'
import { editorView } from './plan-editor.js'
import { toHtml } from './ui/index.js'

const draft = { title: 'New', summary: 'Safe edit', modules: ['pmo'], effort: { size: 'S' }, risk: { level: 'low', notes: 'isolated' }, value: { score: 3, why: 'review' }, acceptance: ['valid'], onboarding: 'none' }
const plan = { version: 1, workstreams: [{ id: '1', title: 'W', summary: 's', epics: [{ id: '1.1', title: 'E', summary: 's', steps: [
  { id: '1.1.1', ...draft, status: 'roadmap' },
  { id: '1.1.2', ...draft, status: 'complete', evidence: ['pmo/package.json'] },
  { id: '1.1.3', ...draft, status: 'roadmap', dependsOn: ['1.1.1'] },
] }] }] }
const text = JSON.stringify(plan, null, 2)
const context = { moduleIds: ['pmo'], pathExists: () => true }
test('browser add and re-scope reuse validated surgical edits', () => {
  const added = previewPlanEdit(text, { operation: 'add', target: '1.1', changes: draft }, context)
  assert.equal(JSON.parse(added).workstreams[0].epics[0].steps.at(-1).id, '1.1.4')
  const changed = previewPlanEdit(text, { operation: 'set', target: '1.1.1', changes: { title: '<img onerror="bad()">', scope: { extra: ['docs/review.md'] } } }, context)
  assert.match(planDiff(text, changed, 'pmo/data/plan.json'), /@@/)
  assert.match(changed, /docs\/review.md/)
})
test('roadmap order preserves ids, dependencies, completed slot and other plan data', () => {
  const next = previewPlanEdit(text, { operation: 'reorder', target: '1.1', changes: ['1.1.3', '1.1.1'] }, context)
  const expected = structuredClone(plan)
  expected.workstreams[0].epics[0].steps = [plan.workstreams[0].epics[0].steps[2], plan.workstreams[0].epics[0].steps[1], plan.workstreams[0].epics[0].steps[0]]
  assert.deepEqual(JSON.parse(next), expected)
})
test('invalid input, fixed fields, completed edits and invalid ordering are blocked', () => {
  for (const changes of [['1.1.3'], ['1.1.3', '1.1.3'], ['1.1.2', '1.1.3'], 'bad']) assert.throws(() => previewPlanEdit(text, { operation: 'reorder', target: '1.1', changes }, context))
  for (const field of ['id', 'status', 'evidence', 'completedAt', 'notes']) assert.throws(() => previewPlanEdit(text, { operation: 'set', target: '1.1.1', changes: { [field]: 'bad' } }, context))
  assert.throws(() => previewPlanEdit(text, { operation: 'set', target: '1.1.2', changes: { title: 'bad' } }, context))
  assert.throws(() => previewPlanEdit(text, { operation: 'add', target: '1.1', changes: { ...draft, modules: ['unknown'] } }, context))
  assert.throws(() => previewPlanEdit(text, { operation: 'set', target: '1.1.1', changes: { dependsOn: ['1.1.3'] } }, context))
  assert.throws(() => previewPlanEdit(text, { operation: 'nope' }, context))
})
test('editor route explains explicit confirmation, isolated writes and read-only fallback', () => {
  const rendered = toHtml(editorView())
  assert.match(rendered, /confirmation/)
  assert.match(rendered, /Static and production sites are read-only/)
  assert.match(rendered, /id="plan-editor"/)
})