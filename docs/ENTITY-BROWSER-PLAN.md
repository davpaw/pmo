# Entity metadata browser and grounded PMO Agent — product plan

Planning only: 4.2.2 adds a reusable Entities tab following Logical architecture; 4.2.3 adds selected-entity and freeform schema questions. No implementation, deployment or automatic merge is authorized.

## Contract and browser (4.2.2)

Hosts supply validated public descriptors, not business source or datasets. Include stable ids/aliases, scoped schema variants, defining package, business steward, consumers/workspaces, supply/source system, fields/types/requiredness/nullability/constraints/keys, relationships/cardinality and privacy. Unknown stays unknown. Field/relationship evidence identifies repository-relative path/line/symbol, immutable source identity, schema version if recorded, generation time and coverage. Distinguish logical declarations, import contracts, validated schemas/types, demo shapes and unverified deployment declarations. A complete schema needs evidence of completeness and scope; an empty observation is not proof of absence.

Bounded static extraction or reviewed descriptors must never evaluate/import application code or read rows. Reject unknown properties, unsafe paths/ids, invalid references, secrets/private text, record/example/default values and excessive sizes. Overrides may enrich descriptions or declare separate variants with owner/base/version/provenance; never silently replace fields/owners or erase conflicts. Warn on stale bases and unsupported extensions.

Apply local server-configured root/allowlists, loopback/Host/Origin checks, symlink/ignored/secret/build-output exclusions, no shell/evaluation, finite bytes/files/entities/fields/time and coalesced refresh. Preserve last valid snapshot on failure with stale/error labels; clear removed selection. Report unresolved/unsupported/skipped/truncated coverage. Static hosting may display a dated public snapshot but cannot scan source or claim production freshness.

Search entity/field names, filter owners/consumers/workspaces/evidence/supply, inspect fields and explicit relationships, and show source/version/privacy/conflicts. Provide relationship graph plus complete keyboard/screen-reader lists and tables, labelled controls, visible focus, live status/errors, responsive layout, reduced motion and no traps. Local show/open/refresh commands require no model or credential. Use each host's configured PMO ports, not fixed product ports.

## Grounded questions (4.2.3)

Keep server-owned history, immutable charter, bounded sessions and tool-free model. Client sends stable entity/field/relationship ids and snapshot identity only; server revalidates a bounded schema-only projection. No arbitrary file read, forged system context, root parameter, record-read or mutation tools. Show/clear selected context; pin source revisions and prevent delayed answers from silently switching entities. Resolve explicit freeform names, clarify ambiguous variants and handle stale/unconfigured contexts explicitly.

Answer field presence/absence only within an evidenced complete schema/version, with server-validated citations. Missing/stale/truncated metadata means unknown. Fixture properties do not prove production support; preferred name does not imply pronouns. Ownership/relationships cite declarations, not matching names. Unsupported model citations/claims are unverified. Treat descriptors as untrusted, escape output and exclude rows/examples/defaults/private text/secrets before provider transmission or logging.

Field-add requests produce text proposals covering source owner, affected variants/consumers/import/migration/onboarding/tests and privacy/consent, then the reviewed plan/step/PR workflow. They write no schema, metadata, plan or record and do not duplicate plan-editor functionality. Record-value questions are unavailable here. Local browser commands still work without provider setup; freeform questions reuse the existing provider configuration.

## Sequence and verification

4.2.2 follows delivered 4.2.1; 4.2.3 follows 4.2.2. General snapshot-lineage step 1.1.4 is related, not duplicated or declared complete. Host integration waits for merged product implementation PRs and records content-bound receipts, not just a merged plan PR. Never export host plans, domain schemas, credentials, caches or datasets into upstream fixtures.

Generic offline fixtures cover complete absent-field schema, positive optional-field variant, logical-only entity, partial/unsupported scan, stale revision, conflicting variants/overrides, unknown cardinality, path/symlink/foreign-origin attacks, malicious descriptor prose and synthetic row/secret canaries. Assert absent/unknown distinction, valid citations, safe projection before model calls, selection isolation, scanner/context bounds and model-free commands. Run standalone tests/build/fresh validation/scope checks and record keyboard/screen-reader smoke evidence in implementation PRs. No live-tenant introspection or schema changes are included.