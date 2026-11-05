import { factsForStep, snapshotState } from './snapshot.js'
import { prResolved, prStatus, prStateFresh } from './pull-requests.js'
import { groupedClaims, repositoryFresh } from './repository-state.js'
/**
 * PMO views. Pure: each takes the loaded context and returns an html`` result.
 * Every value from a data file is interpolated through the auto-escaping
 * template, never concatenated.
 */

import { html } from './ui/index.js'
import { buildBrief, renderBriefMarkdown } from './briefing.js'
import { branchNameFor, decisionScore, nextSteps, rankOpenSteps, readiness, rollup, stepsForModule, transitiveDependents } from './plan.js'
import { isOpen } from './schema.js'

const STATUS_LABEL = { complete: 'Complete', in_progress: 'In progress', incomplete: 'Incomplete', roadmap: 'Roadmap' }
const STATUS_TONE = { complete: 'ok', in_progress: 'info', incomplete: 'warn', roadmap: 'neutral' }
const RISK_TONE = { low: 'ok', medium: 'warn', high: 'danger' }

export const NAV = [
  ['overview', 'Overview'],
  ['modules', 'Modules'],
  ['architecture', 'Logical architecture'],
  ['roadmap', 'Roadmap'],
  ['decisions', 'Decisions'],
  ['guardrails', 'Guardrails'],
  ['git', 'Git and rules'],
]

const chip = (tone, text) => html`<span class="chip chip-${tone}">${text}</span>`
const statusChip = (status) => chip(STATUS_TONE[status] ?? 'neutral', STATUS_LABEL[status] ?? status)
const riskChip = (risk) => (risk ? chip(RISK_TONE[risk.level] ?? 'neutral', risk.level) : '')
const stepLink = (id, title) => html`<a href="#/steps/${id}">${id}${title ? html` ${title}` : ''}</a>`
const moduleLink = (id) => html`<a href="#/modules/${id}">${id}</a>`
const moduleLinks = (ids) => (ids.length ? ids.map((id, i) => html`${i > 0 ? ', ' : ''}${moduleLink(id)}`) : html`<span class="muted">none</span>`)

const progress = (counts) => {
  const pct = (n) => (counts.total ? (n / counts.total) * 100 : 0)
  return html`<div class="progress" role="img" aria-label="${counts.complete} of ${counts.total} steps complete">
    <span class="progress-bar progress-complete" style="width:${pct(counts.complete)}%"></span>
    <span class="progress-bar progress-active" style="width:${pct(counts.in_progress + counts.incomplete)}%"></span>
    <span class="progress-bar progress-roadmap" style="width:${pct(counts.roadmap)}%"></span>
  </div>`
}

const countLine = (c) => html`${c.complete} complete, ${c.in_progress + c.incomplete} to finish, ${c.roadmap} roadmap`

const section = (title, body, extra = '') => html`<section class="panel"><h2>${title}</h2>${extra}${body}</section>`
const table = (head, rows, empty = 'Nothing to show.') =>
  rows.length
    ? html`<div class="table-wrap"><table><thead><tr>${head.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div>`
    : html`<p class="muted">${empty}</p>`

const includesText = (text, query) => !query || String(text).toLowerCase().includes(query.toLowerCase())

const select = (name, value, options, label) => html`<label class="field"><span>${label}</span>
  <select data-filter="${name}">${options.map(([v, l]) => html`<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`)}</select></label>`
const search = (name, value, label) => html`<label class="field"><span>${label}</span>
  <input type="search" data-filter="${name}" value="${value}" placeholder="Filter" /></label>`

