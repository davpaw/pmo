/**
 * `pmo plan ...`: change the plan without hand-editing plan.json. The writing
 * is in ../plan-edit.js; this reads the input, checks the branch and touches
 * the file.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { classifyBranch } from '../isolation.js'
import {
  EPIC_TEMPLATE, STEP_TEMPLATE, TEMPLATE_HINTS, WORKSTREAM_TEMPLATE,
  insertEpic, insertStep, insertWorkstream, nextStepId, prepareEpic, prepareRemove, prepareSet, prepareStep, prepareWorkstream, removeStep, replaceStep,
} from '../plan-edit.js'
import { askForStep, isYes } from '../plan-prompt.js'
import { terminalPrompt } from './agent-setup.js'
import { currentBranch } from './git.js'

const readJson = (args, what) => {
  const { file, json } = args.flags
  if ((file === undefined) === (json === undefined)) throw new Error(`give the ${what} with --file <${what}.json> or --json '{...}', not both and not neither`)
  if (file === true || json === true) throw new Error(`--${file === true ? 'file' : 'json'} needs a value`)
  const source = file === undefined ? json : readFileSync(resolve(process.cwd(), file), 'utf8')
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new Error(`the ${what} is not valid JSON: ${error.message}`)
  }
}

const TEMPLATES = { step: STEP_TEMPLATE, epic: EPIC_TEMPLATE, workstream: WORKSTREAM_TEMPLATE }

const say = (out, message) => (out.error ?? out.log).call(out, message)

const commandTemplate = ({ args, out }) => {
  const kind = args.positional[2] ?? 'step'
  if (!(kind in TEMPLATES)) {
    say(out, 'usage: pmo plan template [step | epic | workstream]')
    return 1
  }
  out.log(JSON.stringify(TEMPLATES[kind], null, 2))
  if (kind === 'step') for (const hint of TEMPLATE_HINTS) say(out, `# ${hint}`)
  else say(out, `# ids are assigned; ${kind === 'epic' ? 'an epic needs a first step' : 'a workstream needs a first epic, and that epic a first step'}. The step takes the fields shown by: pmo plan template step`)
  return 0
}

/**
 * Shared by every command that writes the plan: the plan-branch rule, the
 * report of problems and the write. `change(text)` returns, or resolves to,
 * either `{ problems }` or `{ text, wrote, dry }`, where text is the new plan
 * file.
 */
const writeChange = async ({ root, data, out, planPath, args, verb }, change) => {
  const fail = (message) => {
    say(out, message)
    return 1
  }
  const dryRun = args.flags['dry-run'] === true
  const branchName = currentBranch(root)
  if (!dryRun && classifyBranch(branchName, data.project).kind !== 'plan') {
    return fail(`plan ${verb} changes the plan, so it runs on a plan/<slug> branch; this is ${branchName}. Use --dry-run to check a change without writing.`)
  }
  const file = join(root, planPath)
  let result
  try {
    result = await change(readFileSync(file, 'utf8'))
  } catch (error) {
    return fail(error.message)
  }
  if (result.cancelled) return fail(`${result.cancelled} Nothing was written.`)
  if (result.problems) {
    for (const problem of result.problems) say(out, `  ${problem}`)
    return fail(`not changed: ${result.problems.length} problem(s). Nothing was written.`)
  }
  if (dryRun) {
    out.log(`ok: ${result.dry}. Nothing was written.`)
    return 0
  }
  writeFileSync(file, result.text)
  out.log(result.wrote)
  out.log('next: npm run pmo:validate, then npm run pmo:build if modules changed, then commit as "plan: ..."')
  return 0
}

const checkContext = ({ root, moduleIds }) => ({ moduleIds, pathExists: (path) => existsSync(join(root, path)) })

/** Questions on the terminal (or the injected reader), then the finished step shown for confirmation. */
const promptForStep = async (ctx) => {
  const { args, data, out, prompt } = ctx
  const ask = prompt ?? (process.stdin.isTTY && process.stdout.isTTY ? terminalPrompt : null)
  if (!ask) throw new Error('give the step with --file <step.json> or --json \'{...}\'; asking for it needs a terminal')
  const epics = data.plan.workstreams.flatMap((ws) => ws.epics)
  const steps = epics.flatMap((epic) => epic.steps)
  const { epicId, draft } = await askForStep({
    ask,
    say: (line) => out.log(line),
    epicId: typeof args.flags.epic === 'string' ? args.flags.epic : undefined,
    epicIds: epics.map((epic) => epic.id),
    nextId: (id) => nextStepId(data.plan, id),
    moduleIds: ctx.moduleIds,
    stepIds: steps.map((step) => step.id),
  })
  return { epicId, draft, ask }
}

