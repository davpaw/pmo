/**
 * Changing the plan without hand-editing plan.json: add, change or remove a
 * step, add an epic or a workstream.
 *
 * Pure and browser-safe: text in, text out. The plan file is large and laid
 * out by hand, so each change is made to the text of the one array it touches
 * and nothing else in the file moves; re-serialising the file would rewrite it.
 * Every write is checked: the new text must parse to the old plan with only the
 * intended change.
 */

import { COMPLETION_FIELDS, EFFORT_POINTS, RISK_FACTOR, STEP_KINDS, validatePlan } from './schema.js'

/** The skeleton `pmo plan template` prints. Placeholders fail validation until they are filled. */
export const STEP_TEMPLATE = Object.freeze({
  title: '',
  summary: '',
  kind: 'build',
  modules: [''],
  dependsOn: [],
  effort: { size: 'M' },
  risk: { level: 'low', notes: '' },
  value: { score: 3, why: '' },
  tags: [],
  questions: [],
  acceptance: [''],
})

/** What each field of the skeleton accepts, for the lines printed beside it. */
export const TEMPLATE_HINTS = Object.freeze([
  'title, summary: required text',
  `kind: ${STEP_KINDS.join(' | ')} (default build)`,
  'modules: package directory names; more than one needs scope.crossModuleReason',
  'dependsOn: step ids that must be complete first',
  `effort.size: ${Object.keys(EFFORT_POINTS).join(' | ')}`,
  `risk.level: ${Object.keys(RISK_FACTOR).join(' | ')}; risk.notes: required text`,
  'value.score: integer 1-5; value.why: required text',
  'acceptance: at least one testable outcome',
  'questions: { id, ask, why, blocking, default }; a non-blocking question needs a default',
  'optional: scope { extra, contracts, docs, crossModuleReason }, externalDeps, tasks, env, tags',
  'id: omit to take the next free id in the epic; status is always roadmap',
])

/** Keys written on the first two lines of a step, in this order. The rest follow one to a line. */
const HEAD = ['id', 'title', 'summary']
const STATE = ['status', 'kind', 'modules', 'dependsOn']
const TAIL = ['requiresPullRequests', 'dismissedPullRequests', 'scope', 'effort', 'risk', 'value', 'externalDeps', 'tags', 'questions', 'tasks', 'env', 'acceptance']
const DROP_WHEN_EMPTY = ['dependsOn', 'tags', 'questions', 'tasks', 'externalDeps']

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const findEpic = (plan, epicId) => {
  for (const ws of plan?.workstreams ?? []) for (const epic of ws.epics ?? []) if (epic.id === epicId) return epic
  return null
}

/** The next unused step id in an epic (e.g. "4.4.11"), or null when the epic does not exist. */
export const nextStepId = (plan, epicId) => {
  const epic = findEpic(plan, epicId)
  if (!epic) return null
  const last = (epic.steps ?? []).map((step) => Number(String(step.id).split('.')[2])).filter(Number.isInteger)
  return `${epicId}.${last.length === 0 ? 1 : Math.max(...last) + 1}`
}

/**
 * Turn a draft into a new step and check it against the plan schema.
 *
 * @param {object} plan the current plan
 * @param {string} epicId e.g. "4.4"
 * @param {object} draft the step as supplied; id optional
 * @param {{ moduleIds?: Iterable<string>, pathExists?: (path: string) => boolean }} [context]
 * @returns {{ step: object|null, problems: string[] }} step is null when there are problems
 */
