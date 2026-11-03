# PMO

Standalone, attachable program-management tooling: plan, module ownership, guardrails, briefings, PR delivery, repository facts and contribution checks. This repository is the PMO product source and uses its own plan at `pmo/data/plan.json`.

## Attach from Git

Pin the existing source repository, then scaffold a fresh host copy (do not use the product's self-plan as the host plan):

```sh
git submodule add https://github.com/davpaw/pmo.git .pmo-source
node .pmo-source/pmo/scripts/pmo.mjs init
```

Alternatively clone PMO outside the host and run its `pmo/scripts/pmo.mjs init` from the host directory. Initialization refuses to overwrite an existing copy. It copies a portable allowlist, creates fresh project data, records source provenance, and excludes source-project plans, secrets, caches and recovery data.

## Attach through npm

The repository package exposes the `pmo` binary. Pin an approved commit:

```sh
npm install github:davpaw/pmo#<approved-commit>
npx pmo init
```

Add host scripts pointing to `node pmo/scripts/pmo.mjs`; the scaffold includes the standalone CLI/UI. A release pin must be known before import verification can pass. The `pmo/data/upstream.json` metadata contains public source references and hashes only, never authentication values.

## Work and contribute

```sh
npm run pmo -- brief <step>
npm run pmo -- start <step> --worktree
npm run pmo -- prs sync
npm run pmo -- worktrees --check
npm run pmo -- upstream check --verify-remote
npm run pmo -- finish
```

Generic changes go back to PMO main; the managed project retains its plan, policies and adapters. A changed generic file needs content-bound evidence of the merged upstream PR. Host-only source exceptions are approved in the host plan before implementation. See [the contribution loop](pmo/CONTRIBUTING.md).

Finish verifies evidence, committed/pushed head and PR linkage. It reports awaiting review/merge separately from verified main delivery. It never creates a recovery bundle or deletes work.

## Run this product

`npm install`, `npm test`, `npm run pmo:validate`, `npm run build`, and `npm run pmo:dev` (port 5299). Provider calls use the server-side model gateway; no keys are sent to the browser.
