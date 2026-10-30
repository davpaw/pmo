/**
 * The agent briefing: everything needed to act on "implement step 2.3.1".
 * Pure and browser-safe. Live facts (git state, env, ports) arrive as an optional
 * `facts` object that the CLI gathers; the UI renders the same brief without it.
 */

import { branchNameFor, decisionScore, effortPoints, readiness, transitiveDependents } from './plan.js'
import { matchesAny, scopeFor } from './isolation.js'
import { isOpen } from './schema.js'

const semverParts = (v) => String(v).replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0)
export const semverAtLeast = (actual, min) => {
  const a = semverParts(actual)
  const b = semverParts(min)
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return true
}

const uniq = (list) => [...new Set(list)]

export const modulesById = (catalog) => Object.fromEntries((catalog?.modules ?? []).map((m) => [m.id, m]))

/** Guardrails that apply to a set of modules and tags. */
export const guardrailsFor = (guardrails, modules, tags = []) => {
  const keys = new Set(['all', ...tags.map((t) => `tag:${t}`)])
  for (const m of modules) {
    keys.add(`module:${m.id}`)
    keys.add(`kind:${m.kind}`)
    for (const tag of m.tags ?? []) keys.add(`tag:${tag}`)
  }
  return guardrails.rules.filter((rule) => rule.appliesTo.some((key) => keys.has(key)))
}

const validatorsFor = (project, step, allow) =>
  project.validators.filter((v) =>
    (v.modules ?? []).some((m) => (step.modules ?? []).includes(m)) ||
    (v.paths ?? []).some((p) => allow.some((glob) => glob.startsWith(p) || matchesAny(p, [glob]))))

