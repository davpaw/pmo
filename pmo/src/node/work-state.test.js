import test from 'node:test'
import assert from 'node:assert/strict'
import { finishWork } from './work-state.js'
const HEAD='a'.repeat(40),MERGE='b'.repeat(40)
const plan={workstreams:[{epics:[{steps:[{id:'1.1.2',status:'complete',completedAt:'2026-11-03',evidence:['pmo/package.json']}]}]}]}
const fixture=(changes={})=>({root:process.cwd(),project:{repository:'owner/pmo',remote:'origin',mainBranch:'main'},plan,run:(args)=>args[0]==='status'?changes.dirty?' M file':'' : args[0]==='merge-base'?changes.unmerged?null:'' : args.includes('--abbrev-ref')?'step/1.1.2-work':args.includes('--verify')?changes.unpushed?'c'.repeat(40):HEAD:HEAD,getPullRequests:()=>changes.noPr?[]:[{number:2,url:'https://github.com/owner/pmo/pull/2',headRefOid:HEAD,state:changes.merged?'MERGED':'OPEN',baseRefName:changes.wrongBase?'plan/scope':'main',mergeCommit:{oid:MERGE}}]})
test('finish distinguishes review pending from main delivery and fails dirty, unpushed and PR-less work',()=>{
 assert.equal(finishWork(fixture()).delivery,'awaiting review / merge')
 assert.equal(finishWork(fixture({merged:true})).delivery,'merged on main')
 for(const options of [{dirty:true},{unpushed:true},{noPr:true},{wrongBase:true},{merged:true,unmerged:true}]) assert.equal(finishWork(fixture(options)).ok,false)
})

test('dirty main, unknown and completed step work is surfaced while active parallel owners remain valid',async()=>{
 const {orphanedWork}=await import('./work-state.js')
 const p={workstreams:[{epics:[{steps:[{id:'1.1.1',status:'roadmap'},{id:'1.1.2',status:'complete'}]}]}]}
 const state={worktrees:['main','agents/old','step/9.9.9-unknown','step/1.1.2-done','step/1.1.1-active','plan/scope'].map(branch=>({branch,path:'/fixture',available:true,dirty:true}))}
 assert.deepEqual(orphanedWork(state,p).map(tree=>tree.branch),['main','agents/old','step/9.9.9-unknown','step/1.1.2-done'])
})
