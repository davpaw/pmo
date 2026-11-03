import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { initHost } from './init.js'
import { validatePlan } from '../schema.js'

test('attach copies portable code and fresh host data, pins provenance, and refuses overwrite',async t=>{
 const root=mkdtempSync(join(tmpdir(),'pmo-attach-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 execFileSync('git',['init','-b','main'],{cwd:root,stdio:'ignore'})
 execFileSync('git',['remote','add','origin','https://github.com/owner/host.git'],{cwd:root})
 assert.equal(await initHost(root,{revision:'a'.repeat(40),today:()=> '2026-11-03'}),true)
 const read=name=>JSON.parse(readFileSync(join(root,'pmo/data',name+'.json'),'utf8'))
 assert.equal(read('project').repository,'owner/host')
 assert.equal(read('plan').workstreams[0].epics[0].steps.length,1)
 assert.deepEqual(validatePlan(read('plan')),[])
 const provenance=read('upstream');assert.equal(provenance.repository,'davpaw/pmo');assert.ok(provenance.importedFiles['src/cli.js'])
 assert.equal(existsSync(join(root,'pmo/public/data/live.json')),false)
 assert.equal(existsSync(join(root,'pmo/data/recovery')),false)
 assert.equal(await initHost(root),false)
})
test('published archive allowlist excludes source project data, caches and private configuration',()=>{
 const rows=JSON.parse(execFileSync('npm',['pack','--dry-run','--json','--ignore-scripts','--cache','/tmp/pmo-upstream-npm-cache'],{encoding:'utf8'}))
 const files=rows[0].files.map(row=>row.path)
 assert.ok(files.includes('pmo/src/cli.js'))
 assert.ok(files.includes('pmo/templates/host-data/plan.json'))
 assert.equal(files.some(path=>/^pmo\/(?:data|public|\.data|\.runtime)\//.test(path)||/(?:^|\/)\.env(?:\.|$)/.test(path)),false)
})
