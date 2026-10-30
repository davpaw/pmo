/**
 * Plan schema: vocabulary, validation and the one place the numbers are defined.
 * Pure and browser-safe. No fs, no process, no git.
 *
 * The plan is a tree: workstream (1) -> epic (1.2) -> step (1.2.3). A step is
 * the unit a person or agent is asked to implement: "implement step 2.3.1".
 */

export const STATUSES = ['complete', 'in_progress', 'incomplete', 'roadmap']
export const OPEN_STATUSES = ['in_progress', 'incomplete', 'roadmap']
export const STEP_KINDS = ['build', 'decision', 'external']
export const EFFORT_POINTS = { XS: 1, S: 2, M: 3, L: 5, XL: 8 }
export const RISK_FACTOR = { low: 1, medium: 0.8, high: 0.6 }

export const STEP_ID = /^\d+\.\d+\.\d+$/
export const EPIC_ID = /^\d+\.\d+$/
export const WORKSTREAM_ID = /^\d+$/

/** Fields a step branch may change on the active step (see project.json completion). */
export const COMPLETION_FIELDS = ['status', 'evidence', 'completedAt', 'notes']

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isStringList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.trim() !== '')
const parseId = (id) => id.split('.').map(Number)

/** Compare "2.10.1" style ids numerically. */
export const compareIds = (a, b) => {
  const left = parseId(a)
  const right = parseId(b)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? -1) - (right[i] ?? -1)
    if (diff !== 0) return diff
  }
  return 0
}

export const isOpen = (step) => OPEN_STATUSES.includes(step.status)

/**
 * Validate a plan. Returns a list of human-readable problems (empty when valid).
 *
 * @param {object} plan
 * @param {{ moduleIds?: Iterable<string>, pathExists?: (path: string) => boolean }} [context]
 *   moduleIds: package directory names that exist; pathExists: checks `evidence` paths.
 */
export const validatePlan = (plan, context = {}) => {
  const problems = []
  const add = (where, message) => problems.push(`${where}: ${message}`)
  const moduleIds = context.moduleIds ? new Set(context.moduleIds) : null

  if (!isObject(plan)) return ['plan: must be an object']
  if (!Array.isArray(plan.workstreams) || plan.workstreams.length === 0) {
    return ['plan: workstreams must be a non-empty array']
  }

  const steps = new Map()
  const seen = new Set()
  const claim = (id, where) => {
    if (seen.has(id)) add(where, `duplicate id ${id}`)
    seen.add(id)
  }

  for (const ws of plan.workstreams) {
    const wsWhere = `workstream ${ws?.id}`
    if (!WORKSTREAM_ID.test(String(ws?.id))) add(wsWhere, 'id must be a number like "2"')
    claim(String(ws?.id), wsWhere)
    if (!ws?.title) add(wsWhere, 'title is required')
    if (!ws?.summary) add(wsWhere, 'summary is required')
    if (!Array.isArray(ws?.epics) || ws.epics.length === 0) add(wsWhere, 'epics must be a non-empty array')

    for (const epic of ws?.epics ?? []) {
      const epicWhere = `epic ${epic?.id}`
      if (!EPIC_ID.test(String(epic?.id))) add(epicWhere, 'id must look like "2.3"')
      else if (!String(epic.id).startsWith(`${ws.id}.`)) add(epicWhere, `id must start with "${ws.id}."`)
      claim(String(epic?.id), epicWhere)
      if (!epic?.title) add(epicWhere, 'title is required')
      if (!epic?.summary) add(epicWhere, 'summary is required')
      if (!Array.isArray(epic?.steps) || epic.steps.length === 0) add(epicWhere, 'steps must be a non-empty array')

      for (const step of epic?.steps ?? []) {
        const where = `step ${step?.id}`
        if (!STEP_ID.test(String(step?.id))) add(where, 'id must look like "2.3.1"')
        else if (!String(step.id).startsWith(`${epic.id}.`)) add(where, `id must start with "${epic.id}."`)
        claim(String(step?.id), where)
        steps.set(String(step?.id), step)
        validateStep(step, where, { add, moduleIds, pathExists: context.pathExists })
      }
    }
  }

  for (const [id, step] of steps) {
    for (const dep of step.dependsOn ?? []) {
      const target = steps.get(dep)
      if (!target) add(`step ${id}`, `dependsOn unknown step ${dep}`)
      else if (dep === id) add(`step ${id}`, 'cannot depend on itself')
      else if (step.status === 'complete' && target.status !== 'complete') {
        add(`step ${id}`, `is complete but depends on ${dep}, which is ${target.status}`)
      }
    }
  }

  const cycle = findCycle(steps)
  if (cycle) problems.push(`plan: dependency cycle ${cycle.join(' -> ')}`)
  return problems
}