const commandAdd = (ctx) => writeChange({ ...ctx, verb: 'add' }, async (text) => {
  const { args, out } = ctx
  const prompting = args.flags.file === undefined && args.flags.json === undefined
  let draft
  let epicId
  let ask
  if (prompting) ({ epicId, draft, ask } = await promptForStep(ctx))
  else {
    draft = readJson(args, 'step')
    epicId = typeof args.flags.epic === 'string' ? args.flags.epic : String(draft?.id ?? '').split('.').slice(0, 2).join('.')
    if (!epicId) throw new Error('name the epic with --epic <id> (for example 4.4), or give the step an id')
  }
  const { step, problems } = prepareStep(ctx.data.plan, epicId, draft, checkContext(ctx))
  if (!step) return { problems }
  if (prompting && args.flags['dry-run'] !== true) {
    out.log(JSON.stringify(step, null, 2))
    if (!isYes(await ask(`Add ${step.id} to epic ${epicId}? [y/N]: `))) return { cancelled: 'Cancelled.' }
  }
  return { text: insertStep(text, epicId, step), dry: `${step.id} would be added to epic ${epicId}`, wrote: `added ${step.id}: ${step.title}` }
})

const commandSet = (ctx) => writeChange({ ...ctx, verb: 'set' }, (text) => {
  const stepId = ctx.args.positional[2]
  if (!stepId) throw new Error('usage: pmo plan set <step id> (--file <changes.json> | --json \'{"field": value}\') [--dry-run]; null removes a field')
  const { step, problems } = prepareSet(ctx.data.plan, stepId, readJson(ctx.args, 'changes'), checkContext(ctx))
  if (!step) return { problems }
  return { text: replaceStep(text, stepId, step), dry: `${stepId} would be changed`, wrote: `changed ${stepId}: ${step.title}` }
})

const commandRemove = (ctx) => writeChange({ ...ctx, verb: 'remove' }, (text) => {
  const stepId = ctx.args.positional[2]
  if (!stepId) throw new Error('usage: pmo plan remove <step id> [--dry-run]')
  const { step, problems } = prepareRemove(ctx.data.plan, stepId)
  if (!step) return { problems }
  return { text: removeStep(text, stepId), dry: `${stepId} would be removed`, wrote: `removed ${stepId}: ${step.title}` }
})

const commandEpic = (ctx) => writeChange({ ...ctx, verb: 'epic' }, (text) => {
  const workstreamId = ctx.args.flags.workstream
  if (typeof workstreamId !== 'string') throw new Error('name the workstream with --workstream <id> (for example 4)')
  const { epic, problems } = prepareEpic(ctx.data.plan, workstreamId, readJson(ctx.args, 'epic'), checkContext(ctx))
  if (!epic) return { problems }
  return { text: insertEpic(text, workstreamId, epic), dry: `epic ${epic.id} would be added to workstream ${workstreamId}`, wrote: `added epic ${epic.id}: ${epic.title}, with its first step ${epic.steps[0].id}` }
})

const commandWorkstream = (ctx) => writeChange({ ...ctx, verb: 'workstream' }, (text) => {
  const { workstream, problems } = prepareWorkstream(ctx.data.plan, readJson(ctx.args, 'workstream'), checkContext(ctx))
  if (!workstream) return { problems }
  const epic = workstream.epics[0]
  return { text: insertWorkstream(text, workstream), dry: `workstream ${workstream.id} would be added`, wrote: `added workstream ${workstream.id}: ${workstream.title}, with epic ${epic.id} and its first step ${epic.steps[0].id}` }
})

const COMMANDS = { template: commandTemplate, add: commandAdd, set: commandSet, remove: commandRemove, epic: commandEpic, workstream: commandWorkstream }

export const USAGE = [
  'usage: pmo plan template [step | epic | workstream]',
  '       pmo plan add --epic <id> (--file <step.json> | --json \'{...}\') [--dry-run]',
  '       pmo plan set <step id> (--file <changes.json> | --json \'{...}\') [--dry-run]',
  '       pmo plan remove <step id> [--dry-run]',
  '       pmo plan epic --workstream <id> (--file <epic.json> | --json \'{...}\') [--dry-run]',
  '       pmo plan workstream (--file <workstream.json> | --json \'{...}\') [--dry-run]',
].join('\n')

export const commandPlan = (ctx) => {
  const sub = ctx.args.positional[1]
  if (sub in COMMANDS) return COMMANDS[sub](ctx)
  ctx.out.log(USAGE)
  return sub ? 1 : 0
}
