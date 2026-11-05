# Step 4.2.1 verification

Verified locally on 2026-11-04. All 224 tests passed with only root-installed dependencies (nested pmo/node_modules was moved aside). Production build and fresh PMO validation passed. Browser checks were repeated against the production preview, including the lazily loaded viewer.

- Unit/integration coverage: scanner fixtures exercise imports and declared dependencies, services, storage, security observations and unknowns, additions/edits/deletions, ignored tracked files, symlinks, malformed metadata/URLs, limits and stale references. HTTP tests cover local-origin restrictions, body rejection, coalescing, rate limits and safe failure. Client/agent tests cover model-free commands, overlays, retained snapshots and deleted selections.
- Chrome with a fresh temporary profile: opened the new tab, selected layers, inspected nodes, exercised zoom/fit, switched tabs and verified retained filters, and refreshed from the PMO Agent without model credentials. No page errors.
- Live source smoke check: created a temporary offered route, refreshed and observed it, changed it and observed replacement, then deleted it and verified removal. Removed the temporary fixture afterward.
- Injected a labelled synthetic HTTP failure and verified the last diagram stayed visible with an error. Checked the mobile layout at 390px.
- Screenshot review confirmed dependency arrows flow left to right, graph controls and minimap are present, and security unknowns are explicit.

The scanner is static JS/TS syntax analysis, not deployment inspection. Unsupported languages, dynamic expressions and deployment configuration remain coverage gaps or public host declarations. This limitation is shown in the tab and documented in logical-architecture.md.

The in-app browser runtime could not initialize (`node:process` import restriction), so browser verification used local Playwright with an isolated headless Chrome profile. Browser dependencies and screenshots are temporary verification artifacts, not application dependencies.
