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

## Executable scope, protocol and delivery checklist

This is an in-place expansion of plan PR24 aligned with HigherEd plan PR300,
not another proposal or an implementation receipt. Both remain review-only;
do not merge without explicit current approval. Generic source/tests/fixtures
belong here; all host business schemas, producer registrations and privacy
decisions remain in the host. No new host source exception is granted.

### 4.2.8 — contract and reader

Review and extend `pmo/src/entities.js`, entity/compat tests, existing node
entity scan/HTTP/worker modules and their tests. Preserve entity v1 unchanged;
design an optional separately versioned closed extension bound to entity/snapshot
identity. Finalize exact JSON keys, accepted versions, size/graph limits and
negotiation before consumer implementation. Old consumers show legacy metadata
with persistence unknown; unknown extension versions fail closed, never silently
ignored as current authority. Extension identity participates in context pinning.

Required sections: per-variant owner/steward/backend/public resource or logical
key pattern; separate physical-DDL/payload/logical/import/demo/customer layers;
per-layer coverage; field tri-state required/nullable, missing/null semantics,
constraints/keys/indexes/relationships; ordered source migration IDs and
serializer/reader/writer evidence; scoped source digest/range/revision/version,
freshness/extraction limitations; typed directional dependency edges; assessment
and rubric versions, proposal identity, assumptions, confidence and unknowns.
Production verification remains unknown. No tenant key, record/sample/default,
raw source, private URL or execution capability belongs in this format.

Keep path/origin/worker/file bounds. Embedded literal DDL is supported evidence
without needing arbitrary SQL paths; any new SQL support needs an explicit
upstream safe-reader contract, not a host workaround. Test old/new versions,
extra keys, physical-versus-serialized field absence, dynamic/partial/stale/
conflict/truncation, symlinks/private paths, forged hashes and value-free errors.

### 4.2.9 — deterministic graph, rubric and inspector

Reuse entity client, existing `pmo/src/entities/**` and `pmo/src/ui/**` patterns.
Record exact new helper/test filenames and discovery in the owning brief before
editing; no competing widget/plugin framework. Normalize metadata-only add/change/
remove/rename proposals and explicit variant IDs, purpose, optionality/nullability,
compatibility and alternatives. Freeze proposal/extension/snapshot identity.
Traverse reviewed directional references and declared consumers with stable sorting,
deduplication, cycle detection and bounded depth/edges/nodes. Return direct and
transitive paths with rule/evidence IDs. Entity-level consumers are review scope,
not proven field readers; hypotheses and unknown external consumers are separate.
Permuting input order must not change output; overflow cannot claim complete coverage.

Use transparent value 1/3/5 anchors (2/4 require rationale), effort XS–XL and risk
low/medium/high. Unknown has no numeric default. Each provisional category carries
rule version/IDs, cited facts or labelled stakeholder declarations, assumptions
and reason. Separate scoped fact authority from estimate confidence; no probabilities,
money/time/row counts without independent evidence. Critical unknown ownership/
privacy requires review. Recompute and invalidate on identity/assumption changes.

Persistence is one inspector action away for every entity, including unknown.
Assess change shows layer/variant differences, accessible dependency table, dimension
reasons, alternatives/no-change, unresolved owner questions and a metadata-only
reviewed-plan summary. No model request or writer is needed. Test graph cycles/order/
bounds, rubric branches/unknowns/recompute, proposal operations, zero provider calls,
keyboard/focus/errors/table semantics/mobile/reduced motion. Actual new-control
screen-reader release evidence remains mandatory and must be truthful.

### 4.2.10 — structured arbitrary Agent guidance

Extend `pmo/src/agent/entity-context.js`, its tests, service/prompt/history boundaries
and existing UI rendering/tests. Facts remain closed server-resolved selectors;
advice uses versioned bounded alternative/action/assumption/question/rubric-reference
sections with explicit unapproved labels. Valid citation membership never licenses
a model-supplied production/field-presence/rating assertion. Invalid advice is
withheld or asks clarification; never fall back to unrestricted prose. Preserve
bounded safe input before provider, revalidate old history before display/reuse,
pin snapshot/proposal/variant and label delayed answers to original context.

Fake-provider cases cover unrelated arbitrary fields, rename/removal and ambiguous
variants; forged global claims with valid citations, fabricated numeric costs,
extra keys/injection/PII/history, stale/delayed answers and useful safe alternatives.
Optional self-described profile attributes remain hypothesis-only fixtures:
no production Person claim, gender inference, forced binary/coercion or backfill.

