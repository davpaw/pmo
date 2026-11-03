import { normalizeRepositoryState } from './repository-state.js'

/** Keep the last snapshot on failure, but never keep its live-state label. */
export const createRepositoryRefresher = ({ ctx, fetcher, render }) => {
  let pending = null
  return async () => {
    if (pending) return pending
    pending = (async () => {
      try {
        const response = await fetcher('/api/pmo/repository', { cache: 'no-store' })
        if (!response.ok) throw Error('unavailable')
        const state = normalizeRepositoryState((await response.json()).repository)
        if (!state) throw Error('invalid snapshot')
        ctx.repositoryState = state
        ctx.repositoryOnline = true
        ctx.repositoryMessage = 'Local checkout refreshed.'
      } catch {
        ctx.repositoryOnline = false
        ctx.repositoryMessage = 'Local refresh unavailable. Showing the last snapshot; restart the local PMO with current code to enable refresh.'
      }
      render()
    })()
    try { await pending } finally { pending = null }
  }
}
