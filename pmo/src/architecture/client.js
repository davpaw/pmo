import { DEFAULT_OPTIONS } from './graph.js'
/** State survives tab changes and is shared by the tab and explicit PMO Agent commands. */
export const createArchitectureClient = ({ fetchImpl = (...args) => fetch(...args) } = {}) => {
  const state = { graph: null, busy: false, error: '', options: { ...DEFAULT_OPTIONS }, query: '', focus: '', selected: null }
  const listeners = new Set()
  let pending = null
  const notify = () => { for (const listener of listeners) listener() }
  return {
    state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    update(patch) { Object.assign(state, patch); notify() },
    load(refresh = false) {
      if (pending) return pending
      if (state.graph && !refresh) return Promise.resolve(state.graph)
      state.busy = true; state.error = ''; notify()
      pending = (async () => {
        try {
          const response = await fetchImpl('/api/pmo/architecture', { method: refresh ? 'POST' : 'GET', cache: 'no-store' })
          const body = await response.json()
          if (!response.ok || body?.graph?.version !== 1 || !Array.isArray(body.graph.nodes) || !Array.isArray(body.graph.edges)) throw Error(body?.error || 'Architecture scan unavailable. Run the PMO dev or preview server.')
          state.graph = body.graph
          if (state.selected && ![...body.graph.nodes, ...body.graph.edges].some(n => n.id === state.selected)) state.selected = null
          if (state.focus && !body.graph.nodes.some(n => n.id === state.focus)) state.focus = ''
          return body.graph
        } catch (error) { state.error = error.message || 'Architecture scan unavailable.'; throw error }
        finally { state.busy = false; pending = null; notify() }
      })()
      return pending
    },
  }
}
