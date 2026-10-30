import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  checkChangedFiles, checkCommitMessage, checkImports, checkPlanIntegrity, checkReadyForPr, classifyBranch, globToRegExp, ownerOf, scopeFor,
} from './isolation.js'

const project = JSON.parse(readFileSync(fileURLToPath(new URL('../data/project.json', import.meta.url)), 'utf8'))
const step = (overrides = {}) => ({ id: '2.3.1', modules: ['alpha'], status: 'incomplete', ...overrides })
const branch = { kind: 'step', ok: true, stepId: '2.3.1' }
const modules = {
  alpha: { owns: ['server/modules/alpha/**'], dependsOn: ['beta'], entry: 'server/modules/beta/index.js' },
  beta: { owns: ['server/modules/beta/**'], dependsOn: [], entry: 'server/modules/beta/index.js' },
  gamma: { owns: ['server/modules/gamma/**'], dependsOn: [] },
  'legacy-store': { owns: ['server/store.js'], dependsOn: [] },
  pmo: { owns: ['pmo/**'], dependsOn: [] },
  'legacy-ui': { owns: ['src/*.js', 'src/views/**', 'index.html'], dependsOn: [] },
}

test('branch names: step, plan, release, protected main and everything else', () => {
  assert.deepEqual(classifyBranch('step/2.3.1-split-main', project), { kind: 'step', ok: true, stepId: '2.3.1', slug: 'split-main' })
  assert.equal(classifyBranch('plan/add-steps', project).kind, 'plan')
  assert.equal(classifyBranch('release/v1', project).kind, 'release')
  assert.equal(classifyBranch('main', project).ok, false)
  const other = classifyBranch('feature/whatever', project)
  assert.equal(other.ok, false)
  assert.match(other.reason, /pmo -- start/)
  assert.equal(classifyBranch('step/2.3-no-patch', project).ok, false)
})

test('commit subjects carry the step id of the branch', () => {
  assert.deepEqual(checkCommitMessage('[2.3.1] Convert one section', branch, project), [])
  assert.match(checkCommitMessage('fix things', branch, project)[0], /must start with "\[2\.3\.1\] "/)
  assert.match(checkCommitMessage('[2.3.2] other step', branch, project)[0], /One step per branch/)
  assert.deepEqual(checkCommitMessage('Merge branch main', branch, project), [])
  assert.deepEqual(checkCommitMessage('plan: add step', { kind: 'plan' }, project), [])
  assert.equal(checkCommitMessage('add step', { kind: 'plan' }, project).length, 1)
})

test('glob matching: ** crosses folders, * does not', () => {
  assert.equal(globToRegExp('server/modules/a/**').test('server/modules/a/src/x/y.js'), true)
  assert.equal(globToRegExp('src/*.js').test('src/main.js'), true)
  assert.equal(globToRegExp('src/*.js').test('src/contracts/a.js'), false)
  assert.equal(globToRegExp('**/dist/**').test('pmo/x/dist/a.js'), true)
})

test('a step may change its own modules, declared extras and the plan, nothing else', () => {
  const s = step({ scope: { extra: ['tests/smoke/**'] } })
  const files = ['server/modules/alpha/a.js', 'tests/smoke/a.test.js', 'pmo/data/plan.json', 'server/modules/beta/b.js']
  const violations = checkChangedFiles(files, branch, s, project, modules)
  assert.deepEqual(violations.map((v) => [v.file, v.rule]), [['server/modules/beta/b.js', 'out-of-scope']])
})

test('a module may own several globs, and a step with no matching module owns nothing', () => {
  const s = step({ modules: ['legacy-ui'] })
  assert.deepEqual(checkChangedFiles(['src/views/a.js', 'index.html'], branch, s, project, modules), [])
  assert.equal(checkChangedFiles(['server/modules/alpha/a.js'], branch, s, project, modules).length, 1)
  assert.equal(checkChangedFiles(['server/modules/alpha/a.js'], branch, step({ modules: ['unknown'] }), project, modules).length, 1)
  assert.equal(ownerOf('src/main.js', modules), 'legacy-ui')
  assert.equal(ownerOf('docs/x.md', modules), null)
})

test('frozen paths need the owning module; a declared extra does not lift them', () => {
  const store = 'server/store.js'
  assert.deepEqual(checkChangedFiles([store], branch, step({ modules: ['legacy-store'] }), project, modules), [])
  const viaExtra = checkChangedFiles([store], branch, step({ modules: ['alpha'], scope: { extra: [store] } }), project, modules)
  assert.equal(viaExtra[0].rule, 'frozen')
  assert.match(viaExtra[0].reason, /Legacy monolith/)
  assert.equal(checkChangedFiles(['src/main.js'], branch, step({ modules: ['alpha'] }), project, modules)[0].rule, 'frozen')
  assert.deepEqual(checkChangedFiles(['src/main.js'], branch, step({ modules: ['legacy-ui'] }), project, modules), [])
  assert.equal(checkChangedFiles(['pmo/src/agent/instructions.js'], branch, step({ modules: ['alpha'], scope: { extra: ['pmo/**'] } }), project, modules)[0].rule, 'frozen')
  assert.deepEqual(checkChangedFiles(['pmo/src/agent/instructions.js'], branch, step({ modules: ['pmo'] }), project, modules), [])
  assert.equal(checkChangedFiles(['.env'], branch, step({ scope: { extra: ['.env'] } }), project, modules)[0].rule, 'frozen')
  assert.equal(checkChangedFiles(['.env'], { kind: 'release', ok: true }, null, project, modules)[0].rule, 'frozen')
})