### Per-step gates, commands and consumer receipts

Sequence remains `4.2.7 → 4.2.8 → 4.2.9 → 4.2.10`. On approved refreshed base,
run `npm run pmo -- brief <id>` and `npm run pmo -- start <id>` for each owner.
Every phase runs `npm test`, `npm run build`, `npm run pmo:validate`,
`npm run pmo -- check --for-pr` and exact-head required CI. New tests must be
discovered by existing scripts or an explicitly scoped test-discovery amendment.
Document manual screen-reader date/environment/exact build/announced text/focus
and failures; missing evidence blocks release, not an excuse for fabricated passes.

Before reporting ready, update only own completion/evidence after real verification,
commit/push/open owning PR, fetch and run upstream remote verification and finish.
Record immutable merged PR/commit/changed-path manifest for consumers; plan PR24
is not that receipt. HigherEd 6.1.51 verifies actual delivery, 6.1.52 owns finite
public business producer/onboarding, 6.1.53 imports minimum mapped source with
current SHA-256 receipts and semantic review, and 6.1.54 owns independent host
evaluation/new-control VoiceOver after existing 6.1.49/50 gates. Do not copy host
plans, source-lock data, records, credentials or caches upstream. Tool rollback
is a reviewed compatible source/binding revert or legacy fallback, not DB writes.

## Step summary

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
## Entity metadata generator (4.2.11)

`npm run pmo -- entities generate` writes the host binding `pmo/data/entities.json`; `--check` exits non-zero when the committed file is missing or out of date (for a hook or CI). The Entities scanner is unchanged and still reads only that file.

Configure the sources in `pmo/data/project.json`:

```json
{ "entitySources": ["apps/api/*.js", "packages/core/store.js"] }
```

Entries are exact repository-relative JS/TS paths or one-level `dir/*.ext` patterns (test files excluded). Every path must pass `safeEntityPath`; nothing is walked recursively. Files are read with the scanner's rules (no symlinks, no git-ignored files, 512 KiB per file, 200 files, 2 MiB aggregate, no evaluation). A skipped file is reported and counted.

Literal `CREATE TABLE [IF NOT EXISTS]` statements inside the source text become `schema`-class entities `table:<name>` with fields (type, requiredness, key, `unique(...)`), `many-to-one` relationships for `REFERENCES` between generated tables, and one evidence item (path, lines, whole-file SHA-256). Defaults and `CHECK` expressions are never copied. Coverage is `complete` only when the whole statement was read literally and no `ALTER TABLE` for that table appears in any configured source; interpolated names or columns, unparsable parts, duplicates, unresolvable references and rejected names become `partial`, `unresolved` or `skipped` and are never guessed. A `PRIMARY KEY` without `NOT NULL` keeps requiredness and nullability unknown. Physical columns say nothing about fields inside a serialized document column. Output is deterministic (stable order, no timestamps), so editing a configured source changes its evidence hash and `--check` fails until the file is regenerated.

## Live introspection decision (4.2.12)

Decided 2026-11-13 by the owner. This narrows the "no database reads" rule above for one case; it does not remove it.

- **Allowed environment:** local development only. A developer's own machine against a local or disposable store. Staging and production are not approved; each needs a later decision step. `introspect` refuses to run when `CI` is set, and a connection must name a loopback host or a local file.
- **Allowed content:** schema only: tables, columns, types, nullability, keys, foreign keys and indexes. No rows, counts, defaults, comments or values.
- **Credentials:** connection settings are named environment variables referenced from `project.json` by name, with secrets in `.env.local` (never `.env`, never plan or metadata). A dedicated read-only role is required for Postgres; SQLite opens read-only.
- **Trigger:** only an explicit host CLI command. The PMO server, browser and Agent never connect to a store and carry no database client.
- **Redis:** no schema exists, so only reviewed key-pattern declarations are recorded, marked declared and unverified; no `SCAN`, `KEYS` or value reads.
- **Provenance:** introspected facts say so (store kind, redacted label, time, catalog query identity); they never carry a source hash and are never presented as current deployment truth. A later source-DDL variant of the same table stays separate and disagreement is a visible conflict.
- **Still prohibited everywhere:** schema writes, row or value reads, production reach, executable host plugins.

Step 4.2.13 implements exactly this and must reject anything outside it.