const validateStep = (step, where, { add, moduleIds, pathExists }) => {
  if (!isObject(step)) return add(where, 'must be an object')
  if (!step.title) add(where, 'title is required')
  if (!step.summary) add(where, 'summary is required')
  if (!STATUSES.includes(step.status)) add(where, `status must be one of ${STATUSES.join(', ')}`)
  if (step.kind !== undefined && !STEP_KINDS.includes(step.kind)) add(where, `kind must be one of ${STEP_KINDS.join(', ')}`)
  if (step.dependsOn !== undefined && !isStringList(step.dependsOn)) add(where, 'dependsOn must be a list of step ids')
  if (step.tags !== undefined && !isStringList(step.tags)) add(where, 'tags must be a list of strings')
  if (step.tasks !== undefined && !isStringList(step.tasks)) add(where, 'tasks must be a list of strings')

  if (step.modules !== undefined) {
    if (!isStringList(step.modules)) add(where, 'modules must be a list of package directory names')
    else if (moduleIds) {
      for (const id of step.modules) if (!moduleIds.has(id)) add(where, `unknown module "${id}"`)
    }
  }

  if (step.status === 'complete') {
    if (!isStringList(step.evidence) || step.evidence.length === 0) {
      add(where, 'a complete step needs evidence: the paths that prove it')
    } else if (pathExists) {
      for (const path of step.evidence) if (!pathExists(path)) add(where, `evidence path not found: ${path}`)
    }
    return undefined
  }

  // Open steps carry everything needed to decide and to implement.
  if (!isStringList(step.modules) || step.modules.length === 0) add(where, 'modules is required (package directory names)')
  if (step.modules?.length > 1 && !step.scope?.crossModuleReason) {
    add(where, 'a step touching more than one module needs scope.crossModuleReason')
  }
  if (!isObject(step.effort) || !(step.effort.size in EFFORT_POINTS)) {
    add(where, `effort.size must be one of ${Object.keys(EFFORT_POINTS).join(', ')}`)
  }
  if (!isObject(step.risk) || !(step.risk.level in RISK_FACTOR) || !step.risk.notes) {
    add(where, `risk needs level (${Object.keys(RISK_FACTOR).join(', ')}) and notes`)
  }
  if (!isObject(step.value) || !Number.isInteger(step.value.score) || step.value.score < 1 || step.value.score > 5 || !step.value.why) {
    add(where, 'value needs an integer score 1-5 and why')
  }
  if (!isStringList(step.acceptance) || step.acceptance.length === 0) add(where, 'acceptance must list at least one testable outcome')
  if (step.scope !== undefined) {
    if (!isObject(step.scope)) add(where, 'scope must be an object')
    else {
      for (const key of ['extra', 'contracts', 'docs']) {
        if (step.scope[key] !== undefined && !isStringList(step.scope[key])) add(where, `scope.${key} must be a list of path globs`)
      }
    }
  }
  if (step.questions !== undefined) {
    if (!Array.isArray(step.questions)) add(where, 'questions must be a list')
    else {
      step.questions.forEach((q, i) => {
        if (!q?.id || !q?.ask || !q?.why || typeof q.blocking !== 'boolean') {
          add(where, `questions[${i}] needs id, ask, why and blocking (true/false)`)
        } else if (!q.blocking && (q.default === undefined || q.default === '')) {
          add(where, `question "${q.id}" is non-blocking and needs a default`)
        }
      })
    }
  }
  if (step.env !== undefined && !isObject(step.env)) add(where, 'env must be an object')
  return undefined
}

const findCycle = (steps) => {
  const state = new Map()
  const path = []
  const visit = (id) => {
    state.set(id, 1)
    path.push(id)
    for (const dep of steps.get(id)?.dependsOn ?? []) {
      if (!steps.has(dep)) continue
      if (state.get(dep) === 1) return [...path.slice(path.indexOf(dep)), dep]
      if (!state.has(dep)) {
        const found = visit(dep)
        if (found) return found
      }
    }
    path.pop()
    state.set(id, 2)
    return null
  }
  for (const id of steps.keys()) {
    if (!state.has(id)) {
      const found = visit(id)
      if (found) return found
    }
  }
  return null
}

/** Validate guardrails shape; returns problems. */
export const validateGuardrails = (guardrails, context = {}) => {
  const problems = []
  const ids = new Set()
  for (const rule of guardrails?.rules ?? []) {
    const where = `guardrail ${rule?.id}`
    if (!/^G-\d{3}$/.test(String(rule?.id))) problems.push(`${where}: id must look like G-001`)
    if (ids.has(rule?.id)) problems.push(`${where}: duplicate id`)
    ids.add(rule?.id)
    for (const key of ['title', 'rule', 'source']) if (!rule?.[key]) problems.push(`${where}: ${key} is required`)
    if (!['test', 'validator', 'hook', 'ci', 'manual'].includes(rule?.enforcement?.kind)) problems.push(`${where}: enforcement.kind is invalid`)
    if (rule?.enforcement?.kind !== 'manual' && !rule?.enforcement?.ref) problems.push(`${where}: enforcement.ref is required`)
    if (!['must', 'should'].includes(rule?.severity)) problems.push(`${where}: severity must be must or should`)
    if (!isStringList(rule?.appliesTo) || rule.appliesTo.length === 0) problems.push(`${where}: appliesTo is required`)
    const ref = rule?.enforcement?.ref
    if (context.pathExists && typeof ref === 'string' && /^(tests|pmo|server|src)\/\S+\.test\.js$/.test(ref) && !context.pathExists(ref)) {
      problems.push(`${where}: enforcement ref not found: ${ref}`)
    }
  }
  if (!Array.isArray(guardrails?.rules) || guardrails.rules.length === 0) problems.push('guardrails: rules must be a non-empty array')
  return problems
}
