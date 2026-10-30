/**
 * PMO: program management. Plan, catalog, guardrails and the agent
 * briefing for every step. Browser-safe exports only; the CLI is in ./cli.js.
 */

export * from './schema.js'
export * from './plan.js'
export * from './isolation.js'
export { buildBrief, renderBriefMarkdown, guardrailsFor, modulesById, preflightChecks } from './briefing.js'

export const pmoPackage = {
  name: 'pmo',
  scope: 'shared',
  title: 'Program management',
  summary: 'The plan, the module catalog, the guardrails and the agent briefing for every step.',
  policies: [
    'plan.json is the single source for what is built and what is next; steps are implemented one per branch.',
    'Only the active step may change on a step branch; adding or re-scoping steps happens on a plan/<slug> branch.',
    'catalog.generated.json is generated from modules.json and the repo and never edited by hand.',
  ],
}

export default pmoPackage
