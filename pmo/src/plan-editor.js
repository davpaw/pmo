import { html, toHtml } from './ui/index.js'
import { STEP_TEMPLATE } from './plan-edit.js'

export const editorView = () => html`<section class="panel"><h2>Edit the plan</h2>
  <p>Preview an add, re-scope or reorder against locally fetched main. Saving requires confirmation and creates a separate plan worktree. It never changes this checkout, main, or existing worktrees.</p>
  <div id="plan-editor"><p>Checking local editing helper… Static and production sites are read-only.</p></div></section>`

export const mountPlanEditor = (host, { fetcher = fetch } = {}) => {
  let active = true, preview = null, busy = false, revision = 0
  const call = async (path, body) => {
    const response = await fetcher(`/api/pmo/plan${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' } : { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) throw Error(result.error || 'Local editing helper unavailable.')
    return result
  }
  const status = message => { if (active) host.querySelector('[role="status"]').textContent = message }
  const clear = () => { revision++; preview = null; host.querySelector('[data-plan-review]').replaceChildren(); host.querySelector('[data-plan-confirm]').disabled = true }
  const load = async () => {
    try {
      const data = await call('')
      if (!active) return
      const epics = data.plan.workstreams.flatMap(ws => ws.epics)
      host.innerHTML = toHtml(html`<p>Editing canonical <code>${data.base}</code> at <code>${data.baseHead}</code>. Fetch main in a terminal when needed; this helper does not fetch or push.</p>
        <form data-plan-form>
        <label class="field"><span>Operation</span><select name="operation"><option value="add">Add a step</option><option value="set">Re-scope a roadmap step</option><option value="reorder">Reorder roadmap steps</option></select></label>
        <label class="field"><span>Target id</span><input name="target" required value="${epics[0]?.id || ''}" list="plan-targets"></label>
        <datalist id="plan-targets">${epics.flatMap(e => [e.id, ...e.steps.filter(s => s.status === 'roadmap').map(s => s.id)]).map(id => html`<option value="${id}"></option>`)}</datalist>
        <p>Add/reorder: epic id. Re-scope: roadmap step id. Reorder JSON: every roadmap id in the epic in desired order; other steps remain anchored.</p>
          <label class="field"><span>Plan branch slug</span><input name="slug" required pattern="[a-z0-9]([a-z0-9]|\\u002d){0,48}" placeholder="scope-review"></label>
        <label class="field"><span>Step or changes (JSON)</span><textarea name="changes" rows="18" required>${JSON.stringify(STEP_TEMPLATE, null, 2)}</textarea></label>
        <p>For re-scope, supply changed fields only (null removes a field). Ids, status and completion fields cannot change.</p>
        <button type="submit">Validate and preview diff</button></form>
        <p role="status" aria-live="polite">No files written.</p><div data-plan-review></div>
        <button type="button" data-plan-confirm disabled>Confirm and save in new plan worktree</button>
        <button type="button" data-plan-cancel>Cancel preview</button>`)
      host.querySelector('form').addEventListener('input', clear)
      host.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault()
        if (busy) return
        busy = true; clear()
        const requestedRevision = revision
        try {
          const fields = new FormData(event.target)
          const result = await call('/preview', { operation: fields.get('operation'), target: fields.get('target'), slug: fields.get('slug'), changes: JSON.parse(fields.get('changes')) })
          if (!active || requestedRevision !== revision) return
          preview = result
          host.querySelector('[data-plan-review]').innerHTML = toHtml(html`<h3>Review ${result.branch}</h3><p>Expires ${result.expiresAt}. Confirm only after reviewing this diff.</p><pre>${result.diff}</pre>`)
          host.querySelector('[data-plan-confirm]').disabled = false
          status('Validated preview. Nothing written; explicit confirmation required.')
        } catch (e) { status(e.message) } finally { busy = false }
      })
      host.querySelector('[data-plan-cancel]').addEventListener('click', () => { clear(); status('Cancelled. No save requested.') })
      host.querySelector('[data-plan-confirm]').addEventListener('click', async () => {
        if (!preview || busy) return
        busy = true
        const token = preview.token
        clear()
        try { const result = await call('/confirm', { token, confirmed: true }); status(`${result.message} Branch: ${result.branch}. Worktree: ${result.worktree}. Run npm run pmo:validate and npm run pmo -- check there before committing and opening a PR.`) } catch (e) { status(e.message) } finally { busy = false }
      })
    } catch (e) { if (active) host.textContent = `Read-only: ${e.message} Use the local development PMO with a clean checkout, or use npm run pmo -- plan in a terminal.` }
  }
  load()
  return () => { active = false }
}