// ---------------------------------------------------------------- overview
const overview = (ctx) => {
  const { index, catalog } = ctx
  const roll = rollup(index)
  const o = roll.overall
  const next = nextSteps(index, 5)
  const blockingQuestions = [...index.steps.values()].filter(({ step }) => isOpen(step) && (step.questions ?? []).some((q) => q.blocking))
  const manualRules = (ctx.guardrails.rules ?? []).filter((rule) => rule.enforcement?.kind === 'manual')
  return html`
    ${awaitingMergeQueue(ctx)}
    <div class="grid cards">
      <article class="card"><h3>Steps complete</h3><p class="big">${o.complete}<span class="muted"> / ${o.total}</span></p>${progress(o)}<p class="muted">${countLine(o)}</p></article>
      <article class="card"><h3>Remaining effort</h3><p class="big">${o.remainingPoints}<span class="muted"> pts</span></p><p class="muted">XS=1, S=2, M=3, L=5, XL=8 across open steps.</p></article>
      <article class="card"><h3>Modules built</h3><p class="big">${catalog.counts.built}<span class="muted"> / ${catalog.counts.modules}</span></p><p class="muted">${Object.entries(catalog.counts.byKind).map(([k, n]) => `${n} ${k}`).join(', ')}</p></article>
      <article class="card"><h3>Guardrails</h3><p class="big">${(ctx.guardrails.rules ?? []).length}</p><p class="muted">${manualRules.length} still checked by a person; the plan promotes them to tests.</p></article>
    </div>
    ${section('By workstream', html`<div class="ws-list">${roll.workstreams.map((ws) => html`
      <div class="ws-row"><div><strong>${ws.id}. ${ws.title}</strong><div class="muted">${countLine(ws.counts)}</div></div>${progress(ws.counts)}</div>
      <ul class="epic-list">${ws.epics.map((e) => html`<li><span class="epic-id">${e.id}</span> ${e.title}<span class="muted"> - ${countLine(e.counts)}</span></li>`)}</ul>`)}</div>`)}
    ${section('Do next (highest decision score, ready to start)', table(['Step', 'Status', 'Effort', 'Risk', 'Value', 'Score'], next.map((r) => html`<tr>
      <td>${stepLink(r.id, r.title)}</td><td>${statusChip(r.status)}</td><td>${r.effort?.size}</td><td>${riskChip(r.risk)}</td><td>${r.value?.score}/5</td><td>${r.score}</td></tr>`)),
      html`<p class="muted">Score = value x 10 / effort points, discounted by risk. See Decisions for the full ranked list including blocked work.</p>`)}
    ${section('Needs a human decision', blockingQuestions.length
      ? html`<ul>${blockingQuestions.map(({ id, step }) => html`<li>${stepLink(id, step.title)}: ${step.questions.filter((q) => q.blocking).map((q) => q.ask).join(' / ')}</li>`)}</ul>`
      : html`<p class="muted">No open step has a blocking question.</p>`)}
    ${section('Known gaps', html`<ul>
      <li>Modules declared but not built: ${catalog.modules.filter((m) => !m.exists).length} of ${catalog.modules.length}.</li>
      <li>Legacy modules still to retire: ${catalog.modules.filter((m) => m.kind === 'legacy').map((m) => m.id).join(', ') || 'none'}.</li>
      <li>Guardrails enforced manually: ${manualRules.map((rule) => rule.id).join(', ') || 'none'}.</li></ul>`)}`
}

// ----------------------------------------------------------------- modules
const modulesView = (ctx, ui) => {
  const { catalog, index } = ctx
  const kinds = ['all', ...new Set(catalog.modules.map((m) => m.kind))]
  const f = ui.modules
  const rows = catalog.modules
    .filter((m) => (f.kind === 'all' || m.kind === f.kind) && (includesText(`${m.id} ${m.title} ${m.summary}`, f.q)))
    .map((m) => {
      const steps = stepsForModule(index, m.id)
      const open = steps.filter(({ step }) => isOpen(step)).length
      return html`<tr>
        <td>${moduleLink(m.id)}<div class="muted">${m.title}</div></td><td>${m.kind}</td><td>${m.maturity ? chip('neutral', m.maturity) : ''}</td>
        <td>${m.exists ? chip('ok', 'built') : chip('warn', 'not built')}</td>
        <td>${steps.length - open} done, ${open} open</td></tr>`
    })
  return html`<div class="filters">${search('modules.q', f.q, 'Search modules')}${select('modules.kind', f.kind, kinds.map((k) => [k, k]), 'Kind')}</div>
    ${table(['Module', 'Kind', 'Maturity', 'State', 'Plan steps'], rows, 'No module matches.')}`
}

