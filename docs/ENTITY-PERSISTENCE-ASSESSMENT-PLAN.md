# Persistence inspector and relative change assessment — proposal

2026-11-08. Plan only; awaiting review/merge. Generic PMO product requirements;
no host schemas, private metadata, source implementation, deployment or field
addition. Source baseline is configured origin/main after structured authority
step 4.2.7. Follow the existing Entities versioned metadata/client/reader/inspector
and server-owned Agent context rather than introducing a competing widget system.

## Product workflow

Product owner selects any entity variant, opens **Persistence**, sees known and
unknown structure/provenance, and uses **Assess change** to compare a proposed
field against scoped evidence. Discovery and relative assessment are provider-free.
Every entity supports the panel, including explicit not-recorded/unsupported states.
Arbitrary freeform Agent questions explain tradeoffs through the existing provider,
not a field-keyword menu. Findings are recommendations, never approved schema work.

## Contract and source safety

Extend the existing closed versioned contract with bounded persistence and impact
descriptors. Negotiate compatibility/version explicitly; preserve old snapshots,
dated static mode and fail-closed stale/conflicting behavior. Distinguish physical
DDL/migrations, serialized payload contracts, validated logical types, imports,
demo shapes, customer declarations and deployment-unverified evidence. SQL columns
cannot establish fields inside serialized values; types do not establish persistence.
Each relationship/field/index/constraint/migration/consumer carries reviewed source
identity, owner, completeness and confidence; unresolved mapping remains unknown.

The current reader permits JS/TS/JSON evidence paths, not SQL. Any SQL support needs
explicit upstream safe-path/reader/version design and finite bounds; never loosen
the path allowlist incidentally in a host. Supported literal embedded DDL or reviewed
descriptors with drift tests are acceptable; dynamic/runtime state stays unknown.
No source evaluation, arbitrary paths, database/record reads, values/examples/
defaults, credentials, secret URLs, schema writes or executable host plugins.
Preserve loopback/Host/Origin, worker/time/file/byte bounds, no symlinks/ignored
outputs/secrets and value-free errors. Host producers own business extraction.

## Inspector and assessment

Reuse selected-context provenance and accessible tables. Show backend/resource,
payload location, migration/version, fields/nullability/constraints/indexes/keys,
relationships and cited source scope. Compare explicitly selected variants.
Assess change accepts field/type/optionality/purpose metadata, not personal values.
Return current/proposed distinction, blast-radius dependency table, alternatives,
assumptions, confidence, unknowns and review-only draft plan handoff. No new writer.

Rubric version: value 1–5 with beneficiary/workflow evidence; effort XS/S/M/L/XL
with affected artifacts/owners and migration/verification basis; risk low/medium/high
with likelihood/consequence/mitigations. Unknown is allowed, not zero. Do not invent
money, hours, deadlines, production row counts or precise probabilities; do not
compress three dimensions into an approval score. Fact confidence and estimate
confidence are separate. Recompute on changed evidence/assumptions.

Checklist: ownership, migration/backfill/nullability/indexes/constraints/relationships,
APIs/imports/readers/writers/UI/reports/policies/events/audit, institutional memory,
retention/consent/purpose/access, customer extensions, deployment ordering/rollback,
tests and onboarding. Distinguish observed/reviewed dependencies from hypotheses;
unverified consumers and deployment versions remain explicit unknowns.

## Safe arbitrary Agent explanations

Extend 4.2.7's closed server-grounded authority, never restore unrestricted prose.
Facts select supplied ids and resolve server-side. Bounded typed recommendation
sections may express alternatives, rubric basis and assumptions as planning advice;
validate citations, reject fabricated/global production authority and extra/private
keys, and prevent unsafe retained-history reuse. Citation membership is not semantic
entailment. Resolve ambiguous variants, pin delayed answers and exclude PII/canaries
before provider transmission. No provider required for local exploration/scoring.

Optional personal profile attributes are a regression scenario, not a delivered
business feature: voluntary self-description, no inferred gender, coercive requiredness
or forced binary enumeration, no automatic backfill/record access. Privacy/legal
policy is host-owned; do not assume HIPAA or other applicability from a field name.

## Proposed steps

- 4.2.8: versioned persistence/impact contract and bounded evidence reader, after
  4.2.7. Public standalone fixtures and compatibility/coverage/privacy regressions.
- 4.2.9: Persistence/Assess change inspector and provider-free rubric/plan handoff,
  after 4.2.8. Keyboard/table/mobile/reduced-motion and source/unknown tests.
- 4.2.10: arbitrary freeform structured assessment explanation and safety protocol,
  after 4.2.9. Fake-provider adversarial/history/pinning/unknown regressions, full CI.

All source implementation uses upstream owning step branches after plan approval.
Consumers import only merged mapped source bytes with current-content receipts;
no host plans/business data/credentials/caches are exported. No new provider/key/
port; preserve existing setup and credential rotation references. New descriptors
need host onboarding review. Actual new-control screen-reader release evidence
must be obtained honestly; automated DOM/ARIA does not replace it.

Plan proposal must be pushed, have its own PR and PMO checks/finish. Neither this
proposal nor a host request authorizes its merge without explicit current approval.