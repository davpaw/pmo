import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { checkUpstream, fileDigest } from './upstream.js'
const SHA='a'.repeat(40)
const setup = t => {
  const root=mkdtempSync(join(tmpdir(),'pmo-upstream-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
  const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe',encoding:'utf8'}).trim()
  git('init','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.test')
  mkdirSync(join(root,'pmo/src'),{recursive:true});writeFileSync(join(root,'pmo/src/tool.js'),'old');git('add','.');git('commit','-m','base');git('switch','-c','step/1.1.1-work')
  writeFileSync(join(root,'pmo/src/tool.js'),'new')
  const config={version:1,repository:'owner/pmo',packagePath:'pmo',sourcePath:'pmo',revision:SHA,contributions:[]}
  const plan={workstreams:[{epics:[{steps:[{id:'1.1.1',scope:{}}]}]}]}
  return {root,config,base:'main',basePlan:plan,changed:['pmo/src/tool.js'],branch:'step/1.1.1-work',plan}
}
test('changed generic source requires a receipt for its exact bytes and a real merged upstream source path',t=>{
  const o=setup(t)
  assert.match(checkUpstream(o).errors.join(),/no content-bound/)
  o.config.contributions=[{kind:'generic',files:[{path:'src/tool.js',sha256:fileDigest('new'),upstreamPath:'pmo/src/tool.js'}],upstream:{repository:'owner/pmo',pullRequest:2,commit:SHA}}]
  const remote={state:'MERGED',baseRefName:'main',mergeCommit:{oid:SHA},files:[{path:'pmo/src/tool.js'}]}
  assert.equal(checkUpstream({...o,verifyRemote:true,getPullRequest:()=>remote}).ok,true)
  for(const pr of [{...remote,state:'OPEN'},{...remote,baseRefName:'plan/scope'},{...remote,files:[]},{...remote,mergeCommit:{oid:'b'.repeat(40)}}]) assert.equal(checkUpstream({...o,verifyRemote:true,getPullRequest:()=>pr}).ok,false)
  writeFileSync(join(o.root,'pmo/src/tool.js'),'newer')
  assert.equal(checkUpstream(o).ok,false,'a stale receipt cannot cover a later edit')
})
test('host-only classifications require an exception in the approved base plan and project data stays out',t=>{
 const o=setup(t);o.config.contributions=[{kind:'host-specific',reason:'Project-owned catalog adapter wiring only.',files:[{path:'src/tool.js',sha256:fileDigest('new')}]}]
 assert.equal(checkUpstream(o).ok,false)
 o.plan.workstreams[0].epics[0].steps[0].scope.upstreamExceptions=[{path:'src/tool.js',reason:'Project-owned catalog adapter wiring only.'}]
 assert.equal(checkUpstream(o).ok,true)
 assert.equal(checkUpstream({...o,changed:['pmo/data/plan.json','pmo/data/recovery/old.bundle','pmo/public/data/live.json']}).checked.length,0)
})
test('first import requires byte-identical content and an upstream revision reachable from main',t=>{
 const o=setup(t);o.config.importedFiles={'src/tool.js':fileDigest('new')}
 assert.equal(checkUpstream({...o,verifyRemote:true,verifyRevision:()=>true,getSourceFile:()=>Buffer.from('new')}).ok,true)
 assert.equal(checkUpstream({...o,verifyRemote:true,verifyRevision:()=>false,getSourceFile:()=>Buffer.from('new')}).ok,false)
 assert.equal(checkUpstream({...o,verifyRemote:true,verifyRevision:()=>true,getSourceFile:()=>Buffer.from('other')}).ok,false)
})