const moduleDetail = (ctx, id) => {
  const { catalog, index, live } = ctx
  const m = catalog.modules.find((x) => x.id === id)
  if (!m) return html`<p>Unknown module "${id}". <a href="#/modules">Back to modules</a></p>`
  const steps = stepsForModule(index, id)
  const git = live?.modules?.[id]
  return html`
    <p><a href="#/modules">All modules</a></p>
    <div class="panel">
      <h2>${m.title} <span class="muted">${m.id}</span></h2>
      <p>${m.summary}</p>
      <dl class="facts">
        <dt>Kind</dt><dd>${m.kind}</dd>
        <dt>Maturity</dt><dd>${m.maturity ?? 'n/a'} ${m.exists ? chip('ok', `${m.files} file(s)`) : chip('warn', 'not built yet')} ${m.hasTests ? chip('ok', 'has tests') : chip('warn', 'no tests')}</dd>
        <dt>Owns</dt><dd>${m.owns.length ? m.owns.map((glob, i) => html`${i > 0 ? ', ' : ''}<code>${glob}</code>`) : html`<span class="muted">nothing</span>`}</dd>
        <dt>Entry</dt><dd>${m.entry ? html`<code>${m.entry}</code>` : html`<span class="muted">none declared</span>`}</dd>
        <dt>May depend on</dt><dd>${moduleLinks(m.dependsOn ?? [])}</dd>
        <dt>Used by</dt><dd>${moduleLinks(m.dependents ?? [])}</dd>
        ${git?.last ? html`<dt>Last commit</dt><dd><code>${git.last.hash}</code> ${git.last.date} ${git.last.subject} <span class="muted">(${git.commits} commits touching the module)</span></dd>` : ''}
      </dl>
      ${m.gaps?.length ? html`<h3>Recorded gaps</h3><ul>${m.gaps.map((g) => html`<li>${g}</li>`)}</ul>` : ''}
      ${m.policies?.length ? html`<h3>Rules this module follows</h3><ul>${m.policies.map((p) => html`<li>${p}</li>`)}</ul>` : ''}
    </div>
    ${section(`Plan steps (${steps.length})`, table(['Step', 'Status', 'Effort', 'Value'], steps.map(({ id: sid, step }) => html`<tr>
      <td>${stepLink(sid, step.title)}</td><td>${statusChip(step.status)}</td><td>${step.effort?.size ?? ''}</td><td>${step.value ? `${step.value.score}/5` : ''}</td></tr>`), 'No step touches this module.'))}`
}

// ----------------------------------------------------------------- roadmap
const roadmapView = (ctx, ui) => {
  const { plan } = ctx
  const f = ui.roadmap
  const statusOptions = [['all', 'all'], ...Object.entries(STATUS_LABEL)]
  return html`<div class="filters">${select('roadmap.status', f.status, statusOptions, 'Status')}</div>
    ${plan.workstreams.map((ws) => html`<section class="panel"><h2>${ws.id}. ${ws.title}</h2><p class="muted">${ws.summary}</p>
      ${ws.epics.map((epic) => {
        const steps = epic.steps.filter((s) => f.status === 'all' || s.status === f.status)
        if (!steps.length) return ''
        return html`<h3>${epic.id} ${epic.title}</h3><p class="muted">${epic.summary}</p>
          <ul class="steps">${steps.map((s) => html`<li class="step-row"><span>${statusChip(s.status)}</span><span>${stepLink(s.id, s.title)}
            ${isOpen(s) ? html`<span class="muted"> ${s.effort?.size} effort, ${s.risk?.level} risk, value ${s.value?.score}/5${s.kind && s.kind !== 'build' ? `, ${s.kind}` : ''}</span>` : ''}</span></li>`)}</ul>`
      })}</section>`)}`
}

const prType = (pr) => pr.kind === 'delivery' ? 'Implementation delivery' : pr.kind === 'plan' ? 'Plan decision' : 'Other pull request'
const prCard = (ctx, pr) => html`<article><h4><a href="${pr.url}" target="_blank" rel="noreferrer">#${pr.number}: ${pr.title}</a></h4>
  <p>${prStatus(pr, ctx.index.pullRequests, ctx.index.prNow)} · ${prType(pr)} ${pr.stepId ? html`for ${stepLink(pr.stepId)}` : ''}</p>
  ${pr.blocks.map((block) => html`<p>${stepLink(block.id, block.title)}: ${block.reason}${block.proposed ? ' (proposed only; not approved scope)' : ''}${block.followUps.length ? `; follows ${block.followUps.join(', ')}` : ''}</p>`)}
</article>`

