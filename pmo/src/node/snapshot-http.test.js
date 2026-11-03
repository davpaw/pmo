import test from 'node:test'
import assert from 'node:assert/strict'
import { createSnapshotMiddleware } from './snapshot-http.js'
test('snapshot endpoint is read-only, validates step and origin, and hides internal errors',async()=>{
 const invoke=async(method,url,origin,read=async()=>({head:'abc'}))=>{
  const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=body}}
  await createSnapshotMiddleware({root:'/fixture',read})({method,url,headers:{host:'localhost:5299',origin}},res,()=>{res.statusCode=404})
  return res
 }
 assert.equal((await invoke('GET','/api/pmo/snapshot?step=1.1.1')).body,'{"head":"abc"}')
 assert.equal((await invoke('POST','/api/pmo/snapshot')).statusCode,405)
 assert.equal((await invoke('GET','/api/pmo/snapshot','https://elsewhere.test')).statusCode,403)
 assert.equal((await invoke('GET','/api/pmo/snapshot?step=../../private')).statusCode,400)
 const failed=await invoke('GET','/api/pmo/snapshot',undefined,async()=>{throw Error('private path')})
 assert.equal(failed.statusCode,503);assert.ok(!failed.body.includes('private path'))
})
