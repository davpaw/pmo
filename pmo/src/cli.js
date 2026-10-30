/**
 * The PMO command line. `run` takes its inputs explicitly (root, output sinks)
 * so tests can drive it against a throw-away git repository.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, basename, resolve } from 'node:path'
import { buildBrief, renderBriefMarkdown } from './briefing.js'
import { checkChangedFiles, checkCommitMessage, checkImports, checkPlanIntegrity, checkReadyForPr, classifyBranch, scopeFor } from './isolation.js'
import { branchNameFor, indexPlan, nextSteps, rankOpenSteps, readiness, rollup } from './plan.js'
import { isOpen, validateGuardrails, validatePlan } from './schema.js'
import { buildCatalog } from './node/catalog-build.js'
import { addedLines, baseRef, changedFiles, claimsFor, currentBranch, git, hasRef, mergeBase, showAt } from './node/git.js'
import { buildLive } from './node/live.js'
import { gatherFacts } from './node/preflight.js'
import { commandAgent } from './node/agent-setup.js'
import { commandPlan } from './node/plan-command.js'

export const PLAN_PATH = 'pmo/data/plan.json'
const DATA = 'pmo/data'
const VALUE_FLAGS = new Set(['base', 'branch', 'limit', 'status', 'module', 'workstream', 'model', 'base-url', 'provider', 'router-url', 'step', 'plan', 'epic', 'file', 'json'])

export const parseArgs = (argv) => {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) positional.push(arg)
    else {
      const [name, inline] = arg.slice(2).split(/=(.*)/s)
      if (inline !== undefined) flags[name] = inline
      else if (VALUE_FLAGS.has(name) && argv[i + 1] && !argv[i + 1].startsWith('--')) flags[name] = argv[(i += 1)]
      else flags[name] = true
    }
  }
  return { positional, flags }
}

const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'))

export const loadData = (root) => {
  const catalogPath = join(root, DATA, 'catalog.generated.json')
  return {
    plan: readJson(root, `${DATA}/plan.json`),
    project: readJson(root, `${DATA}/project.json`),
    guardrails: readJson(root, `${DATA}/guardrails.json`),
    catalog: existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : { modules: [] },
  }
}

const packageIds = (root) => Object.keys(readJson(root, `${DATA}/modules.json`).modules)

const pad = (text, width) => String(text).padEnd(width)

/* -------------------------------------------------------------------- checks */

/**
 * Everything `check` and the hooks enforce, as a list of problems.
 *
 * @returns {{ problems: { section: string, message: string }[], branch: object, notes: string[] }}
 */
