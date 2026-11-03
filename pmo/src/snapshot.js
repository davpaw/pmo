import { indexPlan, readiness } from './plan.js'
import { isOpen } from './schema.js'
/** Worktree identity is compared with the exact bundled plan, never its editorial date. */
export const planRevision = (plan) => {
  let hash = 2166136261
  for (const char of JSON.stringify(plan)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(16)
}
export const snapshotState = (snapshot, plan, now = Date.now(), catalog) => {
  if (!snapshot) return { state: 'unavailable', detail: 'Machine preflight unavailable; run pmo brief before starting.' }
  const age = now - Date.parse(snapshot.generatedAt)
  if (!Number.isFinite(age) || age < -5000 || age > 60000) return { state: 'stale', detail: 'Worktree snapshot is stale. Refresh before using its facts.' }
  if (snapshot.planRevision !== planRevision(plan)) return { state: 'mismatch', detail: 'The served plan differs from the worktree. Reload the page after rebuilding.' }
  if (catalog && snapshot.catalogRevision !== planRevision(catalog)) return { state: 'mismatch', detail: 'The served catalog differs from the worktree. Reload after rebuilding.' }
  return { state: 'current', detail: `Worktree snapshot ${snapshot.generatedAt}; branch ${snapshot.branch} at ${snapshot.head}. Service health is not checked.` }
}
export const validMachineFacts = (facts) => Boolean(facts && typeof facts.git?.clean === 'boolean' && Array.isArray(facts.git.claims) && facts.git.claims.every((claim) => typeof claim === 'string') && typeof facts.env?.node === 'string' && typeof facts.env.nodeModules === 'boolean' && Array.isArray(facts.env.missingKeys) && Array.isArray(facts.env.portsInUse))
export const canonicalStartCheck = (plan, id) => {
  if (!plan) return { ok: false, detail: 'Canonical plan unavailable; run start to refresh the base.' }
  const index = indexPlan(plan)
  const step = index.steps.get(id)?.step
  if (!step) return { ok: false, detail: `Step ${id} is absent from the canonical plan.` }
  if (!isOpen(step)) return { ok: false, detail: `Step ${id} is already ${step.status} on the canonical base.` }
  const ready = readiness(index, id)
  return { ok: ready.ready, detail: ready.ready ? 'Prerequisites are complete on the canonical base; start refreshes remote refs.' : `Canonical prerequisites are incomplete: ${[...ready.blockers.map((item) => item.id), ...ready.unknown].join(', ')}` }
}
export const factsForStep = (ctx, id) => snapshotState(ctx.live, ctx.plan, Date.now(), ctx.catalog).state === 'current' && ctx.live?.stepId === id && validMachineFacts(ctx.live.facts) && typeof ctx.live.facts.git.canonical?.ok === 'boolean' ? ctx.live.facts : undefined