export const prepareStep = (plan, epicId, draft, context = {}) => {
  const epic = findEpic(plan, epicId)
  if (!epic) return { step: null, problems: [`epic ${epicId} is not in the plan`] }
  if (!isPlainObject(draft)) return { step: null, problems: ['the step must be a JSON object'] }

  const problems = draftProblems(draft)
  const used = new Set((epic.steps ?? []).map((step) => step.id))
  if (draft.id !== undefined) {
    if (!String(draft.id).startsWith(`${epicId}.`)) problems.push(`id ${draft.id} does not belong to epic ${epicId}`)
    else if (used.has(draft.id)) problems.push(`id ${draft.id} is already used`)
  }
  if (problems.length > 0) return { step: null, problems }

  const step = newStep(draft, draft.id ?? nextStepId(plan, epicId))
  const candidate = structuredClone(plan)
  findEpic(candidate, epicId).steps.push(step)
  const added = problemsAdded(plan, candidate, context)
  return added.length > 0 ? { step: null, problems: added } : { step, problems: [] }
}

/** Problems that only a step being added (rather than completed) can have. */
const draftProblems = (draft) => {
  const problems = []
  for (const field of COMPLETION_FIELDS.filter((name) => name !== 'status')) {
    if (draft[field] !== undefined) problems.push(`${field} is set when a step is completed, not when it is added`)
  }
  if (draft.status !== undefined && draft.status !== 'roadmap') {
    problems.push(`a new step is added as roadmap, not ${JSON.stringify(draft.status)}`)
  }
  return problems
}

const newStep = (draft, id) => {
  const step = { id, ...draft, status: 'roadmap' }
  for (const key of DROP_WHEN_EMPTY) if (Array.isArray(step[key]) && step[key].length === 0) delete step[key]
  return step
}

/** What a change adds to the problems the plan already had, so only the change is reported. */
const problemsAdded = (before, after, context) => {
  const known = new Set(validatePlan(before, context))
  return validatePlan(after, context).filter((problem) => !known.has(problem))
}

/* ---------------------------------------------------------------- rendering */

