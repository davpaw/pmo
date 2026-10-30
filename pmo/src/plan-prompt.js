/**
 * The questions `pmo plan add` asks when it is given no JSON.
 *
 * Pure: the reader is injected as `ask(question) => Promise<string>`, so the
 * same code runs on a terminal and in tests. Each answer is checked as it is
 * given and asked again, with the reason, until it is acceptable. The result is
 * a draft step; the command still validates it as a whole before writing.
 */

import { EFFORT_POINTS, RISK_FACTOR, STEP_KINDS } from './schema.js'

const list = (text) => text.split(',').map((item) => item.trim()).filter(Boolean)
export const isYes = (text) => /^y(es)?$/i.test(String(text).trim())

const required = (what) => (raw) => (raw ? { value: raw } : { error: `${what} is required` })
const choice = (options, fallback) => (raw) => {
  const value = raw || fallback
  return options.includes(value) ? { value } : { error: `choose one of ${options.join(', ')}` }
}
const score = (raw) => {
  const value = Number(raw || 3)
  return Number.isInteger(value) && value >= 1 && value <= 5 ? { value } : { error: 'a whole number from 1 to 5' }
}
/** A comma-separated list of names that must all be known (when `known` is given). */
const names = (what, known, { atLeastOne = false } = {}) => (raw) => {
  const items = list(raw)
  if (atLeastOne && items.length === 0) return { error: `at least one ${what} is needed` }
  const unknown = known ? items.filter((item) => !known.has(item)) : []
  return unknown.length > 0 ? { error: `unknown ${what}: ${unknown.join(', ')}` } : { value: items }
}

/**
 * Ask for every field of a step.
 *
 * @param {object} options
 * @param {(question: string) => Promise<string>} options.ask
 * @param {(line: string) => void} options.say shows a message (the reason for a re-ask, the id of the step)
 * @param {string} [options.epicId] the epic, when already given; otherwise it is asked for
 * @param {Iterable<string>} options.epicIds epics that exist
 * @param {(epicId: string) => string|null} options.nextId the id the new step would take
 * @param {Iterable<string>} [options.moduleIds] package directory names that exist
 * @param {Iterable<string>} [options.stepIds] steps that exist, for dependencies
 * @returns {Promise<{ epicId: string, draft: object }>}
 */
export const askForStep = async ({ ask, say, epicId, epicIds, nextId, moduleIds, stepIds }) => {
  const known = (items) => (items ? new Set(items) : null)
  const field = async (label, parse, fallback) => {
    for (;;) {
      const result = parse((await ask(`${label}${fallback === undefined ? '' : ` [${fallback}]`}: `)).trim())
      if (!result.error) return result.value
      say(`  ${result.error}`)
    }
  }
  const epics = new Set(epicIds)
  const epic = epicId ?? await field('Epic (for example 4.4)', (raw) => (epics.has(raw) ? { value: raw } : { error: `epic ${raw || '(none)'} is not in the plan` }))
  const id = nextId(epic)
  if (id === null) throw new Error(`epic ${epic} is not in the plan`)
  say(`New step ${id}`)

  const draft = {}
  draft.title = await field('Title', required('title'))
  draft.summary = await field('Summary (what it does, one or two sentences)', required('summary'))
  draft.kind = await field(`Kind (${STEP_KINDS.join(' | ')})`, choice(STEP_KINDS, 'build'), 'build')
  draft.modules = await field('Modules (package directory names, comma separated)', names('module', known(moduleIds), { atLeastOne: true }))
  if (draft.modules.length > 1) {
    draft.scope = { crossModuleReason: await field('Why does this step need more than one module', required('the reason')) }
  }
  const dependsOn = await field('Depends on (step ids, comma separated; blank for none)', names('step', known(stepIds)))
  if (dependsOn.length > 0) draft.dependsOn = dependsOn
  draft.effort = { size: await field(`Effort (${Object.keys(EFFORT_POINTS).join(' | ')})`, choice(Object.keys(EFFORT_POINTS), 'M'), 'M') }
  const level = await field(`Risk (${Object.keys(RISK_FACTOR).join(' | ')})`, choice(Object.keys(RISK_FACTOR), 'low'), 'low')
  draft.risk = { level, notes: await field('What is the risk', required('the risk note')) }
  const value = await field('Value, 1 to 5', score, 3)
  draft.value = { score: value, why: await field('Why that value', required('the reason')) }
  const tags = await field('Tags (comma separated; blank for none)', names('tag'))
  if (tags.length > 0) draft.tags = tags

  const questions = []
  while (isYes(await ask('Add a question for whoever starts this step? [y/N]: '))) {
    const question = {
      id: await field('  Question id (short, lower case)', required('the id')),
      ask: await field('  The question', required('the question')),
      why: await field('  Why it matters', required('the reason')),
    }
    question.blocking = isYes(await ask('  Must it be answered before work starts? [y/N]: '))
    if (!question.blocking) question.default = await field('  Default to assume if it is not answered', required('a default'))
    questions.push(question)
  }
  if (questions.length > 0) draft.questions = questions

  draft.acceptance = [await field('Acceptance criterion 1 (a testable outcome)', required('an acceptance criterion'))]
  for (;;) {
    const more = (await ask(`Acceptance criterion ${draft.acceptance.length + 1} (blank to finish): `)).trim()
    if (!more) break
    draft.acceptance.push(more)
  }
  return { epicId: epic, draft }
}