/** Questions to settle before starting: the step's own plus ones derived from the environment. */
const buildQuestions = (step, facts, project) => {
  const questions = (step.questions ?? []).map((q) => ({ ...q, source: 'step' }))
  const required = new Set(step.env?.required ?? [])
  for (const key of step.env?.keys ?? []) {
    const missing = facts?.env?.missingKeys?.includes(key)
    if (facts && !missing) continue
    questions.push({
      id: `env-${key}`,
      ask: `Provide a value for ${key} (in .env.local), or confirm the offline path.`,
      why: `${key} is used by this step${facts ? ' and is not set locally' : ''}.`,
      default: required.has(key) ? undefined : 'Use the local mock or offline path; mark live verification as not run.',
      blocking: required.has(key),
      source: 'environment',
    })
  }
  if (step.kind === 'external' || (step.externalDeps ?? []).length > 0) {
    for (const dep of step.externalDeps ?? []) {
      questions.push({
        id: `external-${dep.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        ask: `Is ${dep} reachable and are credentials available?`,
        why: 'The step depends on something outside this repository.',
        default: step.kind === 'external' ? undefined : 'Build against a stub; record the missing dependency in the PR.',
        blocking: step.kind === 'external',
        source: 'external',
      })
    }
  }
  for (const service of step.env?.services ?? []) {
    if (!project.services?.[service]) {
      questions.push({ id: `service-${service}`, ask: `Service "${service}" is not defined in project.json. How is it started?`, why: 'Unknown service', blocking: true, source: 'environment' })
    }
  }
  return questions
}

/** Checks gathered from live facts. `severity: block` stops the start; `warn` is shown. */
export const preflightChecks = ({ step, ready, project, facts, claims = [], ports = [] }) => {
  const checks = []
  const push = (id, ok, severity, detail) => checks.push({ id, ok, severity, detail })
  push('step-open', isOpen(step), 'block', isOpen(step) ? `status is ${step.status}` : `step is already ${step.status}`)
  push(
    'prerequisites',
    ready.blockers.length === 0 && ready.unknown.length === 0,
    'block',
    ready.blockers.length === 0 && ready.unknown.length === 0
      ? 'all dependsOn steps are complete'
      : `waiting on ${[...ready.blockers.map((b) => `${b.id} (${b.status})`), ...ready.unknown.map((u) => `${u} (unknown)`)].join(', ')}`,
  )
  if (facts?.git) {
    push('not-claimed', claims.length === 0, 'block', claims.length === 0 ? 'no branch exists for this step' : `already claimed by branch ${claims.join(', ')}`)
    push('tree-clean', facts.git.clean || facts.git.resuming, 'block', facts.git.resuming ? 'resuming the owner branch; existing work is retained' : facts.git.clean ? 'working tree is clean' : 'working tree has uncommitted changes; commit or stash first')
    if (facts.git.behind !== undefined) {
      push('base-current', facts.git.behind === 0, 'warn', facts.git.behind === 0 ? `${project.mainBranch} is up to date with ${project.remote}` : `${project.mainBranch} is ${facts.git.behind} commit(s) behind ${project.remote}`)
    }
  }
  if (facts?.env) {
    const nodeOk = semverAtLeast(facts.env.node, project.node.min)
    push('node', nodeOk, 'block', nodeOk ? `node ${facts.env.node}` : `node ${facts.env.node} is older than ${project.node.min}`)
    push('dependencies', facts.env.nodeModules, 'block', facts.env.nodeModules ? 'node_modules present' : `run ${project.install}`)
    const busy = ports.filter((p) => facts.env.portsInUse?.includes(p))
    push('ports', busy.length === 0, 'warn', busy.length === 0 ? 'dev ports are free' : `ports already in use: ${busy.join(', ')}`)
  }
  return checks
}

/**
 * Each catalog module may record `gaps`: strings, or `{ text, step?, outOfScope?: { reason, owner } }`. The gaps of each
 * module design, so a brief shows what is still open in the packages the step touches.
 * @param {{ index: object, id: string, catalog: object, project: object, guardrails: object, facts?: object }} input
 */
export const buildBrief = ({ index, id, catalog, project, guardrails, facts }) => {
  const entry = index.steps.get(id)
  if (!entry) return { ok: false, error: `Unknown step "${id}".` }
  const { step } = entry
  const catalogModules = modulesById(catalog)
  const modules = (step.modules ?? []).map((moduleId) => catalogModules[moduleId] ?? { id: moduleId, name: moduleId, kind: 'unknown', dependsOn: [], dependents: [], tags: [] })
  const ready = readiness(index, id)
  const branch = { kind: 'step', stepId: id }
  const scope = scopeFor(branch, step, project, catalogModules)
  const branchName = branchNameFor(id, step)
  const claims = facts?.git?.claims ?? []

  const ports = uniq([
    ...modules.map((m) => m.dev?.port),
    ...(step.env?.ports ?? []),
    ...(step.env?.services ?? []).map((s) => project.services?.[s]?.port),
  ].filter(Boolean))

  const checks = preflightChecks({ step, ready, project, facts, claims, ports })
  const blockingChecks = checks.filter((c) => !c.ok && c.severity === 'block')
  const questions = buildQuestions(step, facts, project)

  const touched = new Set(modules.map((m) => m.id))
  const dependentModules = uniq(modules.flatMap((m) => m.dependents ?? [])).filter((d) => !touched.has(d)).sort()
  const verification = [
    ...modules.filter((m) => m.hasTests).map((m) => ({ label: `${m.id} tests`, command: m.testCommand ?? project.tests.package.replace('{pkg}', m.id) })),
    ...(dependentModules.length > 0 && dependentModules.length <= 6
      ? dependentModules.map((d) => ({ label: `${d} tests (depends on a touched module)`, command: project.tests.package.replace('{pkg}', d) }))
      : dependentModules.length > 6
        ? [{ label: `${dependentModules.length} dependent modules`, command: project.tests.allPackages }]
        : []),
    ...validatorsFor(project, step, scope.allow).map((v) => ({ label: `validator: ${v.id}`, command: v.run })),
    ...(step.verify ?? []).map((command) => ({ label: 'step-specific', command })),
    { label: 'whole repository', command: project.tests.root },
    { label: 'scope and plan checks', command: 'npm run pmo -- check --for-pr' },
  ]

  const tags = uniq([...(step.tags ?? []), ...modules.flatMap((m) => m.tags ?? [])])

  return {
    ok: true,
    id,
    title: step.title,
    summary: step.summary,
    kind: step.kind ?? 'build',
    status: step.status,
    workstream: entry.workstream,
    epic: entry.epic,
    canStart: { ok: blockingChecks.length === 0, reasons: blockingChecks.map((c) => c.detail) },
    metrics: {
      effort: step.effort ?? null,
      points: effortPoints(step),
      risk: step.risk ?? null,
      value: step.value ?? null,
      score: decisionScore(step),
      unblocks: transitiveDependents(index, id),
    },
    prerequisites: (step.dependsOn ?? []).map((dep) => {
      const target = index.steps.get(dep)?.step
      return { id: dep, title: target?.title ?? '(unknown)', status: target?.status ?? 'unknown', done: target?.status === 'complete' }
    }),
    modules: modules.map((m) => ({
      id: m.id, name: m.name, kind: m.kind, version: m.version, maturity: m.maturity,
      dev: m.dev ?? null, pilot: m.pilot ?? null, dependsOn: m.dependsOn ?? [], dependents: m.dependents ?? [],
    })),
    preflight: checks,
    questions,
    git: {
      base: project.mainBranch,
      branch: branchName,
      commands: [
        `git fetch ${project.remote}`,
        `git switch ${project.mainBranch}`,
        `git pull --ff-only ${project.remote} ${project.mainBranch}`,
        `git switch -c ${branchName}`,
      ],
      shortcut: `npm run pmo -- start ${id}`,
      worktree: `npm run pmo -- start ${id} --worktree`,
      commit: `[${id}] <imperative summary>   e.g. [${id}] ${step.title}`,
      push: `git push -u ${project.remote} ${branchName}`,
      pr: { base: project.mainBranch, title: `[${id}] ${step.title}`, checklist: project.completion.prChecklist },
      claims,
    },
    env: {
      node: `>=${project.node.min}`,
      install: project.install,
      envFile: 'Copy .env.example to .env.local (never edit .env). Keys for this step: ' + ((step.env?.keys ?? []).join(', ') || 'none'),
      keys: step.env?.keys ?? [],
      required: step.env?.required ?? [],
      ports,
      services: (step.env?.services ?? []).map((name) => ({ name, ...(project.services?.[name] ?? {}) })),
      run: modules.filter((m) => m.dev).map((m) => ({ module: m.id, command: m.dev.command, port: m.dev.port })),
    },
    scope: {
      allow: scope.allow,
      frozen: project.frozenPaths.map(({ glob, reason }) => ({ glob, reason })),
      crossModuleReason: step.scope?.crossModuleReason ?? null,
      imports: [
        'Import another module only through its public entry (index.js), and declare it in dependsOn in pmo/data/modules.json.',
        'Relative imports must stay in this module, or go to a declared dependency or server/contracts/**.',
      ],
    },
    guardrails: guardrailsFor(guardrails, modules, tags).map(({ id: ruleId, title, rule, severity, source, enforcement }) => ({ id: ruleId, title, rule, severity, source, enforcement })),
    openGaps: modules.filter((m) => (m.gaps ?? []).length).map((m) => ({ moduleId: m.id, packageDir: m.path ?? m.id, gaps: m.gaps.map((gap) => (typeof gap === 'string' ? { text: gap } : gap)) })),
    tasks: step.tasks ?? [],
    acceptance: step.acceptance ?? [],
    verification,
    completion: [
      `Edit packages/pmo/data/plan.json for step ${id} only: status "complete", evidence (paths that exist), completedAt (YYYY-MM-DD), optional notes.`,
      'Run: npm run pmo -- check --for-pr',
      'Commit with the [step id] prefix; push; open the pull request using the checklist above.',
      'List every assumption made for a non-blocking question in the PR description.',
    ],
    protocol: [
      'Ask the blocking questions together, in one message, before any change. Do not ask anything else.',
      'Use each non-blocking question\'s default, and record it as an assumption.',
      'Start the branch (git section), then work inside the scope only.',
    ],
  }
}

const bullet = (items) => items.map((item) => `- ${item}`).join('\n')

/** What the step changes for a new customer's setup, and the modules that carry it (config or data). */

/** Render a brief as markdown for an agent prompt or a terminal. */
export const renderBriefMarkdown = (brief) => {
  if (!brief.ok) return `# ${brief.error}\n`
  const lines = []
  const add = (...parts) => lines.push(...parts)
  add(`# Step ${brief.id}: ${brief.title}`, '', `${brief.workstream.id} ${brief.workstream.title} > ${brief.epic.id} ${brief.epic.title}`, `Status: ${brief.status} | Kind: ${brief.kind}`, '', brief.summary, '')

  if (brief.metrics.effort) {
    add('## Decision data',
      `- Effort: ${brief.metrics.effort.size} (${brief.metrics.points} pts)${brief.metrics.effort.notes ? ` - ${brief.metrics.effort.notes}` : ''}`,
      `- Risk: ${brief.metrics.risk.level} - ${brief.metrics.risk.notes}`,
      `- Value: ${brief.metrics.value.score}/5 - ${brief.metrics.value.why}`,
      `- Decision score: ${brief.metrics.score} (higher = sooner)`,
      `- Unblocks: ${brief.metrics.unblocks.length ? brief.metrics.unblocks.join(', ') : 'nothing else'}`, '')
  }

  add('## Can it start?', brief.canStart.ok ? 'Yes.' : `No. ${brief.canStart.reasons.join('; ')}`, '')
  if (brief.preflight.length) add(bullet(brief.preflight.map((c) => `[${c.ok ? 'ok' : c.severity === 'block' ? 'BLOCK' : 'warn'}] ${c.id}: ${c.detail}`)), '')
  if (brief.prerequisites.length) add('## Prerequisites', bullet(brief.prerequisites.map((p) => `${p.done ? '[done]' : '[open]'} ${p.id} ${p.title} (${p.status})`)), '')

  add('## Protocol', bullet(brief.protocol), '')
  const blocking = brief.questions.filter((q) => q.blocking)
  const defaults = brief.questions.filter((q) => !q.blocking)
  add('## Questions before starting')
  add(blocking.length ? '**Blocking (ask now, in one message):**' : '**No blocking questions.**')
  if (blocking.length) add(bullet(blocking.map((q) => `${q.ask} (why: ${q.why})`)))
  if (defaults.length) add('', '**Proceed on these defaults and record them as assumptions:**', bullet(defaults.map((q) => `${q.ask} -> default: ${q.default}`)))
  add('')

  add('## Git',
    'Run these in order (or use the shortcut):', '```', ...brief.git.commands, '```',
    `Shortcut: \`${brief.git.shortcut}\` (add --worktree to work in a separate directory).`,
    `Commit subjects: \`${brief.git.commit}\``,
    `Push: \`${brief.git.push}\``,
    `Pull request: base ${brief.git.pr.base}, title "${brief.git.pr.title}"`, '')
  if (brief.git.claims.length) add(`Already claimed by: ${brief.git.claims.join(', ')}`, '')

  add('## Environment', `- Node ${brief.env.node}; run \`${brief.env.install}\` once at the repo root.`, `- ${brief.env.envFile}`)
  if (brief.env.ports.length) add(`- Ports: ${brief.env.ports.join(', ')}`)
  for (const run of brief.env.run) add(`- Run ${run.module}: \`${run.command}\` (port ${run.port})`)
  for (const service of brief.env.services) add(`- Service ${service.name}: \`${service.command ?? 'not started locally'}\`${service.port ? ` (port ${service.port})` : ''}`)
  add('')

  add('')

  add('## Modules')
  for (const m of brief.modules) {
    add(`- ${m.id} (${m.kind}, v${m.version ?? '?'}, ${m.maturity ?? 'n/a'})${m.pilot ? ` | pilot: ${m.pilot.package}${m.pilot.dev ? ` (${m.pilot.dev.command}, ${m.pilot.dev.port})` : ''}` : ''}`)
    if (m.dependsOn.length) add(`  - depends on: ${m.dependsOn.join(', ')} (read-only for this step)`)
    if (m.dependents.length) add(`  - used by: ${m.dependents.join(', ')} (re-test these)`)
  }
  add('')

  add('## Scope and isolation', 'You may change:', bullet(brief.scope.allow.map((g) => `\`${g}\``)))
  if (brief.scope.crossModuleReason) add(`Cross-module reason: ${brief.scope.crossModuleReason}`)
  add('You may not change:', bullet(brief.scope.frozen.map((f) => `\`${f.glob}\` - ${f.reason}`)), '', bullet(brief.scope.imports), '')

  const gapLine = (gap) => `${gap.text}${gap.step ? ` -> step ${gap.step}` : gap.outOfScope ? ` -> out of scope (${gap.outOfScope.owner}: ${gap.outOfScope.reason})` : ''}`
  if (brief.openGaps?.some((item) => item.gaps.length)) add('## Open gaps in these modules', ...brief.openGaps.filter((item) => item.gaps.length).flatMap((item) => [`${item.moduleId} (${item.packageDir})`, bullet(item.gaps.map(gapLine))]), '')
  if (brief.tasks.length) add('## Tasks', brief.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n'), '')
  add('## Acceptance', bullet(brief.acceptance.map((a) => `[ ] ${a}`)), '')
  add('## Guardrails', bullet(brief.guardrails.map((g) => `${g.id} (${g.severity}) ${g.title}: ${g.rule} [${g.enforcement.kind}]`)), '')
  add('## Verify', bullet(brief.verification.map((v) => `${v.label}: \`${v.command}\``)), '')
  add('## Completion', brief.completion.map((c, i) => `${i + 1}. ${c}`).join('\n'), '')
  return lines.join('\n')
}
