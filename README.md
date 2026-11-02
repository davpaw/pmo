# PMO  Program Management in the age of AI and vibecoding

Standalone, attachable program-management tooling: a plan of record, module catalog, guardrails, briefings and a git-aware CLI. Attach it to any repository as a git submodule under `pmo/`.

## Attach to a project

### Git submodule

```sh
git submodule add <pmo-repo-url> pmo
```

### npm install

```sh
npm install <pmo-package-or-git-url>
npx pmo init
```

Add scripts to the host `package.json`:

```json
{
  "scripts": {
    "pmo": "node pmo/scripts/pmo.mjs",
    "pmo:dev": "node pmo/scripts/pmo.mjs build --git && node pmo/scripts/run-vite.mjs dev",
    "pmo:preview": "node pmo/scripts/run-vite.mjs preview",
    "pmo:validate": "node pmo/scripts/pmo.mjs validate --fresh",
    "test": "node --test pmo/src/*.test.js pmo/src/agent/*.test.js pmo/src/node/*.test.js pmo/src/ui/*.test.js"
  }
}
```

## Run

- `npm run pmo -- brief 1.1.1`
- `npm run pmo -- validate`
- `npm run pmo:dev` serves the PMO app on port 5299.

## Self-hosting

This repository uses PMO against itself: the plan in `pmo/data/plan.json` tracks PMO's own development.
