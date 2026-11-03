import test from 'node:test'
import assert from 'node:assert/strict'
import { importSpecifiers } from './import-specifiers.js'
test('nested template expressions and computed imports cannot hide dependency changes',()=>{
 assert.ok(importSpecifiers('export const load = path => import(path)').includes(null))
 assert.ok(importSpecifiers('const x = `text ${import("../other/index.js")}`').includes('../other/index.js'))
 assert.ok(importSpecifiers('const x = `text ${import(path)}`').includes(null))
 assert.deepEqual(importSpecifiers('// import("fake")\nconst s = "import(another)"'),[])
})