export const evaluate = ({ root, data, branchName, base, staged = false, forPr = false, commits = true }) => {
  const { project } = data
  const problems = []
  const notes = []
  const add = (section, message) => problems.push({ section, message })

  const branch = classifyBranch(branchName, project)
  if (!branch.ok) {
    add('branch', branch.reason)
    return { problems, branch, notes }
  }

  const planProblems = validatePlan(data.plan, { moduleIds: packageIds(root), pathExists: (p) => existsSync(join(root, p)) })
  for (const message of planProblems) add('plan', message)
  const index = indexPlan(data.plan)
  const step = branch.kind === 'step' ? index.steps.get(branch.stepId)?.step : null
  if (branch.kind === 'step' && !step) {
    add('step', `Step ${branch.stepId} is not in plan.json. Add it on a plan/<slug> branch first.`)
    return { problems, branch, notes }
  }

  const baseName = base ?? baseRef(root, project)
  if (!hasRef(root, baseName)) {
    add('base', `Base ref "${baseName}" not found. Fetch ${project.remote} or pass --base.`)
    return { problems, branch, notes }
  }
  const since = mergeBase(root, baseName)

  const basePlanText = showAt(root, since, PLAN_PATH)
  const basePlan = basePlanText ? JSON.parse(basePlanText) : null
  if (branch.kind === 'step' && basePlan) {
    const ready = readiness(indexPlan(basePlan), branch.stepId)
    const baseStep = indexPlan(basePlan).steps.get(branch.stepId)?.step
    if (!baseStep) add('step', `Step ${branch.stepId} did not exist on ${baseName}. Merge the plan change first.`)
    else if (baseStep.status === 'complete') add('step', `Step ${branch.stepId} is already complete on ${baseName}.`)
    for (const blocker of ready.blockers) add('prerequisites', `Step ${branch.stepId} waits on ${blocker.id} (${blocker.status}) on ${baseName}.`)
  }
  if (basePlan) for (const message of checkPlanIntegrity(basePlan, data.plan, branch)) add('plan-integrity', message)

  let files
  let added
  if (staged) {
    files = git(root, ['diff', '--cached', '--name-only', '--no-renames']).split('\n').filter(Boolean)
    added = []
    let file = null
    for (const line of git(root, ['diff', '--cached', '-U0', '--no-color', '--no-renames']).split('\n')) {
      if (line.startsWith('+++ b/')) file = line.slice(6)
      else if (line.startsWith('+++ ')) file = null
      else if (file && line.startsWith('+')) added.push({ file, text: line.slice(1) })
    }
  } else {
    files = changedFiles(root, baseName)
    added = addedLines(root, baseName, (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : ''))
  }
  const modules = Object.fromEntries(data.catalog.modules.map((m) => [m.id, m]))
  notes.push(`${scopeFor(branch, step, project, modules).note}; ${files.length} changed file(s)`)

  for (const v of checkChangedFiles(files, branch, step, project, modules)) add(v.rule, `${v.file}: ${v.reason}`)
  for (const v of checkImports(added, modules, project)) add(v.rule, `${v.file}: ${v.reason}\n    ${v.line}`)

  if (commits && !staged) {
    for (const subject of git(root, ['log', '--format=%s', `${since}..HEAD`]).split('\n').filter(Boolean)) {
      for (const message of checkCommitMessage(subject, branch, project)) add('commit', message)
    }
  }
  if (forPr) {
    if (branch.kind !== 'step') add('for-pr', 'Only step branches carry a step to complete.')
    else for (const message of checkReadyForPr(step, { pathExists: (p) => existsSync(join(root, p)) })) add('for-pr', message)
  }
  return { problems, branch, notes }
}

/* ------------------------------------------------------------------ commands */

const commandBrief = async ({ root, data, args, out }) => {
  const id = args.positional[1]
  if (!id) return fail(out, 'Usage: pmo brief <step id> [--json] [--no-facts]')
  const index = indexPlan(data.plan)
  const entry = index.steps.get(id)
  if (!entry) return fail(out, `Unknown step "${id}". Try: pmo list`)
  let facts
  if (!args.flags['no-facts']) {
    const preview = buildBrief({ index, id, catalog: data.catalog, project: data.project, guardrails: data.guardrails })
    facts = await gatherFacts({ root, project: data.project, stepId: id, keys: preview.env.keys, ports: preview.env.ports })
  }
  const brief = buildBrief({ index, id, catalog: data.catalog, project: data.project, guardrails: data.guardrails, facts })
  out.log(args.flags.json ? JSON.stringify(brief, null, 2) : renderBriefMarkdown(brief))
  return 0
}

const fail = (out, message) => {
  out.error(message)
  return 1
}