const awaitingMergeQueue = (ctx) => {
  const state = ctx.index.pullRequests
  const fresh = prStateFresh(state, ctx.index.prNow)
  const records = (state?.pullRequests || []).filter((pr) => pr.state === 'OPEN' || (pr.state === 'MERGED' && !pr.mergeVerified)).sort((a, b) => b.number - a.number)
  return html`<section class="panel" aria-label="Awaiting review / merge"><h2>Awaiting review / merge ${chip(fresh ? 'info' : 'warn', fresh ? records.length : `${records.length} last known`)}</h2>
    <p>${fresh ? `Checked ${state.checkedAt}.` : state ? `PR tracking is stale or unavailable. Last checked ${state.checkedAt}; refresh to verify the queue.` : 'PR tracking has not been synced. Refresh to load PRs awaiting review or merge.'} ${ctx.prMessage || ''}</p>
    <button type="button" data-pr-refresh>Refresh PR tracking</button>
    ${records.map((pr) => prCard(ctx, pr))}
    ${!records.length ? html`<p class="muted">${fresh ? 'No PRs are awaiting review or merge.' : 'Waiting PRs are unknown until tracking is refreshed.'}</p>` : ''}
  </section>`
}

const prTracking = (ctx, stepId = null) => {
  const state = ctx.index.pullRequests
  const records = (state?.pullRequests || []).filter((pr) => stepId ? pr.stepId === stepId || pr.blocks.some((b) => b.id === stepId) : pr.kind === 'plan' && pr.state !== 'OPEN' && pr.state !== 'MERGED' && !prResolved(pr, state, ctx.index.prNow))
  if (!stepId && !records.length) return ''
  return html`<section class="panel"><h3>${stepId ? 'Pull request delivery and prerequisites' : 'Unresolved closed PR decisions'}</h3>
    <p>${state ? `Checked ${state.checkedAt}.` : 'PR tracking has not been synced.'} ${ctx.prMessage || ''}</p>
    <button type="button" data-pr-refresh>Refresh PR tracking</button>
    ${records.map((pr) => prCard(ctx, pr))}
    ${!records.length ? html`<p class="muted">${state?.ok ? 'No matching PR delivery or prerequisites.' : 'Required PRs remain unresolved until sync can verify them.'}</p>` : ''}
  </section>`
}

// --------------------------------------------------------------- decisions
const decisionsView = (ctx, ui) => {
  const { index, plan } = ctx
  const f = ui.decisions
  const rows = rankOpenSteps(index, {
    includeBlocked: f.blocked === 'show',
    status: f.status === 'all' ? undefined : [f.status],
    workstream: f.workstream === 'all' ? undefined : f.workstream,
  })
  return html`${awaitingMergeQueue(ctx)}${prTracking(ctx)}<p class="muted">Open steps ranked by decision score: value x 10 / effort points, discounted by risk (low x1, medium x0.8, high x0.6). Ties break on how much work the step unblocks.</p>
    <div class="filters">
      ${select('decisions.status', f.status, [['all', 'all open'], ['incomplete', 'incomplete'], ['roadmap', 'roadmap'], ['in_progress', 'in progress']], 'Status')}
      ${select('decisions.workstream', f.workstream, [['all', 'all'], ...plan.workstreams.map((w) => [w.id, `${w.id}. ${w.title}`])], 'Workstream')}
      ${select('decisions.blocked', f.blocked, [['hide', 'ready only'], ['show', 'include blocked']], 'Blocked work')}
    </div>
    ${table(['Step', 'Status', 'Effort', 'Risk', 'Value', 'Score', 'Unblocks', 'Waiting on'], rows.map((r) => html`<tr>
      <td>${stepLink(r.id, r.title)}<div class="muted">${r.modules.join(', ')}</div></td><td>${statusChip(r.status)}</td><td>${r.effort?.size}</td>
      <td>${riskChip(r.risk)}</td><td>${r.value?.score}/5</td><td><strong>${r.score}</strong></td><td>${r.unblocks}</td>
      <td>${r.blockedBy.length ? r.blockedBy.map((b, i) => html`${i > 0 ? ', ' : ''}${b.url ? html`<a href="${b.url}">${b.id}: ${b.status}</a>` : html`<span>${b.id}: ${b.status}</span>`}`) : html`<span class="muted">prerequisites satisfied; preflight unknown</span>`}</td></tr>`), 'No open step matches.')}`
}

