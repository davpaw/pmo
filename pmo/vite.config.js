import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { pmoAgentPlugin } from './src/node/agent-http.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// The app reads data/*.json (committed) and public/data/live.json (generated, git-ignored).
// The agent endpoint (/api/agent/*) is served by the dev and preview servers; its key never reaches the browser.
export default defineConfig({
  base: '/',
  plugins: [pmoAgentPlugin({ root: repoRoot })],
  server: { port: 5299, strictPort: true },
  preview: { port: 4299, strictPort: true },
})
