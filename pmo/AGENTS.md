# PMO source and attached copies

Follow the host repository's AGENTS.md and approved plan. `davpaw/pmo` is the PMO product source. A copied/attached PMO is a consumer, not a new product fork.

- Classify PMO changes before implementation. Generic behavior, contracts, UI, checks and tests are contributed to PMO main through its own scoped step and PR. Keep project plans, domain adapters, credentials, caches and historical recovery data in the managed project.
- Attached copies record `data/upstream.json`: source repository, immutable revision, source directory and content-bound contribution receipts. A generic edit needs a merged upstream PR that changed its mapped source path. Host-only source exceptions need a substantive reason approved in the host step's base plan; they are never a blanket exemption for future edits.
- Run `npm run pmo -- worktrees --check` when beginning and ending a session. Resume existing owned work. Dirty main, unknown branches and completed-step worktrees must be resolved before starting another step.
- Finish the active step's evidence and date, commit, push, fetch and open its PR. Run `npm run pmo -- upstream check --verify-remote` and `npm run pmo -- finish` before reporting implementation ready. Report awaiting review/merge separately from verified delivery on main.
- Do not leave uncommitted work, a stash, or an unpushed head as an implicit handoff. Record an explicit owner and next action when handing off active work. Never create recovery bundles as the normal completion or synchronization workflow.
- Cleanup is a separate explicit action after verified main integration. Never delete another developer's active work or private configuration.
- No project data, credentials, environment files, generated snapshots, runtime caches or recovery archives may enter upstream exports or distributions.
