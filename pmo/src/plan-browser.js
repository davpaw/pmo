import { prepareStep, prepareSet, insertStep, replaceStep } from './plan-edit.js'
import { validatePlan } from './schema.js'

/** Browser operations share the CLI schema and surgical text edits. */
export const previewPlanEdit = (text, request, context = {}) => {
  const plan = JSON.parse(text)
  let next
  if (request.operation === 'add') {
    const result = prepareStep(plan, request.target, request.changes, context)
    if (!result.step) throw Error(result.problems.join('\n'))
    next = insertStep(text, request.target, result.step)
  } else if (request.operation === 'set') {
    const result = prepareSet(plan, request.target, request.changes, context)
    if (!result.step) throw Error(result.problems.join('\n'))
    next = replaceStep(text, request.target, result.step)
  } else if (request.operation === 'reorder') {
    const epic = plan.workstreams.flatMap(ws => ws.epics).find(e => e.id === request.target)
    if (!epic) throw Error('Choose an existing epic.')
    const slots = epic.steps.filter(s => s.status === 'roadmap')
    const ids = request.changes
    if (!Array.isArray(ids) || ids.length !== slots.length || new Set(ids).size !== ids.length || ids.some(id => !slots.some(s => s.id === id))) throw Error('Order must contain every roadmap step in this epic exactly once. Non-roadmap steps stay in place.')
    const reordered = ids.map(id => slots.find(s => s.id === id))
    const used = new Set(plan.workstreams.flatMap(ws => ws.epics).flatMap(e => e.steps).map(s => s.id))
    if (slots.some((_, i) => used.has(`${epic.id}.${900000000 + i}`))) throw Error('Reserved ordering ids are already present; use CLI editing.')
    let index = 0
    const expected = structuredClone(plan)
    expected.workstreams.flatMap(ws => ws.epics).find(e => e.id === epic.id).steps = epic.steps.map(s => s.status === 'roadmap' ? reordered[index++] : s)
    // Replace each slot with a unique temporary id, avoiding collisions while moving objects.
    next = text
    for (const [i, step] of slots.entries()) next = replaceStep(next, step.id, { ...reordered[i], id: `${epic.id}.${900000000 + i}` })
    for (const [i, step] of reordered.entries()) next = replaceStep(next, `${epic.id}.${900000000 + i}`, step)
    const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
    if (canonical(JSON.parse(next)) !== canonical(expected)) throw Error('Ordering changed more than the roadmap slots.')
  } else throw Error('Choose add, set or reorder.')
  const problems = validatePlan(JSON.parse(next), context)
  if (problems.length) throw Error(problems.join('\n'))
  if (next === text) throw Error('Nothing would change.')
  return next
}

/** Contiguous unified review hunk; no files are created to preview a diff. */
export const planDiff = (before, after, path) => {
  const a = before.split('\n'), b = after.split('\n')
  let start = 0, end = 0
  while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++
  while (end < Math.min(a.length, b.length) - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  return [`--- a/${path}`, `+++ b/${path}`, `@@ -${start + 1},${a.length - start - end} +${start + 1},${b.length - start - end} @@`, ...a.slice(start, a.length - end).map(s => `-${s}`), ...b.slice(start, b.length - end).map(s => `+${s}`)].join('\n')
}