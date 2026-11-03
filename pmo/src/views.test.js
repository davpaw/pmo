import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { toHtml } from './ui/index.js'
import { indexPlan } from './plan.js'
import { DEFAULT_UI, NAV, parseRoute, renderRoute } from './views.js'

// Plan and guardrail prose quotes the leak it guards against; neutralise it so the leak check stays meaningful.
const load = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../data/${name}`, import.meta.url)), 'utf8').replaceAll('[object Object]', 'an object placeholder'))
const plan = load('plan.json')
const ctx = { plan, index: indexPlan(plan), catalog: load('catalog.generated.json'), guardrails: load('guardrails.json'), project: load('project.json'), live: null }
const render = (hash, c = ctx, ui = DEFAULT_UI()) => toHtml(renderRoute(parseRoute(hash), c, ui))
const leaks = (out) => out.includes('[object Object]') || /undefined/.test(out.replace(/chip chip-warn">undefined/g, ''))

test('every section renders without leaking object placeholders', () => {
  for (const [key] of NAV) {
    const out = render(`#/${key}`)
    assert.ok(out.length > 200, key)
    assert.ok(!leaks(out), `${key} leaked a placeholder`)
  }
})

test('every step and every module has a detail page', () => {
  for (const id of ctx.index.steps.keys()) assert.ok(!leaks(render(`#/steps/${id}`)), id)
  for (const m of ctx.catalog.modules) assert.ok(render(`#/modules/${m.id}`).includes(m.title), m.id)
})

test('an open step shows its brief; unknown routes degrade gracefully', () => {
  // The first step still open, so the test does not go stale as steps complete.
  const open = [...ctx.index.steps.values()].find(({ step }) => step.status !== 'complete')
  assert.ok(open, 'the plan has an open step')
  const out = render(`#/steps/${open.id}`)
  assert.match(out, /Agent brief/)
  assert.match(out, new RegExp(`implement step ${open.id.replaceAll('.', '\\.')}`))
  assert.match(render('#/steps/9.9.9'), /Unknown step/)
  assert.match(render('#/modules/nope'), /Unknown module/)
  assert.ok(render('#/nonsense').includes('Steps complete'), 'falls back to the overview')
})

test('data values are escaped, not interpreted', () => {
  const hostile = structuredClone(plan)
  hostile.workstreams[0].epics[0].steps[0].title = '<img src=x onerror=alert(1)>'
  const hostileCtx = { ...ctx, plan: hostile, index: indexPlan(hostile) }
  const out = render('#/roadmap', hostileCtx)
  assert.ok(!out.includes('<img src=x'))
  assert.ok(out.includes('&lt;img src=x'))
})

test('filters narrow the lists', () => {
  const ui = DEFAULT_UI()
  ui.decisions.status = 'roadmap'
  ui.modules.kind = 'tooling'
  assert.ok(!render('#/decisions', ctx, ui).includes('HiddenIncompleteStep'), 'incomplete step hidden by the roadmap filter')
  const modules = render('#/modules', ctx, ui)
  assert.ok(modules.includes('PMO'))
  assert.ok(!modules.includes('Nope'))
})

test('the modules page separates built from planned modules and shows ownership', () => {
  const out = render('#/modules')
  assert.match(out, /not built/)
  assert.match(out, /built/)
  const detail = render('#/modules/tenancy')
  assert.match(detail, /server\/tenancy\/\*\*/)
  assert.match(detail, /May depend on/)
})

test('live git data appears when provided', () => {
  const live = { generatedAt: 'now', branch: 'main', head: 'abc1234', clean: true, totalCommits: 1, branches: [{ name: 'step/2.3.1-x', kind: 'step', stepId: '2.3.1' }], modules: {} }
  const out = render('#/git', { ...ctx, live })
  assert.match(out, /abc1234/)
  assert.match(out, /step\/2\.3\.1-x/)
  assert.match(render('#/git'), /No repository snapshot/)
})

test('pending PRs appear as decisions and claim branches remain readable and escaped',()=>{
 const state={schemaVersion:1,repository:'owner/project',checkedAt:new Date().toISOString(),ok:true,pullRequests:[{number:21,title:'<review pending>',url:'https://github.com/owner/project/pull/21',kind:'delivery',state:'OPEN',baseRefName:'main',headRefName:'step/1.1.2-work',blocks:[],checks:[]}]}
 const out=render('#/decisions',{...ctx,index:indexPlan(plan,{pullRequests:state})})
 assert.match(out,/#21/);assert.match(out,/&lt;review pending&gt;/)
 const gitOut=render('#/git',{...ctx,repositoryState:{generatedAt:new Date().toISOString(),branch:'step/1.1.2-long-name',head:'abc123',clean:false,branches:[]}})
 assert.match(gitOut,/step\/1\.1\.2-long-name/)
 assert.match(gitOut,/Uncommitted local changes/)
})
