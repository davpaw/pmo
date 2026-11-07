import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PLAN_PATH, evaluate, loadData, run } from '../cli.js'
import { git } from './git.js'
import { moduleRelease } from './release.js'
import { buildLive } from './live.js'
import { nextVersion, releaseManifestProblems } from '../release-policy.js'
import { releaseFacts } from '../release-view.js'
import { html, toHtml } from '../ui/index.js'
import { DEFAULT_UI, parseRoute, renderRoute } from '../views.js'
import { indexPlan } from '../plan.js'

const sandbox = t => {
  const root = mkdtempSync(join(tmpdir(), 'pmo-release-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`) }
  const project = {
    name: 'Fixture', repository: 'example/fixture', remote: 'origin', mainBranch: 'main',
    branching: { protected: ['main'], step: '^step/(\\d+\\.\\d+\\.\\d+)-(.+)$', plan: '^plan/(.+)$', release: '^release/([a-z0-9.-]+)$' },
    commit: { exempt: '^Merge ', stepPrefix: '^\\[(\\d+\\.\\d+\\.\\d+)\\] ', planPrefix: '^plan: ', releasePrefix: '^release: ' },
    frozenPaths: [{ glob: 'package-lock.json', reason: 'Frozen lockfile' }], alwaysAllowedPaths: [], isolationExempt: ['packages/**'],
  }
  const module = { id: 'alpha', name: '@fixture/alpha', title: 'Alpha', path: 'packages/alpha', exists: true, owns: ['packages/alpha/**'], dependsOn: [], dependents: [], files: 2, hasTests: true }
  const plan = { version: 1, workstreams: [{ id: '1', title: 'W', summary: 's', epics: [{ id: '1.1', title: 'E', summary: 's', steps: [{ id: '1.1.1', title: 'S', summary: 's', status: 'roadmap', modules: ['alpha'], effort: { size: 'S' }, risk: { level: 'low', notes: 'n' }, value: { score: 3, why: 'w' }, acceptance: ['a'] }] }] }] }
  const dataPath = dirname(PLAN_PATH)
  put(PLAN_PATH, plan); put(`${dataPath}/project.json`, project)
  put(`${dataPath}/modules.json`, { modules: { alpha: module } })
  put(`${dataPath}/catalog.generated.json`, { modules: [module] })
  put(`${dataPath}/guardrails.json`, { rules: [] })
  // These are deliberately failing script traps. A successful release proves none ran.
  put('packages/alpha/package.json', { name: module.name, version: '1.2.3', scripts: { preversion: 'exit 91', version: 'exit 92', postversion: 'exit 93', release: 'exit 94', deploy: 'exit 95' } })
  put('packages/alpha/src/a.js', 'export const a = 1\n')
  git(root, ['init', '-b', 'main']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'user.name', 'Fixture'])
  git(root, ['add', '.']); git(root, ['commit', '-m', 'initial'])
  git(root, ['switch', '-c', 'release/alpha'])
  const messages = [], out = { log: s => messages.push(s), error: s => messages.push(s) }
  const invoke = argv => run(argv, { root, out })
  return { root, put, module, project, plan, messages, invoke }
}

test('stable version bumps reject downgrade, prerelease, malformed and overflow versions', () => {
  assert.equal(nextVersion('1.2.3'), '1.2.4')
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0')
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0')
  assert.equal(nextVersion('1.2.3', '1.10.0'), '1.10.0')
  for (const bad of ['1.2.3', '1.2.2', '1.0.9', '01.3.0', '2.0.0-beta', 'latest', '9007199254740992.0.0']) assert.throws(() => nextVersion('1.2.3', bad))
})

test('release dry-run preserves exact bytes, head, index and tags', async t => {
  const s = sandbox(t), head = git(s.root, ['rev-parse', 'HEAD']), original = readFileSync(join(s.root, 'packages/alpha/package.json'), 'utf8')
  assert.equal(await s.invoke(['release', 'alpha', '--dry-run']), 0, s.messages.join('\n'))
  assert.equal(readFileSync(join(s.root, 'packages/alpha/package.json'), 'utf8'), original)
  assert.equal(git(s.root, ['rev-parse', 'HEAD']), head)
  assert.equal(git(s.root, ['status', '--porcelain']), '')
  assert.equal(git(s.root, ['tag']), '')
})

test('release commits only package version and creates an annotated local module tag without lifecycle scripts', async t => {
  const s = sandbox(t)
  assert.equal(await s.invoke(['release', '@fixture/alpha']), 0, s.messages.join('\n'))
  assert.equal(JSON.parse(readFileSync(join(s.root, 'packages/alpha/package.json'))).version, '1.2.4')
  assert.equal(git(s.root, ['diff', '--name-only', 'HEAD~1', 'HEAD']), 'packages/alpha/package.json')
  assert.equal(git(s.root, ['cat-file', '-t', 'alpha@1.2.4']), 'tag')
  assert.equal(git(s.root, ['rev-parse', 'alpha@1.2.4^{commit}']), git(s.root, ['rev-parse', 'HEAD']))
  assert.equal(git(s.root, ['status', '--porcelain']), '')
  assert.equal(evaluate({ root: s.root, data: loadData(s.root), branchName: 'release/alpha' }).problems.length, 0)
})

test('release refuses main/step, dirty/staged work, unknown and virtual modules, invalid flags and duplicate tags before mutation', async t => {
  const s = sandbox(t), originalHead = git(s.root, ['rev-parse', 'HEAD'])
  git(s.root, ['switch', 'main'])
  assert.equal(await s.invoke(['release', 'alpha']), 1)
  git(s.root, ['switch', '-c', 'step/1.1.1-test'])
  assert.equal(await s.invoke(['release', 'alpha']), 1)
  git(s.root, ['switch', 'release/alpha'])
  for (const argv of [['release', 'unknown'], ['release', '../alpha'], ['release', 'alpha', '1.0.0'], ['release', 'alpha', '--publish'], ['release', 'alpha', '--base', 'HEAD']]) assert.equal(await s.invoke(argv), 1)
  git(s.root, ['tag', 'alpha@1.2.4'])
  assert.equal(await s.invoke(['release', 'alpha']), 1)
  s.put('unrelated.txt', 'preserve this work')
  assert.equal(await s.invoke(['release', 'alpha', 'minor']), 1)
  git(s.root, ['add', 'unrelated.txt'])
  assert.equal(await s.invoke(['release', 'alpha', 'minor']), 1)
  assert.equal(readFileSync(join(s.root, 'unrelated.txt'), 'utf8'), 'preserve this work')
  assert.equal(git(s.root, ['rev-parse', 'HEAD']), originalHead)
})

test('minor, major and explicit version releases produce increasing local versions', async t => {
  const s = sandbox(t)
  for (const [bump, version] of [['minor', '1.3.0'], ['major', '2.0.0'], ['2.10.0', '2.10.0']]) {
    assert.equal(await s.invoke(['release', 'alpha', bump]), 0, s.messages.join('\n'))
    assert.equal(JSON.parse(readFileSync(join(s.root, 'packages/alpha/package.json'))).version, version)
    assert.ok(git(s.root, ['tag', '--list', `alpha@${version}`]))
  }
})

test('virtual modules and manifests resolving outside the repository are refused', async t => {
  const s = sandbox(t), dataPath = dirname(PLAN_PATH)
  s.put(`${dataPath}/catalog.generated.json`, { modules: [{ ...s.module, path: 'virtual' }] })
  git(s.root, ['add', '.']); git(s.root, ['commit', '-m', 'release: fixture metadata'])
  assert.equal(await s.invoke(['release', 'alpha']), 1)
  const outside = mkdtempSync(join(tmpdir(), 'pmo-release-outside-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  writeFileSync(join(outside, 'package.json'), '{"name":"outside","version":"1.0.0"}')
  symlinkSync(outside, join(s.root, 'linked'))
  s.put(`${dataPath}/catalog.generated.json`, { modules: [{ ...s.module, path: 'linked' }] })
  git(s.root, ['add', '.']); git(s.root, ['commit', '-m', 'release: fixture metadata'])
  assert.equal(await s.invoke(['release', 'alpha']), 1)
  assert.equal(readFileSync(join(outside, 'package.json'), 'utf8'), '{"name":"outside","version":"1.0.0"}')
})

test('lockfile guard permits workspace version metadata but refuses dependency changes', () => {
  const before = { lockfileVersion: 3, packages: { 'packages/alpha': { version: '1.0.0' }, 'node_modules/external': { version: '1.0.0', integrity: 'fixture' } } }
  const after = structuredClone(before); after.packages['packages/alpha'].version = '1.0.1'
  const change = () => [{ file: 'package-lock.json', before: JSON.stringify(before), after: JSON.stringify(after) }]
  assert.deepEqual(releaseManifestProblems(change()), [])
  after.packages['node_modules/external'].version = '2.0.0'
  assert.equal(releaseManifestProblems(change()).length, 1)
})

test('guard rejects committed or staged release scripts, dependencies, source and manifest additions/deletions', async t => {
  const s = sandbox(t), original = JSON.parse(readFileSync(join(s.root, 'packages/alpha/package.json')))
  for (const manifest of [{ ...original, version: '1.2.4', scripts: { test: 'exit 0' } }, { ...original, version: '1.2.4', dependencies: { unexpected: '*' } }]) {
    s.put('packages/alpha/package.json', manifest)
    assert.equal(await s.invoke(['check']), 1)
    git(s.root, ['add', 'packages/alpha/package.json'])
    assert.ok(evaluate({ root: s.root, data: loadData(s.root), branchName: 'release/alpha', staged: true }).problems.some(p => p.section === 'manifest'))
  }
  s.put('packages/alpha/package.json', { ...original, version: '1.2.4', scripts: { deploy: 'exit 99' } })
  git(s.root, ['add', '.']); git(s.root, ['commit', '-m', 'release: invalid script fixture'])
  assert.equal(await s.invoke(['release', 'alpha', 'minor']), 1)
  s.put('packages/alpha/src/a.js', 'changed source')
  assert.ok(evaluate({ root: s.root, data: loadData(s.root), branchName: 'release/alpha' }).problems.some(p => p.section === 'out-of-scope'))
  const text = JSON.stringify(original)
  for (const change of [{ file: 'packages/new/package.json', before: null, after: text }, { file: 'packages/alpha/package.json', before: text, after: null }]) assert.equal(releaseManifestProblems([change]).length, 1)
})

test('live module catalog excludes off-branch, malformed and other-module tags and counts only module commits', async t => {
  const s = sandbox(t)
  assert.equal(moduleRelease(s.root, s.module).state, 'untagged')
  assert.equal(moduleRelease(s.root, { id: 'virtual' }).state, 'unavailable')
  git(s.root, ['tag', 'alpha@1.2.0']); git(s.root, ['tag', 'alpha@1.10.0']); git(s.root, ['tag', 'alpha@bad']); git(s.root, ['tag', 'beta@99.0.0'])
  git(s.root, ['switch', '-c', 'release/offbranch'])
  s.put('packages/alpha/src/a.js', 'off branch'); git(s.root, ['add', '.']); git(s.root, ['commit', '-m', 'release: fixture']); git(s.root, ['tag', 'alpha@99.0.0'])
  git(s.root, ['switch', 'release/alpha'])
  s.put('unrelated.txt', 'unrelated'); git(s.root, ['add', '.']); git(s.root, ['commit', '-m', 'release: fixture'])
  s.put('packages/alpha/src/a.js', 'module change'); git(s.root, ['add', '.']); git(s.root, ['commit', '-m', 'release: fixture'])
  const release = moduleRelease(s.root, s.module)
  assert.equal(release.latestTag, 'alpha@1.10.0')
  assert.equal(release.commitsSince, 1)
  const live = buildLive({ root: s.root, catalog: { modules: [s.module] }, project: s.project })
  assert.deepEqual(live.modules.alpha.release, release)
  const rendered = toHtml(renderRoute(parseRoute('#/modules/alpha'), { catalog: { modules: [s.module] }, index: indexPlan(s.plan), project: s.project, live }, DEFAULT_UI()))
  assert.match(rendered, /Latest release tag[\s\S]*alpha@1.10.0/)
  assert.match(rendered, /Commits since release[\s\S]*1 commits touching this module/)
})

test('release facts escape untrusted tag text and distinguish unavailable from untagged', () => {
  assert.match(toHtml(releaseFacts(html, null, {})), /Unavailable/)
  assert.match(toHtml(releaseFacts(html, { state: 'untagged' }, {})), /No reachable release tag/)
  const rendered = toHtml(releaseFacts(html, { state: 'tagged', latestTag: '<img onerror=bad>', commit: '<script>', commitsSince: 0 }, { repository: 'javascript:bad' }))
  assert.ok(!rendered.includes('<img') && !rendered.includes('<script>') && !rendered.includes('href='))
})