const commandStart = async ({ root, data, args, out }) => {
  const id = args.positional[1]
  if (!id) return fail(out, 'Usage: pmo start <step id> [--base <ref>] [--worktree] [--dry-run]')
  const { project } = data
  const remote = git(root, ['remote'], { allowFail: true })?.split('\n').includes(project.remote)
  const dry = Boolean(args.flags['dry-run'])
  // Refresh before reading either the canonical plan or remote claims. A failed refresh is not success.
  if (remote && !dry) {
    out.log(`$ git fetch --prune ${project.remote}`)
    try { git(root, ['fetch', '--prune', project.remote]) } catch (error) { return fail(out, error.message) }
  }
  const base = args.flags.base ?? (remote ? `${project.remote}/${project.mainBranch}` : project.mainBranch)
  const baseBranch = String(base).replace(`${project.remote}/`, '')
  if (baseBranch !== project.mainBranch && classifyBranch(baseBranch, project).kind !== 'step') return fail(out, 'A review base must be main or an explicit step branch, never an unmerged plan branch.')
  if (!hasRef(root, base)) return fail(out, `Canonical base ${base} is unavailable; fetch it first.`)
  let canonical
  try { canonical = JSON.parse(showAt(root, base, PLAN_PATH)) } catch { return fail(out, `No readable plan on canonical base ${base}.`) }
  const index = indexPlan(canonical)
  const entry = index.steps.get(id)
  if (!entry) return fail(out, `Step ${id} is not on ${base}. Merge its plan change first.`)
  const owner = classifyBranch(currentBranch(root), project)
  const resume = owner.kind === 'step' && owner.stepId === id
  const preview = buildBrief({ index, id, catalog: data.catalog, project, guardrails: data.guardrails })
  const facts = await gatherFacts({ root, project, stepId: id, keys: preview.env.keys, ports: preview.env.ports, base, plan: canonical, excludeBranch: resume ? currentBranch(root) : undefined })
  if (resume) facts.git.clean = true // Retain the owner's in-progress work; no checkout or mutation occurs.
  const brief = buildBrief({ index, id, catalog: data.catalog, project, guardrails: data.guardrails, facts })
  if (!brief.canStart.ok) return fail(out, `Cannot start step ${id}: ${brief.canStart.reasons.join('; ')}`)
  if (resume) { out.log(`Resuming ${currentBranch(root)} against ${base}; existing work retained. Run pmo check before committing.`); return 0 }
  const branch = branchNameFor(id, entry.step)
  const run = (argv) => { out.log(`$ git ${argv.join(' ')}`); if (!dry) git(root, argv) }
  if (args.flags.worktree) {
    const target = resolve(root, '..', `${basename(root)}-step-${id.replace(/\./g, '-')}`)
    run(['worktree', 'add', target, '-b', branch, base])
    out.log(`Worktree ready at ${target}. Base: ${base}. Install dependencies and run brief ${id} there.`)
  } else {
    run(['switch', '-c', branch, base])
    out.log(`On ${branch}. Base: ${base}.`)
  }
  for (const question of brief.questions.filter((q) => q.blocking)) out.log(`Blocking before implementation: ${question.ask}`)
  return 0
}

const commandCheck = ({ root, data, args, out }) => {
  const branchName = args.flags.branch ?? currentBranch(root)
  const { problems, branch, notes } = evaluate({
    root, data, branchName, base: args.flags.base, forPr: Boolean(args.flags['for-pr']),
  })
  out.log(`branch ${branchName} (${branch.kind}${branch.stepId ? ` ${branch.stepId}` : ''})`)
  for (const note of notes) out.log(`  ${note}`)
  if (problems.length === 0) {
    out.log('ok: scope, imports, plan and commits are clean')
    return 0
  }
  for (const { section, message } of problems) out.error(`  [${section}] ${message}`)
  out.error(`\n${problems.length} problem(s). Fix them or move the work to the right branch.`)
  return 1
}

