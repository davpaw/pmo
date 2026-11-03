/** Explicit phase tags override inherited tags. Missing or conflicting tags stay visible as unclassified. */
export const phaseOf = (entity, inherited = []) => {
  const phases = (Array.isArray(entity?.tags) ? entity.tags : []).filter((tag) => ['beta', 'post-beta'].includes(tag))
  const effective = phases.length ? phases : (Array.isArray(inherited) ? inherited : []).filter((tag) => ['beta', 'post-beta'].includes(tag))
  return new Set(effective).size === 1 ? effective[0] : 'unclassified'
}
export const phasePriority = (phase) => ({ beta: 0, unclassified: 1, 'post-beta': 2 })[phase] ?? 1
