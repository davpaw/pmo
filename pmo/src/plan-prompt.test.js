import test from 'node:test'
import assert from 'node:assert/strict'
import { askForStep, isYes } from './plan-prompt.js'

/** A reader that answers from a script and records every question. */
const script = (answers) => {
  const queue = [...answers]
  const asked = []
  const said = []
  return {
    asked, said,
    ask: async (question) => {
      asked.push(question)
      if (queue.length === 0) throw new Error(`no answer left for: ${question}`)
      return queue.shift()
    },
    say: (line) => said.push(line),
  }
}

const base = { epicIds: ['1.1', '2.1'], nextId: (id) => ({ '1.1': '1.1.4', '2.1': '2.1.2' })[id] ?? null, moduleIds: ['alpha', 'beta'], stepIds: ['1.1.1', '1.1.2'] }

test('a step is asked for field by field and the defaults apply to blank answers', async () => {
  const s = script(['1.1', 'A title', 'What it does', '', 'alpha', '', '', '', 'Low risk', '', 'Because', '', 'n', 'It works', ''])
  const { epicId, draft } = await askForStep({ ...base, ...s })
  assert.equal(epicId, '1.1')
  assert.deepEqual(draft, {
    title: 'A title', summary: 'What it does', kind: 'build', modules: ['alpha'],
    effort: { size: 'M' }, risk: { level: 'low', notes: 'Low risk' }, value: { score: 3, why: 'Because' }, acceptance: ['It works'],
  })
  assert.deepEqual(s.said, ['New step 1.1.4'])
})

test('an epic given up front is not asked for', async () => {
  const s = script(['T', 'S', 'decision', 'alpha', '1.1.1, 1.1.2', 'XL', 'high', 'Big', '5', 'Wanted', 'pmo, tooling', 'n', 'One', 'Two', ''])
  const { epicId, draft } = await askForStep({ ...base, ...s, epicId: '2.1' })
  assert.equal(epicId, '2.1')
  assert.equal(s.asked.some((q) => q.startsWith('Epic')), false)
  assert.deepEqual([draft.kind, draft.dependsOn, draft.effort, draft.risk.level, draft.value.score, draft.tags, draft.acceptance], ['decision', ['1.1.1', '1.1.2'], { size: 'XL' }, 'high', 5, ['pmo', 'tooling'], ['One', 'Two']])
})

test('an invalid answer is explained and asked again', async () => {
  const s = script(['9.9', '1.1', '', 'T', '', 'S', 'build', 'gamma', 'alpha', '1.1.9', '1.1.1', 'XXL', 'S', 'low', '', 'n', '7', '3', '', 'W', '', 'n', '', 'ok', ''])
  const { draft } = await askForStep({ ...base, ...s })
  const text = s.said.join('\n')
  for (const part of ['epic 9.9 is not in the plan', 'title is required', 'summary is required', 'unknown module: gamma', 'unknown step: 1.1.9', 'choose one of XS, S, M, L, XL', 'the risk note is required', 'a whole number from 1 to 5', 'an acceptance criterion is required']) {
    assert.match(text, new RegExp(part))
  }
  assert.equal(draft.title, 'T')
  assert.equal(draft.value.score, 3)
})

test('more than one module asks why, and a question can be blocking or carry a default', async () => {
  const s = script(['1.1', 'T', 'S', '', 'alpha, beta', 'Shared contract', '', '', '', 'r', '', 'w', '', 'y', 'q1', 'Which?', 'Needed', 'y', 'y', 'q2', 'How many?', 'Sets size', 'n', 'Ten', 'n', 'a', ''])
  const { draft } = await askForStep({ ...base, ...s })
  assert.deepEqual(draft.scope, { crossModuleReason: 'Shared contract' })
  assert.deepEqual(draft.questions, [
    { id: 'q1', ask: 'Which?', why: 'Needed', blocking: true },
    { id: 'q2', ask: 'How many?', why: 'Sets size', blocking: false, default: 'Ten' },
  ])
})

test('nothing about onboarding is asked, and one module needs no reason', async () => {
  const s = script(['1.1', 'T', 'S', '', 'alpha', '', '', '', 'r', '', 'w', '', 'n', 'a', ''])
  const { draft } = await askForStep({ ...base, ...s })
  assert.equal(s.asked.some((question) => /onboarding/i.test(question)), false)
  assert.equal(draft.scope, undefined)
  assert.deepEqual(draft.modules, ['alpha'])
})

test('an epic that has no next id is refused', async () => {
  await assert.rejects(askForStep({ ...base, ...script([]), epicId: '5.5' }), /epic 5\.5 is not in the plan/)
})

test('isYes accepts y and yes in any case and nothing else', () => {
  for (const yes of ['y', 'Y', 'yes', 'YES', ' y ']) assert.equal(isYes(yes), true)
  for (const no of ['', 'n', 'no', 'yep', 'maybe']) assert.equal(isYes(no), false)
})
