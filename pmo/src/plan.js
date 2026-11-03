/**
 * Plan queries: indexing, readiness, ranking and rollups. Pure and browser-safe.
 */

import { phaseOf, phasePriority } from './phase.js'
import { normalizedPrState, pullRequestBlockers } from './pull-requests.js'
import { EFFORT_POINTS, RISK_FACTOR, compareIds, isOpen } from './schema.js'

/**
 * @typedef {object} IndexedStep
 * @property {string} id
 * @property {object} step    the raw step
 * @property {object} epic    { id, title }
 * @property {object} workstream { id, title }
 */

/** Build lookup tables over a plan. */
export const indexPlan = (plan, { pullRequests = null, now = Date.now() } = {}) => {
  const steps = new Map()
  const epics = new Map()
  const workstreams = new Map()
  for (const ws of plan.workstreams) {
    workstreams.set(ws.id, ws)
    for (const epic of ws.epics) {
      epics.set(epic.id, { ...epic, workstreamId: ws.id })
      for (const step of epic.steps) {
        steps.set(step.id, { id: step.id, step, phase: phaseOf(step, phaseOf(epic, ws.tags) === 'unclassified' ? [] : [phaseOf(epic, ws.tags)]), epic: { id: epic.id, title: epic.title }, workstream: { id: ws.id, title: ws.title } })
      }
    }
  }
  const dependents = new Map([...steps.keys()].map((id) => [id, []]))
  for (const { id, step } of steps.values()) {
    for (const dep of step.dependsOn ?? []) dependents.get(dep)?.push(id)
  }
  return { plan, steps, epics, workstreams, dependents, pullRequests: normalizedPrState(pullRequests), prNow: now }
}

export const getStep = (index, id) => index.steps.get(id)?.step ?? null

export const effortPoints = (step) => EFFORT_POINTS[step.effort?.size] ?? 0

/**
 * Decision score: higher means do it sooner. value (1-5) scaled to 10 per effort
 * point, discounted by risk. A complete step has no score.
 */
export const decisionScore = (step) => {
  if (!isOpen(step)) return null
  const points = effortPoints(step)
  const value = step.value?.score ?? 0
  if (!points || !value) return 0
  return Math.round(((value * 10) / points) * (RISK_FACTOR[step.risk?.level] ?? 1) * 10) / 10
}

/** Steps that must finish before this one can start. Unknown ids are reported separately. */
export const readiness = (index, id) => {
  const entry = index.steps.get(id)
  if (!entry) return { exists: false, ready: false, blockers: [], unknown: [id] }
  const blockers = pullRequestBlockers(index, id)
  const unknown = []
  for (const dep of entry.step.dependsOn ?? []) {
    const target = index.steps.get(dep)
    if (!target) unknown.push(dep)
    else if (target.step.status !== 'complete') blockers.push({ id: dep, title: target.step.title, status: target.step.status })
  }
  return { exists: true, ready: isOpen(entry.step) && blockers.length === 0 && unknown.length === 0, blockers, unknown }
}

/** All steps that transitively wait on this one. */
export const transitiveDependents = (index, id) => {
  const out = new Set()
  const walk = (current) => {
    for (const next of index.dependents.get(current) ?? []) {
      if (!out.has(next)) {
        out.add(next)
        walk(next)
      }
    }
  }
  walk(id)
  return [...out].sort(compareIds)
}

/**
 * Open steps, annotated and ranked for decision-making.
 *
 * @param {object} index
 * @param {{ status?: string[], module?: string, workstream?: string, includeBlocked?: boolean }} [filter]
 */
export const rankOpenSteps = (index, filter = {}) => {
  const rows = []
  for (const entry of index.steps.values()) {
    const { step } = entry
    if (!isOpen(step)) continue
    if (filter.phase && entry.phase !== filter.phase) continue
    if (filter.status && !filter.status.includes(step.status)) continue
    if (filter.module && !(step.modules ?? []).includes(filter.module)) continue
    if (filter.workstream && entry.workstream.id !== filter.workstream) continue
    const ready = readiness(index, entry.id)
    if (!filter.includeBlocked && !ready.ready) continue
    rows.push({
      id: entry.id,
      phase: entry.phase,
      title: step.title,
      status: step.status,
      workstream: entry.workstream,
      epic: entry.epic,
      modules: step.modules ?? [],
      effort: step.effort,
      points: effortPoints(step),
      risk: step.risk,
      value: step.value,
      score: decisionScore(step),
      blockedBy: ready.blockers,
      ready: ready.ready,
      unblocks: transitiveDependents(index, entry.id).length,
    })
  }
  return rows.sort((a, b) => (phasePriority(a.phase) - phasePriority(b.phase)) || (b.score - a.score) || (b.unblocks - a.unblocks) || compareIds(a.id, b.id))
}

/** The next n steps worth starting: ready, highest score first. in_progress steps lead. */
export const nextSteps = (index, count = 5) => {
  const ranked = rankOpenSteps(index)
  return ranked.sort((a, b) => phasePriority(a.phase) - phasePriority(b.phase) || Number(b.status === 'in_progress') - Number(a.status === 'in_progress')).slice(0, count)
}

const emptyCounts = () => ({ complete: 0, in_progress: 0, incomplete: 0, roadmap: 0, total: 0, remainingPoints: 0 })

const tally = (counts, step) => {
  counts[step.status] += 1
  counts.total += 1
  if (isOpen(step)) counts.remainingPoints += effortPoints(step)
}

/** Counts by status per workstream and epic, plus overall and a per-module view of open work. */
export const rollup = (index) => {
  const overall = emptyCounts()
  const workstreams = []
  const modules = new Map()
  for (const ws of index.plan.workstreams) {
    const wsCounts = emptyCounts()
    const epics = []
    for (const epic of ws.epics) {
      const epicCounts = emptyCounts()
      for (const step of epic.steps) {
        tally(epicCounts, step)
        tally(wsCounts, step)
        tally(overall, step)
        for (const moduleId of step.modules ?? []) {
          if (!modules.has(moduleId)) modules.set(moduleId, { complete: 0, open: 0, remainingPoints: 0 })
          const row = modules.get(moduleId)
          if (step.status === 'complete') row.complete += 1
          else {
            row.open += 1
            row.remainingPoints += effortPoints(step)
          }
        }
      }
      epics.push({ id: epic.id, title: epic.title, counts: epicCounts })
    }
    workstreams.push({ id: ws.id, title: ws.title, counts: wsCounts, epics })
  }
  return { overall, workstreams, modules: Object.fromEntries([...modules].sort(([a], [b]) => a.localeCompare(b))) }
}

/** Steps (any status) that list a module. */
export const stepsForModule = (index, moduleId) =>
  [...index.steps.values()].filter(({ step }) => (step.modules ?? []).includes(moduleId)).sort((a, b) => compareIds(a.id, b.id))

/** A short slug for branch names. */
export const slugify = (text, max = 40) => {
  const slug = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.slice(0, max).replace(/-+$/g, '') || 'step'
}

export const branchNameFor = (id, step) => `step/${id}-${slugify(step.title)}`