// -------------------------------------------------------------- step detail
const stepDetail = (ctx, id) => {
  const { index, catalog, project, guardrails } = ctx
  const entry = index.steps.get(id)
  if (!entry && index.pullRequests?.pullRequests.some((pr) => pr.blocks.some((b) => b.id === id && b.proposed))) return html`<h2>Proposed step ${id}</h2><p>This step is pending plan review and merge. It is not approved scope and cannot start.</p>${prTracking(ctx, id)}`
  if (!entry) return html`<p>Unknown step "${id}". <a href="#/roadmap">Back to the roadmap</a></p>`
  const { step } = entry
  const open = isOpen(step)
  const ready = readiness(index, id)
  const unblocks = transitiveDependents(index, id)
  const brief = open ? buildBrief({ index, id, catalog, project, guardrails, facts: factsForStep(ctx, id) }) : null
  const markdown = brief ? renderBriefMarkdown(brief) : ''
  return html`
    <p><a href="#/roadmap">Roadmap</a> / ${entry.workstream.id}. ${entry.workstream.title} / ${entry.epic.id} ${entry.epic.title}</p>
    ${prTracking(ctx, id)}
    <p class="muted" role="status">${snapshotState(ctx.live, ctx.plan, Date.now(), ctx.catalog).detail}</p>
    <div class="panel">
      <h2>${id} ${step.title} ${statusChip(step.status)}</h2>
      <p>${step.summary}</p>
      <dl class="facts">
        <dt>Kind</dt><dd>${step.kind ?? 'build'}</dd>
        <dt>Modules</dt><dd>${moduleLinks(step.modules ?? [])}</dd>
        ${open ? html`
          <dt>Effort</dt><dd>${step.effort.size}${step.effort.notes ? html` <span class="muted">${step.effort.notes}</span>` : ''}</dd>
          <dt>Risk</dt><dd>${riskChip(step.risk)} ${step.risk.notes}</dd>
          <dt>Value</dt><dd>${step.value.score}/5 ${step.value.why}</dd>
          <dt>Decision score</dt><dd>${decisionScore(step)}</dd>` : html`
          <dt>Completed</dt><dd>${step.completedAt ?? 'before the plan recorded dates'}</dd>
          <dt>Evidence</dt><dd><ul class="plain">${(step.evidence ?? []).map((e) => html`<li><code>${e}</code></li>`)}</ul></dd>`}
        <dt>Depends on</dt><dd>${(step.dependsOn ?? []).length ? step.dependsOn.map((d, i) => html`${i > 0 ? ', ' : ''}<a href="#/steps/${d}">${d}</a> (${STATUS_LABEL[index.steps.get(d)?.step.status] ?? 'unknown'})`) : html`<span class="muted">none</span>`}</dd>
        <dt>Unblocks</dt><dd>${unblocks.length ? unblocks.map((d, i) => html`${i > 0 ? ', ' : ''}<a href="#/steps/${d}">${d}</a>`) : html`<span class="muted">nothing</span>`}</dd>
        ${open ? html`<dt>Can start</dt><dd>${ready.ready ? chip('ok', 'yes') : chip('danger', 'blocked')} ${ready.blockers.map((b) => `${b.id} (${b.status})`).join(', ')}</dd>` : ''}
        ${step.externalDeps?.length ? html`<dt>External</dt><dd>${step.externalDeps.join(', ')}</dd>` : ''}
        ${step.notes ? html`<dt>Notes</dt><dd>${step.notes}</dd>` : ''}
      </dl>
      ${step.acceptance?.length ? html`<h3>Acceptance</h3><ul>${step.acceptance.map((a) => html`<li>${a}</li>`)}</ul>` : ''}
      ${step.questions?.length ? html`<h3>Questions before starting</h3><ul>${step.questions.map((q) => html`<li>${q.blocking ? chip('danger', 'blocking') : chip('neutral', 'default')} ${q.ask}
        <div class="muted">${q.why}${q.default ? ` Default: ${q.default}` : ''}</div></li>`)}</ul>` : ''}
    </div>
    ${open && brief?.ok ? html`<section class="panel"><h2>Agent brief</h2>
      <p>Tell an agent: <code>implement step ${id}</code>. It runs <code>npm run pmo -- brief ${id}</code>, which adds live git and environment checks to the text below.</p>
      <p>Branch: <code>${branchNameFor(id, step)}</code></p>
      <button type="button" class="button" data-copy="brief-text">Copy brief</button> <span class="muted" data-copy-status role="status"></span>
      <pre id="brief-text" class="brief">${markdown}</pre></section>` : ''}`
}

