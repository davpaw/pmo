# Guardrails

Rules every step must respect. Cite the id in a pull request.

Enforcement kinds: `test`, `validator`, `hook`, `ci`, `manual`. `manual` means a person checks it today; a note says which step promotes it to a test. Severity is `must` or `should`.

## Project management

### G-012 Contracts first
- **Severity:** should
- **Applies to:** all
- **Rule:** Shared schemas live under server/contracts with tests before the feature that uses them. A module's public surface is its entry file.

### G-013 One step per branch
- **Severity:** must
- **Applies to:** all
- **Enforcement:** hook (`.githooks/pre-commit`)
- **Rule:** Work happens on `step/<id>-<slug>`, plan changes on `plan/<slug>`. Only the active step changes status, evidence, completedAt and notes. The PMO check enforces scope, imports, plan integrity and commit format.

### G-014 Finish by updating the PMO
- **Severity:** must
- **Applies to:** all
- **Rule:** Before reporting a task done, set the step's status, evidence and completedAt, or add the follow-up on a plan branch, then run `npm run pmo -- check`. Work with no step is not finished until one exists.

### G-017 Additive, reversible migrations
- **Severity:** should
- **Applies to:** all
- **Rule:** Schema changes are versioned migrations that add before they remove, are safe to re-run, and have a documented way back. Destructive changes need their own step and a backup note.

## AI and agent use

### G-004 Agents propose, never execute
- **Severity:** must
- **Applies to:** all
- **Enforcement:** test (`pmo/src/agent/agent.test.js`)
- **Rule:** Agents and the assistant hold read tools and propose tools only. A write they want is a proposal shown to a person; it runs only when that person confirms, as that person, through the same server function and rules as the UI, once and within a short expiry. No agent holds a credential or an execute tool, and no tool reads or sets a credential. Autonomy defaults to recommend-only.

### G-006 Untrusted text is data
- **Severity:** must
- **Applies to:** all
- **Enforcement:** test (`pmo/src/agent/agent.test.js`)
- **Rule:** Scraped sources, trend text, teammate input, replies and tool output are neutralised and fenced before they enter a prompt, and the prompt says they are data. No such text can reach a tool argument without schema validation.

### G-007 Models only through the gateway
- **Severity:** must
- **Applies to:** all
- **Rule:** The application holds no provider SDKs. Every model call goes through the model gateway, whose provider is configuration: a direct OpenAI-compatible API by default, or AIRouter when selected. Keys and tokens stay on the server, and every call has a timeout, a token cap and a per-org budget.

### G-009 Kill switch and rate caps
- **Severity:** must
- **Applies to:** all
- **Rule:** Every system has a pause-all control and per-account rate caps. A paused system takes no automated actions and agents keep proposing. Caps are enforced before the provider call.

### G-010 Disclosure and consent
- **Severity:** must
- **Applies to:** all
- **Rule:** AI-assisted actions carry a disclosure setting that is honoured where required. Outbound messages honour opt-outs, consent records and quiet hours before a send is queued.

### G-011 Simulated is labelled
- **Severity:** must
- **Applies to:** all
- **Rule:** Synthetic or simulated providers, metrics and tests are labelled as such wherever shown and are never summed with live data.

## Security

### G-005 Credentials stay on the server
- **Severity:** must
- **Applies to:** all
- **Rule:** Provider tokens, app secrets, API keys and AIRouter tokens are read on the server only, encrypted at rest, never sent to the browser, never logged, and never given a `VITE_` prefix. Each has a documented rotation path.

### G-008 Side effects are idempotent and audited
- **Severity:** must
- **Applies to:** all
- **Rule:** Every external send or credential change carries an idempotency key and writes an audit event with actor kind (human, agent or system), org, target and result. Retrying never double-posts.

### G-015 Safe rendering
- **Severity:** must
- **Applies to:** all
- **Rule:** Every value interpolated into HTML is escaped, preferably through the safe html template. New code must not add unescaped interpolations.

### G-016 Secrets are never committed
- **Severity:** must
- **Applies to:** all
- **Rule:** Secrets live in `.env.local` (git-ignored). Settings that are not secret are documented in `.env.example`. `.env` is never committed.
