# Working in PMO

Read `pmo/data/plan.json` first, then docs.

## 'Implement step X.Y.Z'

1. `npm run pmo -- brief X.Y.Z` prints the step, its dependencies, the modules and paths it may change, the guardrails that apply, questions and the verification commands.
2. Answer the blocking questions in one message.
3. `npm run pmo -- start X.Y.Z` creates `step/X.Y.Z-<slug>` from `main`.
4. Change only what the step's modules own. Commit as `[X.Y.Z] summary`.
5. Set the step to `complete` in `pmo/data/plan.json` with `evidence` paths that exist and `completedAt`.
6. `npm run pmo -- check --for-pr`, then `npm test`.
7. Open a pull request using the checklist in `pmo/data/project.json`.

- Branch kinds are step/<id>-<slug>, plan/<slug> and release/<slug>. main is protected and only changes by pull request. One step per branch.
- Finishing a task (G-014): every agent updates the PMO before reporting a task done. Set the step status, evidence and completedAt in plan.json.
- Models are reached through the model gateway (direct API by default, AIRouter optional).
- publishing-providers module example for knowledge snapshot.