// -------------------------------------------------------------- guardrails
const guardrailsView = (ctx, ui) => {
  const { guardrails } = ctx
  const f = ui.guardrails
  const rules = guardrails.rules ?? guardrails
  const sourceOf = (r) => String(r.source ?? '')
  const docOf = (r) => sourceOf(r).split(';')[0].split(' §')[0].trim()
  const sources = ['all', ...new Set(rules.map(docOf).filter(Boolean))]
  const filtered = rules.filter((r) => (f.source === 'all' || docOf(r) === f.source) && includesText(`${r.id} ${r.title} ${r.rule}`, f.q))
  return html`<p class="muted">Rules distilled from docs/ and the repo memory. Enforcement says how a rule is checked: a test, a validator, a pre-commit or CI check, or review only.</p>
    <div class="filters">${search('guardrails.q', f.q, 'Search rules')}${select('guardrails.source', f.source, sources.map((s) => [s, s]), 'Source')}</div>
    ${table(['Rule', 'Severity', 'Applies to', 'Enforcement'], filtered.map((r) => html`<tr>
      <td><strong>${r.id}</strong> ${r.title}<div>${r.rule}</div><div class="muted">${sourceOf(r)}</div></td>
      <td>${chip(r.severity === 'must' ? 'danger' : 'warn', r.severity)}</td><td>${(r.appliesTo ?? []).join(', ')}</td>
      <td>${r.enforcement?.kind}${r.enforcement?.ref ? html`<div class="muted"><code>${r.enforcement.ref}</code></div>` : ''}</td></tr>`), 'No rule matches.')}`
}

