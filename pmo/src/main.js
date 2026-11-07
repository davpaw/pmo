import { normalizedPrState } from './pull-requests.js'
import { createRepositoryRefresher } from './repository-client.js'
/**
 * PMO: a read-only view of the plan, the module catalog, the
 * guardrails and the agent brief for every step. Data files are bundled;
 * live git facts are optional (public/data/live.json, generated locally).
 */

import './style.css'
import { html, toHtml } from './ui/index.js'
import plan from '../data/plan.json'
import catalog from '../data/catalog.generated.json'
import guardrails from '../data/guardrails.json'
import project from '../data/project.json'
import { indexPlan } from './plan.js'
import { DEFAULT_UI, NAV, pageTitle, parseRoute, renderRoute } from './views.js'
import { mountAgentPanel } from './agent-panel.js'
import { createArchitectureClient } from './architecture/client.js'
import { mountPlanEditor } from './plan-editor.js'
import { createEntityClient } from './entities.js'

const architecture = createArchitectureClient()
const entities = createEntityClient()
let unmountEntities = null
let agentPanel = null
let unmountArchitecture = null
let unmountEditor = null
let renderVersion = 0
const app = document.querySelector('#app')
const ui = DEFAULT_UI()
const ctx = { plan, index: indexPlan(plan), catalog, guardrails, project, live: null, hostname: window.location.hostname }

const frame = (route) => html`<div class="shell">
  <header class="topbar"><h1>Program management</h1>
    <span class="sub">Plan updated ${ctx.plan.updated || 'not recorded'}. ${ctx.repositoryState || ctx.live ? 'Local checkout facts are shown under Git and rules.' : 'No local checkout snapshot.'}</span></header>
  <nav class="nav" aria-label="Sections">${NAV.map(([key, label]) => html`<a href="#/${key}" ${route.name === key ? html`aria-current="page"` : ''}>${label}</a>`)}</nav>
  <main><h2 class="visually-hidden">${pageTitle(route)}</h2>${renderRoute(route, ctx, ui)}</main>
</div>`

const render = () => {
  ctx.index.prNow = Date.now()
  const active = document.activeElement
  const focusKey = active?.dataset?.filter
  const caret = active?.selectionStart
  const route = parseRoute(window.location.hash)
  // Background read refreshes must not discard a draft or a reviewed confirmation.
  if (route.name === 'edit' && unmountEditor) return
  unmountArchitecture?.()
  unmountEntities?.()
  unmountEntities = null
  unmountEditor?.()
  unmountEditor = null
  unmountArchitecture = null
  app.innerHTML = toHtml(frame(route))
  const version = ++renderVersion
  if (route.name === 'edit') unmountEditor = mountPlanEditor(app.querySelector('#plan-editor'))
  if (route.name === 'entities') {
    const host = app.querySelector('#entities-view')
    import('./entities/viewer.jsx').then(({ mountEntities }) => {
      if (version === renderVersion && host.isConnected) unmountEntities = mountEntities(host, entities, { onAsk: context => agentPanel?.setEntityContext(context) })
    }).catch(() => { if (host.isConnected) host.textContent = 'Entity viewer unavailable. Reload to retry.' })
  }
  if (route.name === 'architecture') {
    const host = app.querySelector('#architecture-view')
    import('./architecture/viewer.jsx').then(({ mountArchitecture }) => {
      if (version === renderVersion && host.isConnected) unmountArchitecture = mountArchitecture(host, architecture)
    }).catch(() => { if (version === renderVersion && host.isConnected) host.textContent = 'The architecture viewer could not load. Reload this page to retry.' })
  }
  document.title = `${pageTitle(route)} - PMO`
  if (focusKey) {
    const next = app.querySelector(`[data-filter="${focusKey}"]`)
    next?.focus()
    if (typeof caret === 'number' && next?.setSelectionRange) next.setSelectionRange(caret, caret)
  }
}

