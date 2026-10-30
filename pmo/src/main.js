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

const app = document.querySelector('#app')
const ui = DEFAULT_UI()
const ctx = { plan, index: indexPlan(plan), catalog, guardrails, project, live: null, hostname: window.location.hostname }

const frame = (route) => html`<div class="shell">
  <header class="topbar"><h1>Program management</h1>
    <span class="sub">Plan updated ${plan.updated}. ${ctx.live ? `Live git data from ${ctx.live.generatedAt}.` : 'No live git data.'}</span></header>
  <nav class="nav" aria-label="Sections">${NAV.map(([key, label]) => html`<a href="#/${key}" ${route.name === key ? html`aria-current="page"` : ''}>${label}</a>`)}</nav>
  <main><h2 class="visually-hidden">${pageTitle(route)}</h2>${renderRoute(route, ctx, ui)}</main>
</div>`

const render = () => {
  const active = document.activeElement
  const focusKey = active?.dataset?.filter
  const caret = active?.selectionStart
  const route = parseRoute(window.location.hash)
  app.innerHTML = toHtml(frame(route))
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
})

render()

// The agent window sits outside #app so route changes do not clear the conversation.
const agentHost = document.querySelector('#agent')
if (agentHost) mountAgentPanel(agentHost)

// Live facts are optional; the app is fully usable without them.
fetch('/data/live.json')
  .then((response) => (response.ok ? response.json() : null))
  .then((live) => {
    if (live && typeof live === 'object') {
      ctx.live = live
      render()
    }
  })
  .catch(() => {})
