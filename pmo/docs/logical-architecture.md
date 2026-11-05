# Logical architecture

Open **Logical architecture**, or ask the PMO Agent **Show logical flow chart**. Ask **Refresh logical flow chart** (or click **Refresh diagram**) after changing the managed application. Both commands work without model setup and never send source to a model.

The initial diagram shows modules and their dependencies/connections. Dashed green connections are declarations; solid connections are source observations. Select services offered/called, persistence, integrations, external packages, locations, security, evidence or planned modules. Search/focus narrows the graph. Select a node or edge for its inspector, including in-transit/on-disk security type, key length, authentication, authorization and evidence. Pan, zoom, fit and minimap controls follow scheduler's FlowDesigner; `FlowEdge.tsx` was adapted from that project's Bezier renderer. No scheduler runtime or checkout is needed.

## Scanning and limits

The local PMO dev/preview server scans the host repository, reading current module declarations and working files (including untracked files). GET `/api/pmo/architecture` lazily generates/caches a graph; bodyless POST refreshes it. Failed scans retain the previous diagram with an error and its timestamp. Refresh preserves selected layers and clears deleted selections. No client-chosen root, shell command or arbitrary filesystem path is accepted. Static hosting alone cannot scan.

Version 1 scans JavaScript/TypeScript, JSX/TSX and package manifests. It uses TypeScript syntax trees for relative imports/re-exports, require/dynamic literal imports, literal Express-style `app/router/server` route calls, fetch/axios calls, imported filesystem calls and selected SQLite/Postgres/Redis/MongoDB constructors. Exact single matching literal service paths are shown as unverified matches. These are syntactic observations: names can be shadowed, helpers and middleware may hide connections. Relative `.js` imports resolve to TypeScript source where appropriate. Aliases, computed paths, deployment settings and other languages need explicit metadata. Package imports/dependencies do not establish an active integration.

The scanner never evaluates application code. It excludes ignored files (even tracked ignored files), dot directories/files, tests/fixtures, generated/minified files, vendor/build output, secret/key files, binaries and symlinks. Defaults cap 4,000 scanned files, 512 KiB per file, 24 MiB total, 6,000 nodes and 16,000 observed edges. Metadata is limited to 1,000 nodes/edges. A worker enforces a 20-second timeout and a 256 MiB heap cap. Scans coalesce and are limited to 12 per minute. The endpoint checks loopback address, Host and Origin. Coverage reports skipped, unresolved, unsupported and unassigned source and truncation; a partial graph is never described as complete.

URLs expose only scheme and host, stripping user information, path, query and fragment. Relative route/resource locations omit query strings. Evidence is repository-relative filename/line only, never source excerpts. Application and resource security default to **unknown**: HTTPS is not evidence of a key length; a database dependency is not evidence of disk encryption. Observed cipher usage is listed separately and does not assert storage coverage. This is an architecture explorer, not a runtime security audit.

## Public host metadata

To supply facts code cannot establish, create `pmo/data/architecture.json` (or `data/architecture.json` under the detected `packages/pmo` layout). This is host-owned public metadata: never put keys, tokens, passwords, secret URLs or private values in it. Unknown fields, duplicate IDs, invalid types and unreasonable sizes are rejected. Missing references produce warnings.

```json
{
  "version": 1,
  "security": {
    "transit": { "status": "declared", "type": "TLS 1.3", "keyBits": null }
  },
  "nodes": [
    {
      "id": "module:api",
      "kind": "module",
      "label": "API",
      "location": "us-east-1 / application subnet",
      "security": { "authentication": "OIDC", "authorization": "RBAC" }
    },
    {
      "id": "orders-db",
      "kind": "persistence",
      "label": "Orders PostgreSQL",
      "module": "module:api",
      "location": "us-east-1 / private database subnet",
      "security": {
        "transit": { "status": "declared", "type": "TLS 1.3", "keyBits": null },
        "atRest": { "status": "declared", "type": "AES-256", "keyBits": 256 },
        "authentication": "IAM"
      }
    }
  ],
  "edges": [
    {
      "id": "api-orders-connection",
      "source": "module:api",
      "target": "orders-db",
      "label": "queries",
      "security": {
        "transit": { "status": "declared", "type": "TLS 1.3", "keyBits": null },
        "atRest": { "status": "not-applicable", "type": "No storage on this connection", "keyBits": null }
      }
    }
  ]
}
```

Module IDs are `module:<modules.json key>`. Module metadata enriches existing modules; it cannot invent module ownership. Other node kinds: `offered`, `called`, `persistence`, `integration`, `package`. A node's optional `module` adds an ownership/use connection. Edges reference graph node IDs and may declare their own security; endpoint encryption is not automatically inherited by a connection. Copy discovered stable IDs from the graph response when needed. IDs must be unique within each declared node/edge list. Metadata resource IDs must not collide with discovered IDs. Text fields are limited to 240 characters; key lengths are positive integer bits or null. Security status is `declared`, `unknown`, `none` or `not-applicable`; only the scanner emits `observed`.

Only explicitly recorded metadata is asserted. Declared security is evidence of the declaration, not validation of deployed settings. Remove outdated declarations when removing application resources; refresh warns when referenced modules or connection endpoints disappear.

## Installation

Run `npm install` in the source repository, or `npm install --prefix pmo` for an attached standalone copy. Both manifests include React, React DOM, React Flow and TypeScript. Start with `npm run pmo:dev`. No new environment settings or model credentials are needed.
