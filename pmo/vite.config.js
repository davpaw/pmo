import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { pmoSnapshotPlugin } from './src/node/snapshot-http.js'
import { pmoPrPlugin } from './src/node/pr-http.js'
import { pmoRepositoryPlugin } from './src/node/repository-http.js'
import { pmoArchitecturePlugin } from './src/node/architecture-http.js'
import { pmoAgentPlugin } from './src/node/agent-http.js'
import { pmoPlanPlugin } from './src/node/plan-http.js'
import { pmoEntityPlugin, createEntityService, runEntityScan } from './src/node/entity-http.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const entityService = createEntityService({ scan: () => runEntityScan(repoRoot) })

// The app reads data/*.json (committed) and public/data/live.json (generated, git-ignored).
// The agent endpoint (/api/agent/*) is served by the dev and preview servers; its key never reaches the browser.
export default defineConfig({
  base: '/',
  plugins: [pmoEntityPlugin({ root: repoRoot, service: entityService }), pmoPlanPlugin({ root: repoRoot }), pmoArchitecturePlugin({ root: repoRoot }), pmoSnapshotPlugin({ root: repoRoot }), pmoAgentPlugin({ root: repoRoot, entityService }), pmoPrPlugin({ root: repoRoot }), pmoRepositoryPlugin({ root: repoRoot })],
  server: { port: 5299, strictPort: true },
  preview: { port: 4299, strictPort: true },
})
