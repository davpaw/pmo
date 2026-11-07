/**
 * "Ask the PMO Agent": a window docked to the bottom of the screen. It lives
 * outside the routed view, so navigating does not clear the conversation.
 * It only ever sends a question; the instructions stay on the server.
 */

import { html, toHtml } from './ui/index.js'
import { architectureCommand } from './architecture/graph.js'
import { entityCommand } from './entities.js'

export const SUGGESTIONS = [
  'Show entities',
  'Refresh entities',
  'Show logical flow chart',
  'Refresh logical flow chart',
  'What should I work on next, and why?',
  'How do I start step 1.1.3?',
  'I want to add a new capability. Which route do I follow?',
  'Which guardrails apply to publishing, and how are they enforced?',
]

const MIN_KEY = 'pmo.agent.minimized'

export const initialState = () => ({ open: false, minimized: false, busy: false, draft: '', sessionId: null, messages: [], status: null, entityContext: null })

const statusChip = (status) => {
  if (!status) return html`<span class="chip">Checking</span>`
  if (!status.configured) return html`<span class="chip chip-warn">Not set up</span>`
  if (status.ready) return html`<span class="chip chip-ok">Ready</span>`
  if (status.state === 'rejected') return html`<span class="chip chip-warn">Key rejected</span>`
  if (status.state === 'not_found') return html`<span class="chip chip-warn">Model not found</span>`
  return html`<span class="chip chip-warn">Not verified</span>`
}

const setupHelp = (status) => html`<div class="agent-setup" role="note">
  ${status?.configured
    ? html`<p><strong>${status.usable ? 'The key could not be checked just now.' : 'The model did not accept these settings.'}</strong> The server asks the model a tiny question before showing Ready.</p>`
    : html`<p><strong>The agent needs a model.</strong> Keys and tokens are read by the server from <code>.env.local</code> and never reach the browser.</p>`}
  <p>Show or refresh the logical flow chart without model setup.</p>
  <p>Run <code>npm run pmo -- agent setup</code>. It asks which provider to use (a model API directly, or AIRouter), then the model, key or token and address, and writes <code>.env.local</code>. No restart is needed.</p>
  ${status?.issues?.length ? html`<ul>${status.issues.map((issue) => html`<li>${issue}</li>`)}</ul>` : ''}
</div>`

const message = (item) => html`<div class="agent-msg agent-msg-${item.role === 'user' ? 'user' : item.error ? 'error' : 'agent'}">
  <span class="agent-who">${item.role === 'user' ? 'You' : 'PMO Agent'}</span>
  <div class="agent-text">${item.text}</div>
  ${item.entityPin ? html`<p class="muted">Answer pinned to ${item.entityPin.entityId} · ${item.entityPin.variant} · snapshot ${item.entityPin.snapshotIdentity}</p>` : ''}
  ${item.unverified ? html`<span class="chip chip-warn">Explanation unverified; citations are not automatic truth</span>` : ''}
  ${item.flagged ? html`<span class="chip chip-warn">Rules unchanged</span>` : ''}
</div>`

export const renderPanel = (state) => state.minimized ? html`<section class="agent agent-min" aria-label="Ask the PMO Agent">
  <button type="button" class="agent-restore" data-agent-restore aria-label="Show the PMO Agent">Ask the PMO Agent</button>
</section>` : html`<section class="agent" aria-label="Ask the PMO Agent">
  <div class="agent-bar">
    <button type="button" class="agent-toggle" data-agent-toggle aria-expanded="${state.open ? 'true' : 'false'}" aria-controls="agent-body">Ask the PMO Agent</button>
    ${statusChip(state.status)}
    ${state.status?.ready ? html`<span class="muted agent-model">${state.status.model}</span>` : ''}
    ${state.open && state.messages.length ? html`<button type="button" class="agent-link" data-agent-reset>New chat</button>` : ''}
    <button type="button" class="agent-minimize" data-agent-minimize aria-label="Minimize the PMO Agent" title="Minimize"><svg class="agent-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M3 8h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
  </div>
  <div class="agent-body" id="agent-body" ${state.open ? '' : html`hidden`}>
    ${state.entityContext ? html`<div role="status" aria-live="polite">Selected schema context: ${state.entityContext.entityId} · snapshot ${state.entityContext.snapshotIdentity}<button type="button" data-agent-context-clear>Remove entity context</button></div>` : ''}
    <div class="agent-log" role="log" aria-live="polite" tabindex="0" aria-label="Conversation">
      ${state.messages.length === 0
        ? html`<p class="muted">Ask what to build next, how a step fits the plan, or which git and guardrail rules apply. It advises; it cannot run commands or change files.</p>
          <div class="agent-suggest">${SUGGESTIONS.map((text) => html`<button type="button" class="agent-chip" data-agent-suggest="${text}">${text}</button>`)}</div>`
        : state.messages.map(message)}
      ${state.busy ? html`<p class="muted" data-agent-busy>Thinking</p>` : ''}
    </div>
    ${state.status && !state.status.ready ? setupHelp(state.status) : ''}
    <form class="agent-form" data-agent-form>
      <label class="visually-hidden" for="agent-input">Question for the PMO Agent</label>
      <textarea id="agent-input" class="agent-input" rows="2" maxlength="4000" placeholder="Ask the PMO Agent" data-agent-input>${state.draft}</textarea>
      <button type="submit" class="button" ${state.busy ? html`disabled` : ''}>Ask</button>
    </form>
    <p class="muted agent-note">The agent's rules are fixed on the server. Nothing typed here can change them.</p>
  </div>
</section>`

const errorText = (body, status) => (typeof body?.error === 'string' ? body.error : `The agent returned status ${status}.`)

