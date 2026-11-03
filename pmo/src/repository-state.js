export const REPOSITORY_MAX_AGE_MS = 90_000
export const repositoryFresh = (state, online, now = Date.now()) => online === true && Number.isFinite(Date.parse(state?.generatedAt)) && now >= Date.parse(state.generatedAt) && now - Date.parse(state.generatedAt) <= REPOSITORY_MAX_AGE_MS
export const normalizeRepositoryState = (state) => {
  if (!state || typeof state.branch !== 'string' || !/^[a-f0-9]{7,64}$/.test(state.head || '') || typeof state.clean !== 'boolean' || !Number.isFinite(Date.parse(state.generatedAt)) || !Array.isArray(state.branches)) return null
  return { ...state, branches: state.branches.filter(b => typeof b?.name === 'string').map(b => ({ name: b.name, kind: b.kind, stepId: /^\d+\.\d+\.\d+$/.test(b.stepId || '') ? b.stepId : null, active: typeof b.active === 'boolean' ? b.active : null })) }
}
export const groupedClaims = (state, index) => {
  const groups = { active: new Map(), inactive: new Map(), unknown: new Map() }
  for (const branch of state?.branches || []) {
    if (branch.kind !== 'step' || !/^\d+\.\d+\.\d+$/.test(branch.stepId || '')) continue
    const bucket = branch.active === true ? groups.active : branch.active === false ? groups.inactive : groups.unknown
    if (!bucket.has(branch.stepId)) bucket.set(branch.stepId, { id: branch.stepId, title: index.steps.get(branch.stepId)?.step.title || 'Step not in the approved plan', status: index.steps.get(branch.stepId)?.step.status || 'unknown', branches: new Set() })
    bucket.get(branch.stepId).branches.add(branch.name)
  }
  return Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, [...values.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })).map(row => ({ ...row, branches: [...row.branches].sort() }))]))
}
