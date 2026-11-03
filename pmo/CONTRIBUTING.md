# Improve PMO once, for every project

The source repository is https://github.com/davpaw/pmo. Its own plan tracks PMO product work. Managed projects own their plans, policies, module declarations and business adapters.

For a reusable change discovered in a host:

1. Add a scoped product step in PMO's plan and a linked integration step in the host plan.
2. Implement and test the generic change in PMO. Keep dependencies and fixtures standalone. Open a PMO PR and merge it to configured main.
3. Update the host integration. `data/upstream.json` pins the source revision and records a generic receipt with `upstream.repository`, `upstream.pullRequest`, `upstream.commit`, and `files` containing each host package-relative `path`, current `sha256`, and mapped repository-relative `upstreamPath`. The commit is the upstream PR's merge commit.
4. Run `pmo upstream check --verify-remote`. CI verifies exact current host hashes, the merged upstream PR, main target, merge commit and changed source paths. A later edit invalidates the old receipt. Semantic equivalence of host adaptations remains part of review.
5. Commit, push, fetch and open the host PR; run `pmo finish`. A successful open PR is reported as awaiting review/merge. Delivered means its merge is verified on the configured main ref.

A host-specific source edit needs a `host-specific` receipt with exact content hashes and a substantive `reason`, plus a matching `scope.upstreamExceptions` entry in the already approved base plan. Project data under `data/` and generated `public/data/` are host-owned; executable JS/TS placed there remains source and cannot hide under the data exclusion.

For a first byte-identical import, `importedFiles` records hashes. Remote verification checks those bytes against `sourcePath` at the pinned revision and proves that revision is reachable from upstream main. Existing modified host copies use reviewed contribution receipts, not a fabricated byte-identical import.

Use `pmo worktrees --check` to surface dirty or unavailable checkouts and stashes. `pmo start` refuses dirty work without an open owner. Legitimate parallel work remains on separate open step branches. `pmo finish` refuses dirty, unpushed or PR-less work. These commands inspect state and never write recovery bundles or silently clean files.

GitHub access uses existing local `gh` authentication or a CI read token. Never record a token in upstream metadata. Rotate/revoke the credential in GitHub, refresh local `gh` authentication or the CI secret reference, then rerun verification. If GitHub or source verification is unavailable, the verified finish gate stays blocked.