/**
 * Mounts the panel into `host`. `fetchImpl` and `getRoute` are injectable for tests.
 * @returns {{ state: object, ask: (text: string) => Promise<void>, refreshStatus: () => Promise<void> }}
 */
export const mountAgentPanel = (host, { fetchImpl = (...args) => fetch(...args), getRoute = () => window.location.hash, doc = document, onArchitecture = null, onEntities = null } = {}) => {
  const state = initialState()
  try { state.minimized = localStorage.getItem(MIN_KEY) === '1' } catch { /* not remembered */ }
  const render = () => {
    const hadFocus = doc.activeElement?.matches?.('[data-agent-input]')
    host.innerHTML = toHtml(renderPanel(state))
    doc.body.dataset.agent = state.minimized ? 'min' : state.open ? 'open' : 'closed'
    const log = host.querySelector('.agent-log')
    if (log) log.scrollTop = log.scrollHeight
    if (hadFocus) host.querySelector('[data-agent-input]')?.focus()
  }

  const post = async (path, body) => {
    const response = await fetchImpl(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const json = await response.json().catch(() => null)
    return { response, json }
  }

  const refreshStatus = async () => {
    try {
      const response = await fetchImpl('/api/agent/status')
      state.status = response.ok ? await response.json() : { configured: false, issues: ['The agent service is not running. Use npm run pmo:dev.'] }
    } catch {
      state.status = { configured: false, issues: ['The agent service is not reachable.'] }
    }
    render()
  }

  const ask = async (text) => {
    const question = String(text ?? '').trim()
    if (!question || state.busy) return
    const entityAction = entityCommand(question)
    const command = entityAction || architectureCommand(question)
    if (!command && !state.status?.usable) {
      state.messages.push({ role: 'agent', text: 'Model setup is needed for questions. You can still show or refresh the logical flow chart.', error: true })
      render(); return
    }
    state.messages.push({ role: 'user', text: question })
    state.draft = ''
    state.busy = true
    render()
    if (command) {
      try {
        if (entityAction) {
          if (!onEntities) throw Error('The entity browser is not available here.')
          await onEntities(entityAction)
          state.messages.push({ role: 'agent', text: 'Opened public entity metadata. No model call or record access.' })
          state.busy = false; render(); return
        }
        if (!onArchitecture) throw Error('The architecture viewer is not available here.')
        await onArchitecture(command)
        state.messages.push({ role: 'agent', text: command === 'refresh' ? 'Rescanned the application and refreshed the Logical architecture tab.' : 'Opened the Logical architecture tab. Select layers or inspect a node or connection.' })
      } catch (error) { state.messages.push({ role: 'agent', text: error.message, error: true }) }
      state.busy = false; render(); return
    }
    let rejected = false
    const pinnedContext = state.entityContext ? { ...state.entityContext } : null
    try {
      const { response, json } = await post('/api/agent/ask', { sessionId: state.sessionId, message: question, route: getRoute(), ...(pinnedContext ? { entityContext: pinnedContext } : {}) })
      rejected = json?.code === 'rejected' || json?.code === 'not_found'
      if (json?.sessionId) state.sessionId = json.sessionId
      if (response.ok && json?.ok) state.messages.push({ role: 'agent', text: json.reply, flagged: Boolean(json.flagged), entityPin: json.entityPin || pinnedContext, unverified: json.unverified })
      else state.messages.push({ role: 'agent', text: errorText(json, response.status), error: true })
    } catch {
      state.messages.push({ role: 'agent', text: 'The agent could not be reached.', error: true })
    }
    state.busy = false
    render()
    host.querySelector('[data-agent-input]')?.focus()
    if (rejected) await refreshStatus()
  }

  host.addEventListener('click', (event) => {
    const target = event.target.closest?.('[data-agent-toggle], [data-agent-reset], [data-agent-suggest], [data-agent-minimize], [data-agent-restore], [data-agent-context-clear]')
    if (!target) return
    if ('agentContextClear' in target.dataset) { state.entityContext = null; render(); host.querySelector('[data-agent-input]')?.focus(); return }
    if ('agentMinimize' in target.dataset || 'agentRestore' in target.dataset) {
      state.minimized = 'agentMinimize' in target.dataset
      try { localStorage.setItem(MIN_KEY, state.minimized ? '1' : '0') } catch { /* private mode: not remembered */ }
      render()
      host.querySelector(state.minimized ? '[data-agent-restore]' : '[data-agent-toggle]')?.focus()
    } else if ('agentToggle' in target.dataset) {
      state.open = !state.open
      render()
      if (state.open) host.querySelector('[data-agent-input]')?.focus()
      if (state.open && !state.status?.ready) refreshStatus()
    } else if ('agentReset' in target.dataset) {
      if (state.sessionId) post('/api/agent/reset', { sessionId: state.sessionId }).catch(() => {})
      state.sessionId = null
      state.messages = []
      render()
    } else if (target.dataset.agentSuggest) ask(target.dataset.agentSuggest)
  })
  host.addEventListener('input', (event) => {
    if (event.target.matches?.('[data-agent-input]')) state.draft = event.target.value
  })
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && event.target.matches?.('[data-agent-input]')) {
      event.preventDefault()
      ask(state.draft)
    }
  })
  host.addEventListener('submit', (event) => {
    event.preventDefault()
    ask(state.draft)
  })

  render()
  refreshStatus()
  return { state, ask, refreshStatus, setEntityContext(context) { state.entityContext = { ...context }; state.open = true; state.minimized = false; render(); host.querySelector('[data-agent-input]')?.focus() } }
}