const commandHook = ({ root, data, args, out }) => {
  const kind = args.positional[1]
  const branchName = currentBranch(root)
  if (kind === 'commit-msg') {
    const file = args.positional[2]
    const message = file ? readFileSync(file, 'utf8') : ''
    const branch = classifyBranch(branchName, data.project)
    const problems = branch.ok ? checkCommitMessage(message, branch, data.project) : [branch.reason]
    for (const p of problems) out.error(`[commit] ${p}`)
    return problems.length ? 1 : 0
  }
  if (kind === 'pre-commit') {
    const { problems } = evaluate({ root, data, branchName, staged: true, commits: false })
    for (const { section, message } of problems) out.error(`[${section}] ${message}`)
    if (problems.length) out.error('\nCommit blocked by the PMO guard. See pmo/data/project.json and run: npm run pmo -- brief <step id>')
    return problems.length ? 1 : 0
  }
  return fail(out, 'Usage: pmo hook <pre-commit|commit-msg> [file]')
}

const commandStatus = ({ root, data, out }) => {
  const index = indexPlan(data.plan)
  const { overall, workstreams } = rollup(index)
  const branchName = currentBranch(root)
  const branch = classifyBranch(branchName, data.project)
  out.log(`${data.project.name} | branch ${branchName} (${branch.kind})`)
  out.log(`steps: ${overall.complete} complete, ${overall.in_progress} in progress, ${overall.incomplete} incomplete, ${overall.roadmap} roadmap | ${overall.remainingPoints} effort points remaining`)
  for (const ws of workstreams) {
    out.log(`  ${pad(ws.id, 3)}${pad(ws.title, 40)} ${ws.counts.complete}/${ws.counts.total} complete, ${ws.counts.remainingPoints} pts left`)
  }
  if (branch.kind === 'step') {
    const entry = index.steps.get(branch.stepId)
    out.log(`\nactive step: ${branch.stepId} ${entry?.step.title ?? '(not in plan)'} [${entry?.step.status}]`)
  }
  const claimed = [...index.steps.keys()].filter((id) => claimsFor(root, data.project.remote, id).length > 0)
  if (claimed.length) out.log(`claimed steps: ${claimed.join(', ')}`)
  return 0
}

const commandList = ({ data, args, out }) => {
  const index = indexPlan(data.plan)
  const statusFilter = args.flags.status ? String(args.flags.status).split(',') : null
  const rows = []
  for (const entry of index.steps.values()) {
    const { step } = entry
    if (statusFilter && !statusFilter.includes(step.status)) continue
    if (args.flags.module && !(step.modules ?? []).includes(args.flags.module)) continue
    if (args.flags.workstream && entry.workstream.id !== args.flags.workstream) continue
    const ready = readiness(index, entry.id)
    if (args.flags.blocked && (ready.ready || !isOpen(step))) continue
    rows.push(`${pad(entry.id, 8)}${pad(step.status, 12)}${pad(step.effort?.size ?? '', 4)}${pad(step.risk?.level ?? '', 8)}${pad(step.value?.score ?? '', 3)}${pad(isOpen(step) && !ready.ready ? 'blocked' : '', 8)}${step.title}`)
  }
  out.log(`${pad('id', 8)}${pad('status', 12)}${pad('eff', 4)}${pad('risk', 8)}${pad('val', 3)}${pad('', 8)}title`)
  rows.forEach((row) => out.log(row))
  return 0
}

const commandNext = ({ data, args, out }) => {
  const index = indexPlan(data.plan)
  const limit = Number.parseInt(args.flags.limit ?? '5', 10)
  const rows = args.flags.all ? rankOpenSteps(index, { includeBlocked: true }).slice(0, limit) : nextSteps(index, limit)
  out.log(`${pad('id', 8)}${pad('score', 7)}${pad('eff', 4)}${pad('risk', 8)}${pad('val', 5)}${pad('unblocks', 9)}title`)
  for (const row of rows) out.log(`${pad(row.id, 8)}${pad(row.score, 7)}${pad(row.effort?.size ?? '', 4)}${pad(row.risk?.level ?? '', 8)}${pad(row.value?.score ?? '', 5)}${pad(row.unblocks, 9)}${row.title}${row.ready ? '' : '  [blocked]'}`)
  if (rows.length) out.log('\nStart one with: npm run pmo -- start <id>')
  return 0
}

