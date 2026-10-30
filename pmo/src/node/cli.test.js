import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, loadData, parseArgs, run } from '../cli.js'
import { currentBranch, git } from './git.js'

const FIXTURE_MODULES = {
  alpha: { title: 'Alpha', summary: 's', kind: 'platform', maturity: 'prototype', owns: ['packages/alpha/**'], dependsOn: [], tags: [] },
  beta: { title: 'Beta', summary: 's', kind: 'platform', maturity: 'prototype', owns: ['packages/beta/**'], dependsOn: [], tags: [] },
}
const FIXTURE_CATALOG = { modules: Object.entries(FIXTURE_MODULES).map(([id, module]) => ({ id, ...module, exists: true, dependents: [] })) }
const DATA = fileURLToPath(new URL('../../data/', import.meta.url))

const step = (id, overrides = {}) => ({
  id, title: `Step ${id}`, summary: 's', status: 'incomplete', modules: ['alpha'],
  effort: { size: 'M' }, risk: { level: 'low', notes: 'n' }, value: { score: 3, why: 'w' }, acceptance: ['a'], ...overrides,
})
const fixturePlan = () => ({
  version: 1,
  workstreams: [{ id: '1', title: 'W', summary: 's', epics: [{ id: '1.1', title: 'E', summary: 's', steps: [
    { id: '1.1.1', title: 'Done', summary: 's', status: 'complete', modules: ['alpha'], evidence: ['packages/alpha/src/a.js'] },
    step('1.1.2', { dependsOn: ['1.1.1'] }),
    step('1.1.3', { dependsOn: ['1.1.2'] }),
  ] }] }],
})

const sandbox = () => {
  const root = mkdtempSync(join(tmpdir(), 'pmo-test-'))
  const sh = (...args) => git(root, args)
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  sh('init', '-q', '-b', 'main')
  sh('config', 'user.email', 'pmo@example.com')
  sh('config', 'user.name', 'pmo')
  sh('config', 'commit.gpgsign', 'false')
  for (const name of ['project.json', 'guardrails.json']) write(`pmo/data/${name}`, readFileSync(join(DATA, name), 'utf8'))
  write('pmo/data/plan.json', JSON.stringify(fixturePlan(), null, 2))
  write('pmo/data/catalog.generated.json', JSON.stringify(FIXTURE_CATALOG))
  write('pmo/data/modules.json', JSON.stringify({ version: 1, modules: FIXTURE_MODULES }))
  write('packages/alpha/package.json', '{"name":"@highered/alpha"}')
  write('packages/alpha/src/a.js', 'export const a = 1\n')
  write('packages/beta/package.json', '{"name":"@highered/beta"}')
  write('packages/beta/src/b.js', 'export const b = 1\n')
  mkdirSync(join(root, 'node_modules'))
  sh('add', '-A')
  sh('commit', '-q', '-m', 'init')
  const lines = []
  const errors = []
  const out = { log: (m) => lines.push(String(m)), error: (m) => errors.push(String(m)) }
  const pmo = (...argv) => run(argv, { root, out })
  const commit = (message) => { sh('add', '-A'); sh('commit', '-q', '-m', message) }
  return { root, sh, write, lines, errors, pmo, commit, text: () => [...lines, ...errors].join('\n'), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('flags parse with values only where declared', () => {
  const args = parseArgs(['check', '--for-pr', '--base', 'origin/main', '--branch=step/1.1.1-x'])
  assert.deepEqual(args.positional, ['check'])
  assert.deepEqual(args.flags, { 'for-pr': true, base: 'origin/main', branch: 'step/1.1.1-x' })
})

test('start refuses a blocked step, then creates the isolated branch for a ready one', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  assert.equal(await s.pmo('start', '1.1.3'), 1)
  assert.match(s.text(), /waiting on 1\.1\.2/)
  assert.equal(currentBranch(s.root), 'main')

  assert.equal(await s.pmo('start', '1.1.2', '--dry-run'), 0)
  assert.equal(currentBranch(s.root), 'main', 'dry run changes nothing')
  assert.match(s.text(), /git switch -c step\/1\.1\.2-step-1-1-2/)

  assert.equal(await s.pmo('start', '1.1.2'), 0)
  assert.equal(currentBranch(s.root), 'step/1.1.2-step-1-1-2')
})

test('start refuses a dirty tree and an already claimed step', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  s.write('packages/alpha/src/wip.js', 'export {}\n')
  assert.equal(await s.pmo('start', '1.1.2'), 1)
  assert.match(s.text(), /uncommitted changes/)
  s.commit('wip')
  s.sh('branch', 'step/1.1.2-someone-else')
  s.lines.length = 0
  s.errors.length = 0
  assert.equal(await s.pmo('start', '1.1.2'), 1)
  assert.match(s.text(), /already claimed by branch step\/1\.1\.2-someone-else/)
})

test('check passes inside scope and fails outside it, on commits and on imports', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  assert.equal(await s.pmo('start', '1.1.2'), 0)

  s.write('packages/alpha/src/a.js', 'export const a = 2\n')
  s.commit('[1.1.2] change alpha')
  s.errors.length = 0
  assert.equal(await s.pmo('check'), 0, s.text())

  s.write('packages/beta/src/b.js', 'export const b = 2\n')
  assert.equal(await s.pmo('check'), 1)
  assert.match(s.text(), /\[out-of-scope\] packages\/beta\/src\/b\.js/)
  s.sh('checkout', '--', 'packages/beta/src/b.js')

  s.write('packages/alpha/src/c.js', "import { b } from '../../beta/src/b.js'\n")
  s.errors.length = 0
  assert.equal(await s.pmo('check'), 1)
  assert.match(s.text(), /undeclared-dependency/)
  s.write('packages/alpha/src/c.js', 'export const c = 1\n')
  s.commit('not tagged')
  s.errors.length = 0
  assert.equal(await s.pmo('check'), 1)
  assert.match(s.text(), /\[commit\] Commit subject must start with "\[1\.1\.2\] "/)
})

