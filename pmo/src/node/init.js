/** Attach portable tooling with fresh project data; never copy the tool product's self-plan or runtime state. */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { git } from './git.js'
import { buildCatalog } from './catalog-build.js'
import { fileDigest } from './upstream.js'
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const COPY = ['src','scripts','docs','templates','index.html','vite.config.js','package.json','AGENTS.md','CONTRIBUTING.md']
const walk = (folder, prefix='') => readdirSync(folder,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(folder,entry.name),`${prefix}${entry.name}/`):[`${prefix}${entry.name}`])
export const sourceRevision = () => {
  for (const path of [join(packageRoot,'package.json'),join(packageRoot,'../package.json')]) {
    try { const p=JSON.parse(readFileSync(path,'utf8'));if (/^[0-9a-f]{40}$/.test(p.gitHead||'')) return p.gitHead } catch { /* Git installs may record provenance on the parent package. */ }
  }
  try { const remote=git(packageRoot,['remote','get-url','origin']); if (/github\.com[:/]davpaw\/pmo(?:\.git)?$/.test(remote)) return git(packageRoot,['rev-parse','HEAD']) } catch { /* Installed package needs a release pin. */ }
  return null
}
export const initHost = async (targetRoot=process.cwd(),{revision=sourceRevision(),today=()=>new Date().toISOString().slice(0,10)}={}) => {
  const dest=join(targetRoot,'pmo')
  if (existsSync(dest)) { console.error(`pmo/ already exists at ${dest}; refusing to overwrite.`);return false }
  if (!git(targetRoot,['rev-parse','--show-toplevel'],{allowFail:true})) { console.error('Initialize the host Git repository before attaching PMO.');return false }
  mkdirSync(dest,{recursive:true})
  for (const name of COPY) if (existsSync(join(packageRoot,name))) cpSync(join(packageRoot,name),join(dest,name),{recursive:true,filter:path=>!path.split(/[\\/]/).some(part=>['node_modules','dist','.data','.runtime','.git'].includes(part))})
  mkdirSync(join(dest,'data'),{recursive:true})
  for (const name of ['plan','modules','project','guardrails']) {
    const data=JSON.parse(readFileSync(join(packageRoot,'templates/host-data',`${name}.json`),'utf8'))
    if (name==='plan') data.updated=today()
    if (name==='project') {
      const remote=git(targetRoot,['remote','get-url','origin'],{allowFail:true})||''
      data.repository=/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote)?.[1]||''
    }
    writeFileSync(join(dest,'data',`${name}.json`),JSON.stringify(data,null,2)+'\n')
  }
  writeFileSync(join(dest,'.gitignore'),'.data/\n.runtime/\nnode_modules/\ndist/\npublic/data/live.json\n.env\n.env.local\n')
  const importedFiles=Object.fromEntries(walk(dest).filter(path=>!path.startsWith('data/')).map(path=>[path,fileDigest(readFileSync(join(dest,path)))]))
  writeFileSync(join(dest,'data/upstream.json'),JSON.stringify({version:1,repository:'davpaw/pmo',mainBranch:'main',packagePath:'pmo',sourcePath:'pmo',revision,importedFiles,contributions:[]},null,2)+'\n')
  writeFileSync(join(dest,'data/catalog.generated.json'),JSON.stringify(await buildCatalog({root:targetRoot}),null,2)+'\n')
  console.log(`Attached PMO tooling at ${dest}; project data is fresh and host-owned.`)
  console.log(revision?`Upstream revision: ${revision}. Verify imports before changing source.`:'Upstream revision unknown. Pin a verified PMO main revision before source changes can pass contribution checks.')
  console.log('Generic changes: contribute to davpaw/pmo, merge there, record content-bound receipts here, then run pmo finish. No recovery bundles are generated.')
  return true
}