test('plan branches may change PMO data and docs only; release branches versions only', () => {
  const plan = { kind: 'plan', ok: true }
  assert.deepEqual(checkChangedFiles(['pmo/data/plan.json', 'docs/X.md'], plan, null, project, modules), [])
  assert.equal(checkChangedFiles(['server/modules/alpha/a.js'], plan, null, project, modules).length, 1)
  assert.equal(checkChangedFiles(['pmo/src/cli.js'], plan, null, project, modules).length, 1)
  const release = { kind: 'release', ok: true }
  assert.deepEqual(checkChangedFiles(['package.json', 'package-lock.json'], release, null, project, modules), [])
  assert.equal(checkChangedFiles(['server/modules/alpha/a.js'], release, null, project, modules).length, 1)
  assert.deepEqual(scopeFor({ kind: 'other' }, null, project).allow, [])
})

test('imports: undeclared dependencies, deep imports and escapes are caught on added lines only', () => {
  const run = (file, text) => checkImports([{ file, text }], modules, project)
  assert.deepEqual(run('server/modules/alpha/a.js', "import b from './b.js'"), [], 'same module')
  assert.deepEqual(run('server/modules/alpha/a.js', "import { x } from '../beta/index.js'"), [], 'declared dependency through its entry')
  assert.equal(run('server/modules/alpha/a.js', "import { x } from '../beta/internal.js'")[0].rule, 'deep-import')
  assert.equal(run('server/modules/alpha/a.js', "import { x } from '../gamma/index.js'")[0].rule, 'undeclared-dependency')
  assert.match(run('server/modules/alpha/a.js', "import { x } from '../gamma/index.js'")[0].reason, /dependsOn|alpha\.dependsOn/)
  assert.deepEqual(run('server/modules/alpha/a.js', "import c from '../../contracts/x.js'"), [], 'shared contracts are open to everyone')
  assert.deepEqual(run('server/modules/alpha/a.js', "import pg from 'pg'"), [], 'packages are not module imports')
  assert.equal(run('server/modules/alpha/a.js', "import c from '../../../../../etc/x.js'")[0].rule, 'escapes-repo')
  assert.deepEqual(run('server/old.js', "import x from './store.js'"), [], 'unowned legacy files are not checked')
  assert.deepEqual(run('tests/a.test.js', "import x from '../server/modules/gamma/index.js'"), [], 'tests are exempt')
  assert.deepEqual(run('server/modules/alpha/a.txt', "import x from '../gamma/index.js'"), [], 'only code files')
})

const planOf = (steps) => ({ workstreams: [{ id: '1', title: 'W', summary: 's', epics: [{ id: '1.1', title: 'E', summary: 's', steps }] }] })
const s1 = { id: '1.1.1', title: 'A', summary: 's', status: 'incomplete', modules: ['alpha'], acceptance: ['a'] }
const s2 = { id: '1.1.2', title: 'B', summary: 's', status: 'incomplete', modules: ['alpha'], acceptance: ['b'] }

test('plan integrity: only the active step completes on a step branch', () => {
  const base = planOf([s1, s2])
  const own = { kind: 'step', stepId: '1.1.1' }
  assert.deepEqual(checkPlanIntegrity(base, planOf([{ ...s1, status: 'complete', evidence: ['x'], completedAt: '2026-10-20' }, s2]), own), [])
  assert.match(checkPlanIntegrity(base, planOf([s1, { ...s2, title: 'changed' }]), own)[0], /1\.1\.2 changed/)
  assert.match(checkPlanIntegrity(base, planOf([{ ...s1, acceptance: ['weaker'] }, s2]), own)[0], /Re-scoping needs a plan/)
  assert.match(checkPlanIntegrity(base, planOf([s1]), own)[0], /removed/)
  assert.match(checkPlanIntegrity(base, planOf([s1, s2, { ...s2, id: '1.1.3' }]), own)[0], /added/)
  assert.deepEqual(checkPlanIntegrity(base, planOf([s1]), { kind: 'plan' }), [])
})

test('ready for pull request: complete, evidenced and dated', () => {
  const ctx = { pathExists: (p) => p === 'real.js' }
  assert.equal(checkReadyForPr({ id: '1.1.1', status: 'incomplete' }, ctx).length, 3)
  assert.deepEqual(checkReadyForPr({ id: '1.1.1', status: 'complete', evidence: ['real.js'], completedAt: '2026-10-20' }, ctx), [])
  assert.match(checkReadyForPr({ id: '1.1.1', status: 'complete', evidence: ['gone.js'], completedAt: '2026-10-20' }, ctx)[0], /not found/)
})