test('check blocks main and unmanaged branch names', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  assert.equal(await s.pmo('check'), 1)
  assert.match(s.text(), /protected/)
  s.errors.length = 0
  assert.equal(await s.pmo('check', '--branch', 'feature/x'), 1)
  assert.match(s.text(), /does not match step/)
})

test('a step branch may only complete its own step, and --for-pr demands evidence', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  assert.equal(await s.pmo('start', '1.1.2'), 0)

  const edit = (mutate) => {
    const plan = JSON.parse(readFileSync(join(s.root, 'pmo/data/plan.json'), 'utf8'))
    mutate(plan.workstreams[0].epics[0].steps)
    s.write('pmo/data/plan.json', JSON.stringify(plan, null, 2))
  }
  edit((steps) => { steps[2].title = 'sneaky rename' })
  assert.equal(await s.pmo('check'), 1)
  assert.match(s.text(), /1\.1\.3 changed/)

  s.sh('checkout', '--', 'pmo/data/plan.json')
  s.errors.length = 0
  assert.equal(await s.pmo('check', '--for-pr'), 1)
  assert.match(s.text(), /Mark it complete with evidence/)

  edit((steps) => Object.assign(steps[1], { status: 'complete', evidence: ['packages/alpha/src/a.js'], completedAt: '2026-10-20' }))
  s.commit('[1.1.2] finish')
  s.errors.length = 0
  assert.equal(await s.pmo('check', '--for-pr'), 0, s.text())
})

test('commit-msg hook accepts a tagged subject and rejects others', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  assert.equal(await s.pmo('start', '1.1.2'), 0)
  s.write('../msg-ok', '[1.1.2] good subject\n')
  s.write('../msg-bad', 'no tag here\n')
  assert.equal(await s.pmo('hook', 'commit-msg', join(s.root, '../msg-ok')), 0)
  assert.equal(await s.pmo('hook', 'commit-msg', join(s.root, '../msg-bad')), 1)
  rmSync(join(s.root, '../msg-ok'))
  rmSync(join(s.root, '../msg-bad'))
})

test('pre-commit hook inspects staged files only', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  assert.equal(await s.pmo('start', '1.1.2'), 0)
  s.write('packages/beta/src/b.js', 'export const b = 3\n')
  assert.equal(await s.pmo('hook', 'pre-commit'), 0, 'unstaged changes are not judged')
  s.sh('add', 'packages/beta/src/b.js')
  assert.equal(await s.pmo('hook', 'pre-commit'), 1)
  const { problems } = evaluate({ root: s.root, data: loadData(s.root), branchName: currentBranch(s.root), staged: true, commits: false })
  assert.equal(problems[0].section, 'out-of-scope')
})

test('hooks install points git at .githooks', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  assert.equal(await s.pmo('hooks', 'install'), 0)
  assert.equal(s.sh('config', 'core.hooksPath'), '.githooks')
})

test('status, list, next and brief run against a minimal repository', async (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  assert.equal(await s.pmo('status'), 0)
  assert.match(s.text(), /1 complete/)
  assert.equal(await s.pmo('list', '--status', 'incomplete'), 0)
  assert.equal(await s.pmo('next'), 0)
  assert.match(s.text(), /1\.1\.2/)
  assert.equal(await s.pmo('brief', '1.1.2', '--no-facts'), 0)
  assert.match(s.text(), /# Step 1\.1\.2: Step 1\.1\.2/)
  assert.equal(await s.pmo('brief', '9.9.9'), 1)
})

test('start reads prerequisites from its actual base, never the current branch plan', async (t) => {
  const s = sandbox(); t.after(s.cleanup)
  s.sh('switch', '-c', 'plan/only-here')
  const plan = fixturePlan()
  Object.assign(plan.workstreams[0].epics[0].steps[1], { status: 'complete', evidence: ['packages/alpha/src/a.js'] })
  s.write('pmo/data/plan.json', JSON.stringify(plan)); s.commit('plan: local completion')
  assert.equal(await s.pmo('start', '1.1.3'), 1)
  assert.equal(currentBranch(s.root), 'plan/only-here')
  assert.match(s.text(), /waiting on 1.1.2/)
})

test('start resumes the owner with dirty work without checking out or discarding it', async (t) => {
  const s = sandbox(); t.after(s.cleanup)
  assert.equal(await s.pmo('start', '1.1.2'), 0)
  s.write('packages/alpha/src/a.js', 'export const a = 9')
  assert.equal(await s.pmo('start', '1.1.2'), 0)
  assert.match(s.text(), /Resuming/)
  assert.equal(readFileSync(join(s.root, 'packages/alpha/src/a.js'), 'utf8'), 'export const a = 9')
})

test('start fails closed when the remote refresh fails', async (t) => {
  const s = sandbox(); t.after(s.cleanup)
  s.sh('remote', 'add', 'origin', join(s.root, 'missing-remote'))
  assert.equal(await s.pmo('start', '1.1.2'), 1)
  assert.equal(currentBranch(s.root), 'main')
})

test('completed step branches are historical rather than active claims', async (t) => {
  const s = sandbox(); t.after(s.cleanup)
  const { claimsFor } = await import('./git.js')
  s.sh('branch', 'step/1.1.1-historical')
  assert.deepEqual(claimsFor(s.root, 'origin', '1.1.1'), [])
})
