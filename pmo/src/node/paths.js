import { existsSync } from 'node:fs'
import { join } from 'node:path'
/** Host layout is configuration; both conventional attached and workspace layouts are supported. */
export const pmoDirectory = (root, project = {}) => {
  const configured = project.pmo?.directory
  if (configured !== undefined) {
    if (typeof configured !== 'string' || configured.startsWith('/') || configured.includes('\\') || configured.split('/').some(part => !part || part === '.' || part === '..')) throw Error('PMO directory must stay within the repository.')
    return configured
  }
  return ['pmo', 'packages/pmo'].find(path => existsSync(join(root, path, 'data/plan.json'))) || 'pmo'
}
