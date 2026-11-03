/** Read-only PR facts never amend the approved plan. Both the UI and CLI use these decisions. */
export const PR_STATE_VERSION = 1
export const PR_MAX_AGE_MS = 15 * 60 * 1000
export const validRepository = (value) => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
export const validPrReference = (ref) => ref && Number.isSafeInteger(ref.number) && ref.number > 0 && (ref.repository === undefined || validRepository(ref.repository))
export const prUrl = (repository, number) => validRepository(repository) && Number.isSafeInteger(number) && number > 0 ? `https://github.com/${repository}/pull/${number}` : ''
const steps = (plan) => new Map((plan?.workstreams || []).flatMap((w) => w.epics || []).flatMap((e) => e.steps || []).map((s) => [s.id, s]))
const stable = (value) => JSON.stringify(value, (_key, item) => item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const scopeOf = (step) => Object.fromEntries(['scope', 'modules', 'dependsOn', 'requiresPullRequests', 'dismissedPullRequests', 'tasks', 'acceptance', 'questions', 'env', 'onboarding'].map((key) => [key, step[key] ?? null]))

export const proposedPlanBlocks = (base, head) => {
  const before = steps(base)
  const after = steps(head)
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((id) => {
    const a = before.get(id), b = after.get(id)
    if (a && b && stable(scopeOf(a)) === stable(scopeOf(b))) return []
    return [{ id, title: b?.title || a?.title || id, proposed: !a, reason: !a ? 'New step awaiting plan approval and merge' : !b ? 'Proposed step removal awaiting review' : 'Scope or prerequisites awaiting plan approval and merge', followUps: b?.dependsOn || [] }]
  })
}

export const normalizedPrState = (snapshot) => {
  if (snapshot?.schemaVersion !== PR_STATE_VERSION || !validRepository(snapshot.repository) || !Array.isArray(snapshot.pullRequests)) return null
  const ids = new Set()
  const pullRequests = snapshot.pullRequests.filter((pr) => {
    if (!validPrReference(pr) || ids.has(pr.number)) return false
    ids.add(pr.number)
    return true
  }).map((pr) => ({
    number: pr.number, repository: snapshot.repository, url: prUrl(snapshot.repository, pr.number), title: String(pr.title || ''),
    kind: ['plan', 'delivery', 'other'].includes(pr.kind) ? pr.kind : 'other',
    state: ['OPEN', 'CLOSED', 'MERGED'].includes(pr.state) ? pr.state : 'UNKNOWN',
    reviewDecision: String(pr.reviewDecision || 'REVIEW_REQUIRED'), draft: pr.draft === true,
    stepId: /^\d+\.\d+\.\d+$/.test(pr.stepId || '') ? pr.stepId : null,
    mergeVerified: pr.mergeVerified === true, discoveryError: Boolean(pr.discoveryError),
    blocks: (Array.isArray(pr.blocks) ? pr.blocks : []).filter((b) => /^\d+\.\d+\.\d+$/.test(b?.id || '')).map((b) => ({ id: b.id, title: String(b.title || b.id), reason: String(b.reason || 'Prerequisite PR'), proposed: b.proposed === true, followUps: Array.isArray(b.followUps) ? b.followUps.filter((id) => /^\d+\.\d+\.\d+$/.test(id)) : [] })),
  }))
  return { schemaVersion: PR_STATE_VERSION, repository: snapshot.repository, checkedAt: snapshot.checkedAt, mainOid: snapshot.mainOid, ok: snapshot.ok === true, error: snapshot.ok ? null : String(snapshot.error || 'PR sync unavailable'), approvedPlan: snapshot.approvedPlan?.workstreams?.length ? snapshot.approvedPlan : null, pullRequests }
}
export const prStateFresh = (state, now = Date.now()) => state?.ok === true && Number.isFinite(Date.parse(state.checkedAt)) && now >= Date.parse(state.checkedAt) && now - Date.parse(state.checkedAt) <= PR_MAX_AGE_MS
export const prResolved = (pr, state, now) => prStateFresh(state, now) && pr.state === 'MERGED' && pr.mergeVerified && !pr.discoveryError
export const prStatus = (pr, state, now) => !prStateFresh(state, now) ? 'Sync unavailable or stale' : pr.discoveryError ? 'Plan changes unavailable' : prResolved(pr, state, now) ? 'Merged on main' : pr.state === 'MERGED' ? 'Merged; main verification pending' : pr.state === 'CLOSED' ? 'Closed without merge; decision required' : pr.draft ? 'Draft' : pr.reviewDecision === 'APPROVED' ? 'Approved; merge pending' : pr.reviewDecision === 'CHANGES_REQUESTED' ? 'Changes requested' : 'Awaiting review / merge'

export const pullRequestBlockers = (index, id) => {
  const snapshot = index.pullRequests
  const step = index.steps.get(id)?.step
  const dismissed = (number, repository) => (step?.dismissedPullRequests || []).some((ref) => ref.number === number && (!ref.repository || ref.repository === repository))
  const wanted = new Map()
  for (const ref of step?.requiresPullRequests || []) if (validPrReference(ref)) wanted.set(`${ref.repository || snapshot?.repository}#${ref.number}`, { number: ref.number, repository: ref.repository || snapshot?.repository, reason: 'Required prerequisite PR' })
  for (const pr of snapshot?.pullRequests || []) {
    const direct = pr.kind === 'plan' && pr.blocks.find((b) => b.id === id)
    const dependency = pr.kind === 'delivery' && (step?.dependsOn || []).includes(pr.stepId)
    if (direct || dependency) wanted.set(`${pr.repository}#${pr.number}`, { ...pr, reason: direct?.reason || `Delivery of prerequisite ${pr.stepId}` })
  }
  const result = []
  for (const ref of wanted.values()) {
    if (dismissed(ref.number, ref.repository)) continue
    const pr = snapshot?.pullRequests.find((p) => p.number === ref.number && p.repository === ref.repository)
    if (pr && prResolved(pr, snapshot, index.prNow)) continue
    result.push({ id: `PR #${ref.number}`, number: ref.number, url: prUrl(ref.repository, ref.number), kind: 'pull_request', title: pr?.title || ref.reason, status: pr ? prStatus(pr, snapshot, index.prNow) : 'PR state unknown; sync required', reason: ref.reason })
  }
  if (snapshot && (!snapshot.ok || snapshot.pullRequests.some((p) => p.discoveryError && p.kind === 'plan'))) result.push({ id: 'PR sync', kind: 'pull_request', title: 'PR discovery incomplete', status: 'blocked', reason: 'Refresh PR tracking before starting; pending scope decisions may be unavailable.' })
  return result
}
