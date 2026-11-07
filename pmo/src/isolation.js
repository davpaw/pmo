/**
 * Branching, commit and code-isolation rules. Pure and browser-safe: the CLI
 * feeds it facts from git, the UI feeds it the plan, tests feed it literals.
 */

import { COMPLETION_FIELDS, STEP_ID } from './schema.js'

const escapeRegExp = (text) => text.replace(/[.+^${}()|[\]\\]/g, '\\$&')

/** Translate a glob (`**`, `*`, `?`) to an anchored RegExp over posix paths. */
export const globToRegExp = (glob) => {
  let out = ''
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else out += '[^/]*'
    } else if (char === '?') out += '[^/]'
    else out += escapeRegExp(char)
  }
  return new RegExp(`^${out}$`)
}

export const matchesAny = (path, globs) => globs.some((glob) => globToRegExp(glob).test(path))

/** Normalize a posix path; returns null if it climbs above the repo root. */
const normalize = (path) => {
  const out = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(part)
  }
  return out.join('/')
}

const dirname = (path) => path.split('/').slice(0, -1).join('/')

/* ------------------------------------------------------------------ branches */

/**
 * @returns {{ kind: 'step'|'plan'|'release'|'main'|'other', ok: boolean, stepId?: string, slug?: string, reason?: string }}
 */
export const classifyBranch = (name, project) => {
  if (project.branching.protected.includes(name)) {
    return { kind: 'main', ok: false, reason: `${name} is protected. Work on step/<id>-<slug> and open a pull request.` }
  }
  const step = new RegExp(project.branching.step).exec(name)
  if (step) return { kind: 'step', ok: true, stepId: step[1], slug: step[2] }
  const plan = new RegExp(project.branching.plan).exec(name)
  if (plan) return { kind: 'plan', ok: true, slug: plan[1] }
  const release = new RegExp(project.branching.release).exec(name)
  if (release) return { kind: 'release', ok: true, slug: release[1] }
  return {
    kind: 'other',
    ok: false,
    reason: `Branch "${name}" does not match step/<id>-<slug>, plan/<slug> or release/<slug>. Start work with: npm run pmo -- start <step id>`,
  }
}

/** @returns {string[]} problems; empty when the message is acceptable */
export const checkCommitMessage = (message, branch, project) => {
  const subject = String(message).split('\n')[0]
  if (new RegExp(project.commit.exempt).test(subject)) return []
  if (branch.kind === 'step') {
    const match = new RegExp(project.commit.stepPrefix).exec(subject)
    if (!match) return [`Commit subject must start with "[${branch.stepId}] ": "${subject}". Example: ${project.commit.example}`]
    if (match[1] !== branch.stepId) return [`Commit is tagged [${match[1]}] but this branch is for step ${branch.stepId}. One step per branch.`]
    return []
  }
  if (branch.kind === 'plan') {
    return new RegExp(project.commit.planPrefix).test(subject) ? [] : [`Commit subject on a plan branch must start with "plan: ": "${subject}"`]
  }
  if (branch.kind === 'release') {
    return new RegExp(project.commit.releasePrefix).test(subject) ? [] : [`Commit subject on a release branch must start with "release: ": "${subject}"`]
  }
  return [branch.reason ?? 'Commits are only allowed on step/, plan/ or release/ branches.']
}

/* --------------------------------------------------------------------- scope */

/** The globs a branch may change. `modules` is the catalog's modules by id; each module declares the `owns` globs it may change. */
export const scopeFor = (branch, step, project, modules = {}) => {
  const always = project.alwaysAllowedPaths ?? []
  if (branch.kind === 'step') {
    const owned = (step?.modules ?? []).flatMap((id) => modules[id]?.owns ?? [])
    return {
      allow: [...owned, ...(step?.scope?.extra ?? []), ...(step?.scope?.contracts ?? []), ...(step?.scope?.docs ?? []), ...always],
      note: `step ${branch.stepId}: modules ${(step?.modules ?? []).join(', ') || '(none)'}`,
    }
  }
  if (branch.kind === 'plan') return { allow: ['pmo/data/**', 'docs/**'], note: 'plan branch: PMO data and docs only' }
  if (branch.kind === 'release') return { allow: ['package.json', 'package-lock.json', ...Object.values(modules).filter(m => m.path && !m.path.includes('*')).map(m => `${m.path}/package.json`)], note: 'release branch: versions and lockfile only' }
  return { allow: [], note: 'no scope: not on a step, plan or release branch' }
}

/** The module that owns a repo-relative path, or null for unowned (legacy) code. */
export const ownerOf = (file, modules = {}) => Object.entries(modules).find(([, module]) => matchesAny(file, module.owns ?? []))?.[0] ?? null

/**
 * Compare changed files with the branch scope and the frozen list.
 *
 * @param {string[]} files repo-relative posix paths
 * @returns {{ file: string, rule: 'out-of-scope'|'frozen', reason: string }[]}
 */
export const checkChangedFiles = (files, branch, step, project, modules = {}) => {
  const { allow } = scopeFor(branch, step, project, modules)
  const extra = step?.scope?.extra ?? []
  const violations = []
  for (const file of files) {
    const frozen = (project.frozenPaths ?? []).find((entry) => globToRegExp(entry.glob).test(file))
    if (frozen) {
      const lifted =
        (frozen.unlessModule && (step?.modules ?? []).includes(frozen.unlessModule)) ||
        (frozen.allowOnBranchKind && frozen.allowOnBranchKind === branch.kind) ||
        (frozen.unlessExtra && matchesAny(file, extra))
      if (!lifted) {
        violations.push({ file, rule: 'frozen', reason: frozen.reason })
        continue
      }
    }
    if (!matchesAny(file, allow)) {
      violations.push({
        file,
        rule: 'out-of-scope',
        reason: branch.kind === 'step'
          ? `Not in step ${branch.stepId}'s scope. Add its module to the step (plan branch) or move this change to its own step.`
          : `Not allowed on a ${branch.kind} branch.`,
      })
    }
  }
  return violations
}

