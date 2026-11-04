# Logical application architecture

Step 4.2.1 adds an on-demand diagram of the application managed by PMO. Its root is the host repository, not the PMO package. This document defines implementation acceptance; the feature is not implemented yet.

## Viewer and navigation

Reuse the React Flow viewer from scheduler's `frontend/src/components/FlowDesigner/FlowDesigner.tsx` and adapt its `FlowEdge.tsx` connection renderer. Preserve pan/zoom, fit view, background grid, minimap, selection and an inspector. Isolate React mounting and cleanup to the new Logical architecture tab so existing PMO views remain independent. Package dependencies belong under `pmo/`; no runtime dependency on a developer's scheduler checkout. Record source provenance in the adapted component.

The PMO Agent recognizes explicit local commands such as “show logical flow chart”, “open logical architecture”, and “refresh logical flow chart”. These are deterministic read operations and do not require model credentials. A suggestion/button makes the feature discoverable. The model cannot choose a filesystem root or execute a scan tool. Opening navigates to the application tab; refresh invokes the same scan as the tab's Refresh button. Unrelated questions retain existing agent behavior.

The initial view shows modules, directed declared dependencies and observed module connections. Label relationship types distinctly. Planned or missing modules must be identifiable. Optional toggles include services offered, services called, persistence, locations, integrations, security, evidence, external packages and planned modules. Search and module focus help manage larger graphs. The inspector displays evidence and security for both nodes and connections. Render all labels as text.

## Graph and evidence

Use a versioned, JSON-safe graph contract with generated timestamp, repository revision, nodes, directed edges, scan coverage and warnings. Stable IDs preserve selection across refreshes. Every fact records its origin: declared, source-observed or unknown. Evidence names repository-relative files and lines, never entire source text. A declared dependency is not proof of an observed runtime connection. Package presence alone is not proof that an integration is active.

Fresh reads of `pmo/data/modules.json` supply module ownership and declared dependencies. Resolve source imports to discover inter-module connections, without executing the source. Initial supported source adapters and limitations must be documented. Discover literal service routes and outbound calls, persistence APIs and resource locations conservatively. Report dynamic expressions and unsupported constructs as coverage gaps, not guessed targets. Keep undeclared application source visible as unassigned coverage rather than silently ignoring it.

An optional host-owned `pmo/data/architecture.json` supplies facts static scanning cannot establish: service relationships, storage resources and deployment locations, integrations, authentication/authorization and explicit cryptographic configuration. Validate version, types, IDs, references and size limits; reject malformed input with a useful error. This file contains public architecture metadata only, never credentials. Distinguish its declarations from observed source evidence and flag unresolved references after source changes.

## Security at every level

The graph, each module/resource/service/integration node, and each relationship expose in-transit and at-rest security records. Records include status, protocol or mechanism, algorithm/security type, key length in bits, evidence and provenance. Unknown and not-applicable are distinct values. Authentication and authorization mechanisms may be separately declared or observed.

Do not infer storage encryption from a database dependency, a key length from HTTPS, or deployed transport security from a local URL. Explicit AES-256 configuration can support an observed 256-bit algorithm claim but does not prove deployed disk encryption. Claims remain source/declaration evidence rather than a runtime security attestation. Never collect key material, tokens, credentials, URL user information or sensitive query strings.

## Scan and refresh

Run a bounded read-only scan on the PMO server. The client cannot supply arbitrary roots, paths or commands. Traverse only allowed host files, respecting ignored paths, excluding environment/credential/key files, dependencies, build outputs, binaries and symlinks. Enforce file count, per-file byte and total-byte limits. Record truncation and unsupported input in coverage. Avoid returning raw exception details that expose local paths or secrets.

The existing same-origin protections apply to diagram endpoints. Coalesce concurrent refreshes and bound request frequency. Replace the graph only after a successful scan; show failures and the prior graph's timestamp clearly. Refresh must discover additions, edits, removals and module declaration changes, rebuilding edges as well as nodes. Preserve filters and valid selection, and clear selection when its item disappears. A static preview without a scan server must explain that live scanning is unavailable.

## Verification

Fixtures cover multiple owned modules, imports, declared dependencies, offered and called services, persistence, integrations and explicit/unknown security. Mutation tests add, edit and delete source and module declarations before rescanning. Tests also cover symlink escapes, ignored secrets, credential-bearing URLs, malformed metadata, scan limits, unsupported syntax, cycles and orphaned references.

UI and agent tests exercise local commands without model setup, default/optional overlays, node and edge inspection, refresh state and failure handling, safe rendering and mount cleanup. Browser smoke checks exercise pan/zoom, fit, minimap, tab switching and refresh against the server. Run PMO validation, scope checks, full tests and the production build. Record verification and limitations in the implementation PR.

Guardrails: G-004 read operations only; G-005/G-016 exclude credentials; G-006 source is data; G-007 no new model calls; G-012 versioned graph contract; G-013 scoped step branch; G-014 completion evidence; G-015 safe text rendering.
