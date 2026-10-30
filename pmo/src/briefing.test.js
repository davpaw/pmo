import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildBrief, guardrailsFor, preflightChecks, renderBriefMarkdown, semverAtLeast } from './briefing.js'
import { classifyBranch } from './isolation.js'
import { indexPlan } from './plan.js'

const load = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../data/${name}`, import.meta.url)), 'utf8'))
const plan = load('plan.json')
const catalog = load('catalog.generated.json')
const project = load('project.json')
const guardrails = load('guardrails.json')
const index = indexPlan(plan)

// Briefs are tested against a fixed plan so they hold whatever the real plan says.
const fixtureStep = (id, overrides = {}) => ({
  id,
  title: `Fixture ${id}`,
  summary: 'Fixture step.',
  status: 'incomplete',
  modules: ['pmo', 'legacy-ui'],
  scope: { crossModuleReason: 'Fixture crosses modules.' },
  effort: { size: 'S' },
  risk: { level: 'low', notes: 'Fixture.' },
  value: { score: 3, why: 'Fixture.' },
  env: { ports: [5170] },
  tasks: ['Do the fixture work'],
  questions: [{ id: 'order', ask: 'Which first?', why: 'Fixture.', default: 'The smallest.', blocking: false }],
  acceptance: ['The fixture passes'],
  ...overrides
})
const fixturePlan = {
  workstreams: [{
    id: '9', title: 'Fixture workstream', epics: [{
      id: '9.1', title: 'Fixture epic', steps: [
        fixtureStep('9.1.1', { status: 'complete', evidence: ['package.json'], completedAt: '2026-01-01' }),
        fixtureStep('9.1.2', { dependsOn: ['9.1.1'] }),
        fixtureStep('9.1.3', { questions: [{ id: 'which', ask: 'Which store?', why: 'Fixture.', blocking: true }] }),
        fixtureStep('9.1.4', { dependsOn: ['9.1.2'] })
      ]
    }]
  }]
}
const fixtureIndex = indexPlan(fixturePlan)
const brief = (id, facts) => buildBrief({ index: fixtureIndex, id, catalog, project, guardrails, facts })

test('a brief carries everything an agent needs before starting', () => {
  const b = brief('9.1.2')
  assert.equal(b.ok, true)
  assert.equal(b.status, 'incomplete')
  assert.ok(b.metrics.effort && b.metrics.risk && b.metrics.value, 'decision data')
  assert.ok(b.git.commands.some((c) => c.startsWith('git switch -c step/9.1.2-')))
  assert.equal(classifyBranch(b.git.branch, project).stepId, '9.1.2', 'branch name satisfies the branching rule')
  assert.ok(b.scope.allow.includes('pmo/**'), 'the pmo module owns pmo/**')
  assert.ok(b.scope.allow.includes('src/*.js'), 'the legacy-ui module owns src/*.js')
  assert.ok(b.acceptance.length > 0 && b.tasks.length > 0)
  assert.ok(b.guardrails.length > 0)
  assert.ok(b.verification.some((v) => v.command === project.tests.root))
  assert.ok(b.env.ports.includes(5170))
  assert.ok(b.verification.some((v) => v.label === 'validator: unit-tests'))
})

test('blocking questions are separated from defaulted ones', () => {
  const b = brief('9.1.3')
  assert.ok(b.questions.some((q) => q.blocking))
  const text = renderBriefMarkdown(b)
  assert.match(text, /Blocking \(ask now, in one message\)/)
  const defaulted = brief('9.1.2')
  assert.equal(defaulted.questions.filter((q) => q.blocking).length, 0)
  assert.match(renderBriefMarkdown(defaulted), /No blocking questions/)
  assert.match(renderBriefMarkdown(defaulted), /default:/)
})

test('a blocked step reports why it cannot start', () => {
  const b = brief('9.1.4')
  assert.equal(b.canStart.ok, false)
  assert.match(b.canStart.reasons.join(' '), /waiting on 9\.1\.2/)
})

test('a complete or unknown step has no start path', () => {
  assert.equal(brief('9.1.1').canStart.ok, false)
  assert.equal(brief('9.9.9').ok, false)
})

test('live facts add blocking and warning checks', () => {
  const facts = { git: { clean: false, claims: ['step/9.1.2-other'], behind: 2 }, env: { node: '18.0.0', nodeModules: false, portsInUse: [5170] } }
  const b = brief('9.1.2', facts)
  const failing = b.preflight.filter((c) => !c.ok)
  assert.deepEqual(failing.map((c) => c.id).sort(), ['base-current', 'dependencies', 'node', 'not-claimed', 'ports', 'tree-clean'])
  assert.equal(b.canStart.ok, false)
  const warnOnly = preflightChecks({ step: { status: 'incomplete' }, ready: { blockers: [], unknown: [] }, project, facts: { env: { node: '24.0.0', nodeModules: true, portsInUse: [5170] } }, ports: [5170] })
  assert.equal(warnOnly.filter((c) => !c.ok && c.severity === 'block').length, 0)
})

test('guardrails are selected by module, kind and tag', () => {
  const all = guardrailsFor(guardrails, [{ id: 'x', kind: 'shared' }], [])
  assert.ok(all.every((g) => g.appliesTo.includes('all') || g.appliesTo.some((a) => a.startsWith('kind:') || a.startsWith('module:') || a.startsWith('tag:'))))
  const privacy = guardrailsFor(guardrails, [{ id: 'x', kind: 'shared' }], ['privacy'])
  assert.ok(privacy.length >= all.length)
})

test('semver comparison used by the Node check', () => {
  assert.equal(semverAtLeast('24.16.0', '20.19.0'), true)
  assert.equal(semverAtLeast('20.18.9', '20.19.0'), false)
  assert.equal(semverAtLeast('20.19.0', '20.19.0'), true)
})

test('every open step can be briefed without error', () => {
  for (const [id, entry] of index.steps) {
    if (entry.step.status === 'complete') continue
    const b = buildBrief({ index, id, catalog, project, guardrails })
    assert.equal(b.ok, true, id)
    assert.ok(renderBriefMarkdown(b).includes(`# Step ${id}:`), id)
  }
})

test('a brief lists the recorded gaps of the modules the step touches, with the step or the reason for each', () => {
  const gapped = { ...catalog, modules: catalog.modules.map((m) => (m.id === 'pmo'
    ? { ...m, gaps: [{ text: 'Planned thing.', step: '9.9.9' }, { text: 'Left alone.', outOfScope: { reason: 'Not wanted.', owner: 'product owner' } }] }
    : m.id === 'tenancy' ? { ...m, gaps: ['Not shown.'] } : m)) }
  const b = buildBrief({ index: fixtureIndex, id: '9.1.2', catalog: gapped, project, guardrails })
  assert.deepEqual(b.openGaps.map((item) => item.moduleId).sort(), ['legacy-ui', 'pmo'])
  const text = renderBriefMarkdown(b)
  assert.match(text, /## Open gaps in these modules/)
  assert.match(text, /Planned thing\. -> step 9\.9\.9/)
  assert.match(text, /Left alone\. -> out of scope \(product owner: Not wanted\.\)/)
  assert.match(text, /7k\+ lines/, 'string gaps are shown too')
  assert.doesNotMatch(text, /Not shown/)
})