/** `{ "a": 1 }` and `["a", "b"]`: the compact style the plan file uses inside a line. */
const compact = (value) => {
  if (Array.isArray(value)) return `[${value.map(compact).join(', ')}]`
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined)
    return entries.length === 0 ? '{}' : `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${compact(v)}`).join(', ')} }`
  }
  return JSON.stringify(value)
}

/** A step as the plan file lays it out: head, state, then one field to a line. */
export const renderStep = (step, indent) => {
  const field = (key) => `${JSON.stringify(key)}: ${compact(step[key])}`
  const present = (keys) => keys.filter((key) => step[key] !== undefined)
  const known = new Set([...HEAD, ...STATE, ...TAIL])
  const rest = Object.keys(step).filter((key) => !known.has(key))
  const lines = [
    present(HEAD).map(field).join(', '),
    present(STATE).map(field).join(', '),
    ...present(TAIL).map(field),
    ...rest.map(field),
  ].filter(Boolean)
  const inner = `${indent}  `
  return `${indent}{\n${lines.map((line) => `${inner}${line}`).join(',\n')}\n${indent}}`
}

/* ---------------------------------------------------------------- insertion */

/** JSON with object keys sorted, so two values compare equal whatever order their keys were written in. */
const canonical = (value) => JSON.stringify(value, (_, v) => (isPlainObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v))

/** Index of the `]` that closes the array opened at `open`, skipping strings. */
const closingBracket = (text, open) => {
  let depth = 0
  let inString = false
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i += 1
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Insert a step at the end of an epic's steps in the plan file's text.
 * Throws if the epic cannot be found or if anything but the new step changed.
 *
 * @param {string} text plan.json
 * @param {string} epicId
 * @param {object} step
 * @returns {string} the new text
 */
export const insertStep = (text, epicId, step) => {
  const expected = JSON.parse(text)
  const epic = findEpic(expected, epicId)
  if (!epic) throw new Error(`epic ${epicId} not found in the plan file`)
  epic.steps.push(step)
  return append(text, arrayOf(text, epicId, 'steps'), renderStep, step, expected, 'the new step')
}

/** Where the array `key` of the object whose id is `ownerId` opens and closes, and how deep its key is indented. */
const arrayOf = (text, ownerId, key) => {
  const idAt = ownerId === undefined ? 0 : text.indexOf(`"id": "${ownerId}"`)
  if (idAt < 0) throw new Error(`${ownerId} not found in the plan file`)
  const keyAt = text.indexOf(`"${key}"`, idAt)
  const open = keyAt < 0 ? -1 : text.indexOf('[', keyAt)
  const close = open < 0 ? -1 : closingBracket(text, open)
  if (close < 0) throw new Error(`could not find ${key} of ${ownerId ?? 'the plan'}`)
  const lineStart = text.lastIndexOf('\n', keyAt) + 1
  return { open, close, indent: /^\s*/.exec(text.slice(lineStart, keyAt))[0] }
}

/** Append one rendered element to an array, then check the text parses to `expected` and nothing else. */
const append = (text, { close, indent }, render, element, expected, what) => {
  const lastEnd = text.slice(0, close).trimEnd().length
  const next = `${text.slice(0, lastEnd)},\n${render(element, `${indent}  `)}${text.slice(lastEnd, close)}${text.slice(close)}`
  return verified(next, expected, what)
}

const verified = (next, expected, what) => {
  if (canonical(JSON.parse(next)) !== canonical(expected)) throw new Error(`refusing to write: the change would affect more than ${what}`)
  return next
}

/* ------------------------------------------------- change or remove a step */

const FIXED_FIELDS = ['id', ...COMPLETION_FIELDS]

const findStep = (plan, stepId) => {
  for (const ws of plan?.workstreams ?? []) {
    for (const epic of ws.epics ?? []) {
      const step = (epic.steps ?? []).find((candidate) => candidate.id === stepId)
      if (step) return { epic, step }
    }
  }
  return null
}

const openStepProblem = (found, stepId, verb) => {
  if (!found) return `step ${stepId} is not in the plan`
  if (found.step.status !== 'roadmap') return `step ${stepId} is ${found.step.status}; only roadmap steps can be ${verb}`
  return null
}

/**
 * Apply changes to a roadmap step. A field set to null is removed.
 *
 * @param {object} plan
 * @param {string} stepId
 * @param {object} changes fields to set; id, status and completion fields are refused
 * @param {{ moduleIds?: Iterable<string>, pathExists?: (path: string) => boolean }} [context]
 * @returns {{ step: object|null, problems: string[] }}
 */
export const prepareSet = (plan, stepId, changes, context = {}) => {
  const found = findStep(plan, stepId)
  const refused = openStepProblem(found, stepId, 'changed')
  if (refused) return { step: null, problems: [refused] }
  if (!isPlainObject(changes) || Object.keys(changes).length === 0) return { step: null, problems: ['give the fields to change as a non-empty JSON object'] }
  const fixed = FIXED_FIELDS.filter((field) => changes[field] !== undefined)
  if (fixed.length > 0) return { step: null, problems: fixed.map((field) => `${field} cannot be changed here`) }

  const step = { ...found.step }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete step[key]
    else step[key] = value
  }
  if (canonical(step) === canonical(found.step)) return { step: null, problems: ['nothing would change'] }

  const candidate = structuredClone(plan)
  const epic = findEpic(candidate, found.epic.id)
  epic.steps[epic.steps.findIndex((s) => s.id === stepId)] = step
  const added = problemsAdded(plan, candidate, context)
  return added.length > 0 ? { step: null, problems: added } : { step, problems: [] }
}

/** A roadmap step that no other step depends on, and that is not the last in its epic. */
export const prepareRemove = (plan, stepId) => {
  const found = findStep(plan, stepId)
  const refused = openStepProblem(found, stepId, 'removed')
  if (refused) return { step: null, problems: [refused] }
  const problems = []
  const dependents = []
  for (const ws of plan.workstreams) for (const epic of ws.epics) for (const s of epic.steps) if ((s.dependsOn ?? []).includes(stepId)) dependents.push(s.id)
  if (dependents.length > 0) problems.push(`${dependents.join(', ')} depend${dependents.length === 1 ? 's' : ''} on ${stepId}; change or remove the dependency first`)
  if (found.epic.steps.length === 1) problems.push(`${stepId} is the only step in epic ${found.epic.id}, and an epic needs at least one`)
  return problems.length > 0 ? { step: null, problems } : { step: found.step, problems: [] }
}

/** Start and end offsets of each object in the array that opens at `open`. */
const elementSpans = (text, open) => {
  const spans = []
  let depth = 0
  let inString = false
  let start = -1
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i += 1
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') {
      depth += 1
      if (depth === 2) start = i
    } else if (ch === '}' || ch === ']') {
      if (depth === 2 && ch === '}') spans.push({ start, end: i + 1 })
      depth -= 1
      if (depth === 0) break
    }
  }
  return spans
}

const stepSpans = (text, stepId) => {
  const epicId = stepId.split('.').slice(0, 2).join('.')
  const { open } = arrayOf(text, epicId, 'steps')
  const spans = elementSpans(text, open)
  const index = spans.findIndex((span) => new RegExp(`^\\{\\s*"id": "${stepId.replaceAll('.', '\\.')}"`).test(text.slice(span.start, span.end)))
  if (index < 0) throw new Error(`step ${stepId} not found in the plan file`)
  return { spans, index }
}

/** Replace a step in the plan file's text. Throws if anything but that step would change. */
export const replaceStep = (text, stepId, step) => {
  const { spans, index } = stepSpans(text, stepId)
  const { start, end } = spans[index]
  const indent = /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', start) + 1, start))[0]
  const next = `${text.slice(0, start)}${renderStep(step, indent).slice(indent.length)}${text.slice(end)}`
  const expected = JSON.parse(text)
  const epic = findEpic(expected, stepId.split('.').slice(0, 2).join('.'))
  epic.steps[epic.steps.findIndex((s) => s.id === stepId)] = step
  return verified(next, expected, `step ${stepId}`)
}

/** Remove a step from the plan file's text. Throws if anything but that step would change. */
export const removeStep = (text, stepId) => {
  const { spans, index } = stepSpans(text, stepId)
  const next = index > 0
    ? `${text.slice(0, spans[index - 1].end)}${text.slice(spans[index].end)}`
    : `${text.slice(0, spans[0].start)}${text.slice(spans[1].start)}`
  const expected = JSON.parse(text)
  const epic = findEpic(expected, stepId.split('.').slice(0, 2).join('.'))
  epic.steps = epic.steps.filter((s) => s.id !== stepId)
  return verified(next, expected, `step ${stepId}`)
}

/* ------------------------------------------- add an epic or a workstream */

export const EPIC_TEMPLATE = Object.freeze({ title: '', summary: '', step: { ...STEP_TEMPLATE } })
export const WORKSTREAM_TEMPLATE = Object.freeze({ title: '', summary: '', epic: EPIC_TEMPLATE })

const unknownKeys = (draft, allowed, what) => Object.keys(draft).filter((key) => !allowed.includes(key)).map((key) => `${what}: unknown field ${key}`)

/** An epic and its first step, from `{ title, summary, step }`, with the next free id in the workstream. */
const buildEpic = (workstream, draft, where) => {
  if (!isPlainObject(draft)) return { epic: null, problems: [`${where} must be a JSON object`] }
  const problems = [...unknownKeys(draft, ['title', 'summary', 'step'], where)]
  if (!isPlainObject(draft.step)) problems.push(`${where}: step is required; an epic needs a first step`)
  else problems.push(...draftProblems(draft.step))
  if (problems.length > 0) return { epic: null, problems }
  const last = (workstream.epics ?? []).map((epic) => Number(String(epic.id).split('.')[1])).filter(Number.isInteger)
  const id = `${workstream.id}.${last.length === 0 ? 1 : Math.max(...last) + 1}`
  const stepId = `${id}.1`
  if (draft.step.id !== undefined && draft.step.id !== stepId) return { epic: null, problems: [`${where}: the first step is ${stepId}, not ${draft.step.id}`] }
  return { epic: { id, title: draft.title, summary: draft.summary, steps: [newStep(draft.step, stepId)] }, problems: [] }
}

/** Add an epic, with its first step, to a workstream. */
export const prepareEpic = (plan, workstreamId, draft, context = {}) => {
  const workstream = (plan?.workstreams ?? []).find((ws) => ws.id === workstreamId)
  if (!workstream) return { epic: null, problems: [`workstream ${workstreamId} is not in the plan`] }
  const { epic, problems } = buildEpic(workstream, draft, 'epic')
  if (!epic) return { epic: null, problems }
  const candidate = structuredClone(plan)
  candidate.workstreams.find((ws) => ws.id === workstreamId).epics.push(epic)
  const added = problemsAdded(plan, candidate, context)
  return added.length > 0 ? { epic: null, problems: added } : { epic, problems: [] }
}

/** Add a workstream, with its first epic and that epic's first step. */
export const prepareWorkstream = (plan, draft, context = {}) => {
  if (!isPlainObject(plan) || !Array.isArray(plan.workstreams)) return { workstream: null, problems: ['the plan has no workstreams'] }
  if (!isPlainObject(draft)) return { workstream: null, problems: ['workstream must be a JSON object'] }
  const id = String(Math.max(0, ...plan.workstreams.map((ws) => Number(ws.id)).filter(Number.isInteger)) + 1)
  const problems = unknownKeys(draft, ['title', 'summary', 'epic'], 'workstream')
  if (!isPlainObject(draft.epic)) problems.push('workstream: epic is required; a workstream needs a first epic')
  if (problems.length > 0) return { workstream: null, problems }
  const { epic, problems: epicProblems } = buildEpic({ id, epics: [] }, draft.epic, 'workstream.epic')
  if (!epic) return { workstream: null, problems: epicProblems }
  const workstream = { id, title: draft.title, summary: draft.summary, epics: [epic] }
  const candidate = structuredClone(plan)
  candidate.workstreams.push(workstream)
  const added = problemsAdded(plan, candidate, context)
  return added.length > 0 ? { workstream: null, problems: added } : { workstream, problems: [] }
}

const field = (key, value) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`

/** An epic as the plan file lays it out: id, title and summary one to a line, then its steps. */
export const renderEpic = (epic, indent) => {
  const inner = `${indent}  `
  const steps = `"steps": [\n${epic.steps.map((step) => renderStep(step, `${inner}  `)).join(',\n')}\n${inner}]`
  return `${indent}{\n${[field('id', epic.id), field('title', epic.title), field('summary', epic.summary), steps].map((line) => `${inner}${line}`).join(',\n')}\n${indent}}`
}

export const renderWorkstream = (workstream, indent) => {
  const inner = `${indent}  `
  const epics = `"epics": [\n${workstream.epics.map((epic) => renderEpic(epic, `${inner}  `)).join(',\n')}\n${inner}]`
  return `${indent}{\n${[field('id', workstream.id), field('title', workstream.title), field('summary', workstream.summary), epics].map((line) => `${inner}${line}`).join(',\n')}\n${indent}}`
}

/** Append an epic to a workstream's epics in the plan file's text. */
export const insertEpic = (text, workstreamId, epic) => {
  const expected = JSON.parse(text)
  const workstream = expected.workstreams.find((ws) => ws.id === workstreamId)
  if (!workstream) throw new Error(`workstream ${workstreamId} not found in the plan file`)
  workstream.epics.push(epic)
  return append(text, arrayOf(text, workstreamId, 'epics'), renderEpic, epic, expected, 'the new epic')
}

/** Append a workstream to the plan file's text. */
export const insertWorkstream = (text, workstream) => {
  const expected = JSON.parse(text)
  expected.workstreams.push(workstream)
  return append(text, arrayOf(text, undefined, 'workstreams'), renderWorkstream, workstream, expected, 'the new workstream')
}