/* ------------------------------------------------------------------- imports */

const IMPORT_SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/

/**
 * Module boundaries over *added* lines only, so existing code is not re-litigated.
 * A relative import from a file one module owns into a file another module owns
 * must be declared in dependsOn, and must go through the other module's `entry`
 * when it declares one. Unowned (legacy) files are not checked.
 *
 * @param {{ file: string, text: string }[]} added
 * @param {Record<string, { owns?: string[], dependsOn?: string[], entry?: string }>} modulesById
 */
export const checkImports = (added, modulesById, project) => {
  const exempt = project.isolationExempt ?? []
  const shared = project.sharedPaths ?? []
  const violations = []
  for (const { file, text } of added) {
    if (!/\.(?:js|mjs|cjs|jsx|ts|tsx)$/.test(file) || matchesAny(file, exempt)) continue
    const owner = ownerOf(file, modulesById)
    const spec = IMPORT_SPEC.exec(text)?.[2]
    if (!owner || !spec || !spec.startsWith('.')) continue

    const resolved = normalize(`${dirname(file)}/${spec}`)
    if (resolved === null) {
      violations.push({ file, rule: 'escapes-repo', reason: `relative import ${spec} leaves the repository`, line: text.trim() })
      continue
    }
    const target = ownerOf(resolved, modulesById)
    if (!target || target === owner || matchesAny(resolved, shared)) continue
    if (!(modulesById[owner]?.dependsOn ?? []).includes(target)) {
      violations.push({ file, rule: 'undeclared-dependency', reason: `${owner} imports from ${target} (${resolved}) but does not declare it. Add "${target}" to ${owner}.dependsOn in pmo/data/modules.json on a plan branch.`, line: text.trim() })
    } else if (modulesById[target]?.entry && resolved !== modulesById[target].entry) {
      violations.push({ file, rule: 'deep-import', reason: `import into ${target} must use its entry ${modulesById[target].entry}, not ${resolved}.`, line: text.trim() })
    }
  }
  return violations
}

/* ------------------------------------------------------------- plan integrity */

const stable = (value) => JSON.stringify(value, (_key, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v)

const flatten = (plan) => {
  const nodes = new Map()
  for (const ws of plan?.workstreams ?? []) {
    nodes.set(ws.id, { level: 'workstream', value: { title: ws.title, summary: ws.summary } })
    for (const epic of ws.epics ?? []) {
      nodes.set(epic.id, { level: 'epic', value: { title: epic.title, summary: epic.summary } })
      for (const step of epic.steps ?? []) nodes.set(step.id, { level: 'step', value: step })
    }
  }
  return nodes
}

/**
 * On a step branch only the active step's completion fields may change.
 * On a plan branch anything goes (validatePlan still applies).
 *
 * @returns {string[]} problems
 */
export const checkPlanIntegrity = (basePlan, headPlan, branch) => {
  if (branch.kind !== 'step') return []
  const base = flatten(basePlan)
  const head = flatten(headPlan)
  const problems = []
  for (const id of new Set([...base.keys(), ...head.keys()])) {
    const before = base.get(id)
    const after = head.get(id)
    if (!before) problems.push(`${id} was added. Adding plan items needs a plan/<slug> branch.`)
    else if (!after) problems.push(`${id} was removed. Removing plan items needs a plan/<slug> branch.`)
    else if (id !== branch.stepId && stable(before.value) !== stable(after.value)) {
      problems.push(`${id} changed. Only step ${branch.stepId} may change on this branch.`)
    } else if (id === branch.stepId && before.level === 'step') {
      const strip = (step) => Object.fromEntries(Object.entries(step).filter(([key]) => !COMPLETION_FIELDS.includes(key)))
      if (stable(strip(before.value)) !== stable(strip(after.value))) {
        const changed = [...new Set([...Object.keys(before.value), ...Object.keys(after.value)])]
          .filter((key) => !COMPLETION_FIELDS.includes(key) && stable(before.value[key]) !== stable(after.value[key]))
        problems.push(`Step ${id}: only ${COMPLETION_FIELDS.join(', ')} may change on a step branch (changed: ${changed.join(', ')}). Re-scoping needs a plan/<slug> branch.`)
      }
    }
  }
  return problems
}

/**
 * Checks that must hold before a pull request is opened for a step.
 *
 * @param {{ pathExists: (path: string) => boolean }} context
 * @returns {string[]} problems
 */
export const checkReadyForPr = (step, context) => {
  const problems = []
  if (step.status !== 'complete') problems.push(`Step ${step.id} is "${step.status}" in plan.json. Mark it complete with evidence before opening the pull request.`)
  if (!Array.isArray(step.evidence) || step.evidence.length === 0) problems.push(`Step ${step.id} needs evidence paths.`)
  else for (const path of step.evidence) if (!context.pathExists(path)) problems.push(`Evidence path not found: ${path}`)
  if (!step.completedAt) problems.push(`Step ${step.id} needs completedAt (YYYY-MM-DD).`)
  return problems
}

export const isStepId = (value) => STEP_ID.test(String(value))