const commandValidate = async ({ root, data, args, out }) => {
  const problems = [
    ...validatePlan(data.plan, { moduleIds: packageIds(root), pathExists: (p) => existsSync(join(root, p)) }),
    ...validateGuardrails(data.guardrails, { pathExists: (p) => existsSync(join(root, p)) }),
  ]
  if (args.flags.fresh) {
    const fresh = await buildCatalog({ root })
    if (JSON.stringify(fresh) !== JSON.stringify(data.catalog)) problems.push('catalog.generated.json is stale. Run: npm run pmo -- build')
  }
  for (const p of problems) out.error(`  ${p}`)
  out.log(problems.length ? `${problems.length} problem(s)` : 'ok: plan, guardrails and catalog are valid')
  return problems.length ? 1 : 0
}

const commandBuild = async ({ root, data, args, out }) => {
  const catalog = await buildCatalog({ root })
  const target = join(root, DATA, 'catalog.generated.json')
  writeFileSync(target, `${JSON.stringify(catalog, null, 2)}\n`)
  out.log(`wrote ${DATA}/catalog.generated.json (${catalog.counts.modules} modules, ${catalog.counts.built} built)`)
  if (args.flags.git) {
    const live = buildLive({ root, catalog, project: data.project })
    const livePath = join(root, 'pmo/public/data/live.json')
    mkdirSync(dirname(livePath), { recursive: true })
    writeFileSync(livePath, `${JSON.stringify(live, null, 2)}\n`)
    out.log('wrote pmo/public/data/live.json (git-ignored)')
  }
  return 0
}

const commandHooks = ({ root, args, out }) => {
  if (args.positional[1] !== 'install') return fail(out, 'Usage: pmo hooks install')
  git(root, ['config', 'core.hooksPath', '.githooks'])
  const dir = join(root, '.githooks')
  if (existsSync(dir)) for (const name of readdirSync(dir)) chmodSync(join(dir, name), 0o755)
  out.log('git hooks installed (core.hooksPath = .githooks). Hooks can be bypassed with --no-verify; CI is the enforcement of record.')
  return 0
}

const HELP = `pmo - Program management

  brief <id> [--json] [--no-facts]   Everything needed to implement a step
  start <id> [--base <ref>] [--worktree] [--dry-run] Create the step branch after preflight
  check [--for-pr] [--base ref]      Scope, imports, plan integrity, commits
  status | list | next              Overview, step table, ranked next steps
  validate [--fresh]                 Plan, guardrails (and catalog freshness)
  build [--git]                      Regenerate the catalog (and live git facts)
  hooks install                      Enable .githooks
  agent [status|setup|prompt]        Configure the Ask the PMO Agent window (key stays in .env.local)
  plan template|add|set|remove|epic|workstream  Change the plan without hand-editing plan.json (plan/ branch; see pmo plan)`

/** @returns {Promise<number>} exit code */
export const run = async (argv, { root, out = console, prompt, jira, fetchImpl } = {}) => {
  const args = parseArgs(argv)
  const command = args.positional[0]
  const data = loadData(root)
  const ctx = { root, data, args, out, prompt, jira, fetchImpl }
  switch (command) {
    case 'brief': return commandBrief(ctx)
    case 'start': return commandStart(ctx)
    case 'check': return commandCheck(ctx)
    case 'hook': return commandHook(ctx)
    case 'status': return commandStatus(ctx)
    case 'list': return commandList(ctx)
    case 'next': return commandNext(ctx)
    case 'validate': return commandValidate(ctx)
    case 'build': return commandBuild(ctx)
    case 'hooks': return commandHooks(ctx)
    case 'agent': return commandAgent(ctx)
    case 'plan': return commandPlan({ ...ctx, moduleIds: packageIds(root), planPath: PLAN_PATH })
    default:
      out.log(HELP)
      return command && command !== 'help' ? 1 : 0
  }
}