app.addEventListener('input', (event) => applyFilter(event.target))
app.addEventListener('change', (event) => applyFilter(event.target))
app.addEventListener('click', async (event) => {
  if (event.target.closest?.('[data-repository-refresh]')) { await refreshRepository(); return }
  if (event.target.closest?.('[data-pr-refresh]')) { await refreshPrs(true); return }
  const button = event.target.closest?.('[data-copy]')
  if (!button) return
  const text = document.getElementById(button.dataset.copy)?.textContent ?? ''
  const status = app.querySelector('[data-copy-status]')
  try {
    await navigator.clipboard.writeText(text)
    if (status) status.textContent = 'Copied.'
  } catch {
    if (status) status.textContent = 'Copy failed; select the text and copy it.'
  }
})

function applyFilter(target) {
  const key = target?.dataset?.filter
  if (!key) return
  const [group, field] = key.split('.')
  if (!ui[group] || !(field in ui[group])) return
  ui[group][field] = target.value
  render()
}

window.addEventListener('hashchange', () => {
  render()
  window.scrollTo(0, 0)
  refreshFacts()
})

render()

// The agent window sits outside #app so route changes do not clear the conversation.
const agentHost = document.querySelector('#agent')
if (agentHost) agentPanel = mountAgentPanel(agentHost, { onEntities: async command => {
  window.location.hash = '#/entities'
  await entities.load(command === 'refresh')
}, onArchitecture: async (command) => {
  window.location.hash = '#/architecture'
  await architecture.load(command === 'refresh')
} })

// Live facts are optional; the app is fully usable without them.
fetch('/data/live.json', { cache: 'no-store' })
  .then((response) => (response.ok ? response.json() : null))
  .then((live) => {
    if (live && typeof live === 'object') {
      ctx.live = live
      if (!ctx.index.pullRequests || Date.parse(live.pullRequests?.checkedAt) > Date.parse(ctx.index.pullRequests.checkedAt)) {
        ctx.plan = live.pullRequests?.approvedPlan || plan
        ctx.index = indexPlan(ctx.plan, { pullRequests: live.pullRequests })
      }
      render()
    }
  })
  .catch(() => {})

let prRefresh = null
async function refreshPrs(force = false) {
  if (prRefresh) return prRefresh
  prRefresh = (async () => {
    try {
      const response = await fetch('/api/pmo/prs', { method: force ? 'POST' : 'GET', ...(force ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}), cache: 'no-store' })
      if (!response.ok) throw Error('unavailable')
      const state = normalizedPrState((await response.json()).pullRequests)
      if (!state) throw Error('state')
      ctx.plan = state.approvedPlan || plan
      ctx.index = indexPlan(ctx.plan, { pullRequests: state })
      ctx.prMessage = state.ok ? 'PR tracking refreshed.' : state.error
    } catch { ctx.prMessage = 'Local PR sync unavailable. Run npm run pmo -- prs sync and rebuild/refresh the PMO.' }
    render()
  })()
  try { await prRefresh } finally { prRefresh = null }
}
refreshPrs()
// Re-evaluate freshness even on a static site; local PMO instances also discover newly opened PRs.
setInterval(() => { ctx.index.prNow = Date.now(); refreshPrs() }, 60_000)

const refreshRepository = createRepositoryRefresher({ ctx, fetcher: (...args) => fetch(...args), render })
refreshRepository()
setInterval(refreshRepository, 60_000)

let factsRequest = 0
async function refreshFacts() {
  const request = ++factsRequest
  const route = parseRoute(window.location.hash)
  if (route.name !== 'steps') return
  try {
    const response = await fetch(`/api/pmo/snapshot?step=${encodeURIComponent(route.arg || '')}`, { cache: 'no-store' })
    if (!response.ok) return
    const snapshot = await response.json()
    if (request !== factsRequest || parseRoute(window.location.hash).arg !== route.arg) return
    ctx.live = snapshot
    render()
  } catch { /* The brief remains explicitly unverified without local machine facts. */ }
}
refreshFacts()
setInterval(refreshFacts, 30_000)