// --------------------------------------------------------------------- git
const gitView = (ctx) => {
  const { project, live } = ctx
  const repository = ctx.repositoryState || live
  const claims = groupedClaims(repository, ctx.index)
  const fresh = repositoryFresh(repository, ctx.repositoryOnline, ctx.index.prNow)
  const checked = Number.isFinite(Date.parse(repository?.generatedAt)) ? new Date(repository.generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown'
  const claimTable = (rows, empty) => table(['Step', 'Approved status', 'Branch'], rows.map(row => html`<tr><td>${stepLink(row.id, row.title)}</td><td>${statusChip(row.status)}</td><td><ul class="claim-branches">${row.branches.map(name => html`<li><code>${name}</code></li>`)}</ul></td></tr>`), empty)
  return html`
    ${section('Branching', html`<ul>${project.branching.rules.map((r) => html`<li>${r}</li>`)}</ul>
      <dl class="facts"><dt>Main</dt><dd><code>${project.mainBranch}</code> on <code>${project.remote}</code> (${project.repository})</dd>
      <dt>Step branch</dt><dd><code>${project.branching.step}</code></dd><dt>Plan branch</dt><dd><code>${project.branching.plan}</code></dd><dt>Release branch</dt><dd><code>${project.branching.release}</code></dd></dl>`)}
    ${section('Commits', html`<p>Subject must start with the step id: <code>${project.commit.example}</code>. Plan branches use <code>plan: ...</code>, release branches <code>release: ...</code>.</p>`)}
    ${section('Isolation', html`<p>A step branch may change only the files owned by the modules the step lists, plus the plan file for its own step. Frozen paths:</p>
      <ul>${project.frozenPaths.map((p) => html`<li><code>${p.glob}</code> - ${p.reason}</li>`)}</ul>
      <p class="muted">Shared contracts under <code>${project.contractPaths.join(', ')}</code> change only when the step names them in its scope.</p>`)}
    ${section('Enforcement', html`<ul><li>Local: <code>npm run pmo -- hooks install</code> sets up pre-commit and commit-msg hooks.</li>
      <li>CI: the pmo-guard workflow re-runs the same checks on every pull request. Hooks can be bypassed; CI is the check of record.</li>
      <li>GitHub branch protection for main is a repository setting; verify required checks and reviews in the host repository.</li></ul>`)}
    ${section('Repository state', html`
      <p>The working-tree status below belongs to the local checkout serving this PMO. The approved plan and pull request delivery are tracked separately.</p>
      <p>${chip(fresh ? 'ok' : 'warn', fresh ? 'Checked locally' : 'Snapshot — freshness unverified')} ${ctx.repositoryMessage || ''}</p>
      <button type="button" data-repository-refresh>Refresh repository state</button>
      ${repository ? html`<dl class="facts repository-facts"><dt>Last checked</dt><dd><time datetime="${repository.generatedAt}" title="${repository.generatedAt}">${checked}</time>${fresh ? '' : html` <span class="muted">(saved snapshot; current state unverified)</span>`}</dd>
        <dt>Server checkout</dt><dd><code>${repository.branch}</code></dd>
        <dt>Checkout commit</dt><dd><code>${repository.head}</code></dd>
        <dt>Working tree</dt><dd>${repository.clean ? chip('ok', 'Clean') : chip('warn', 'Uncommitted local changes')}</dd>
        <dt>Locally cached main</dt><dd><code>${repository.mainRef || `${project.remote}/${project.mainBranch}`}</code>${repository.mainHead ? html` at <code>${repository.mainHead.slice(0, 12)}</code>` : ' — unavailable'}</dd>
        <dt>Checkout commits</dt><dd>${repository.totalCommits}</dd></dl>
        <h3>Claimed steps (${claims.active.length})</h3>
        ${claimTable(claims.active, 'No active claims in this snapshot.')}
        ${!fresh ? html`<p class="muted">Refresh locally to verify current claims.</p>` : ''}
        <details><summary>Inactive step branches (${claims.inactive.length} ${claims.inactive.length === 1 ? 'step' : 'steps'})</summary>${claimTable(claims.inactive, 'No inactive step branches in this snapshot.')}</details>
        ${claims.unknown.length ? html`<details><summary>Activity unknown (${claims.unknown.length} ${claims.unknown.length === 1 ? 'step' : 'steps'})</summary><p>These entries lack verified activity metadata; refresh locally to classify them.</p>${claimTable(claims.unknown, '')}</details>` : ''}`
      : html`<p class="muted">No repository snapshot is available. Run the local PMO to enable refresh, or generate a saved snapshot with <code>npm run pmo -- build --git</code>.</p>`}`)}`

}

export const DEFAULT_UI = () => ({
  modules: { q: '', kind: 'all' },
  roadmap: { status: 'all' },
  decisions: { status: 'all', workstream: 'all', blocked: 'hide' },
  guardrails: { q: '', source: 'all' },
})

/** @param {{ name: string, arg?: string }} route */
export const renderRoute = (route, ctx, ui) => {
  switch (route.name) {
    case 'architecture': return html`<div id="architecture-view" aria-label="Logical architecture"><h2>Logical architecture</h2><p>Loading the application diagram. Modules and dependencies appear first; select additional layers for services, persistence, integrations and security.</p></div>`
    case 'modules': return route.arg ? moduleDetail(ctx, route.arg) : modulesView(ctx, ui)
    case 'roadmap': return roadmapView(ctx, ui)
    case 'decisions': return decisionsView(ctx, ui)
    case 'steps': return stepDetail(ctx, route.arg)
    case 'guardrails': return guardrailsView(ctx, ui)
    case 'git': return gitView(ctx)
    default: return overview(ctx)
  }
}

export const parseRoute = (hash) => {
  const [name = 'overview', arg] = String(hash).replace(/^#\/?/, '').split('/')
  let decoded
  try { decoded = arg ? decodeURIComponent(arg) : undefined } catch { return { name: 'invalid' } }
  return { name: name || 'overview', arg: decoded }
}

export const pageTitle = (route) => (NAV.find(([key]) => key === route.name)?.[1] ?? (route.name === 'steps' ? `Step ${route.arg}` : 'Overview'))
