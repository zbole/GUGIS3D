import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),out=fileURLToPath(f('../node_modules/.cache/gugis-tests/load-source-model.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/loadSourceModel.ts')),out);const {loadSourceModel}=await import(pathToFileURL(out).href);
const report=JSON.parse(await readFile(f('../../shared/source-native-bands-v1.json'))),c=report.cases[0],e=c.models[0],url=`/research/source-native-bands-v1/${c.id}/${e.binary_filename}`,body=await readFile(f(`../public${url}`)),sha=b=>createHash('sha256').update(b).digest('hex');
test('loader accepts full checksum-bound georeferenced models and original Float32 grid',async()=>{
  const previous=globalThis.fetch;try{globalThis.fetch=async url=>new Response(await readFile(f(`../public${url}`)));for(const e of c.models){const r=await loadSourceModel(`/research/source-native-bands-v1/${c.id}/${e.binary_filename}`,e.binary_bytes,e.binary_sha256,c.origin_bng,new AbortController().signal);assert.equal(r.kind,'surface');assert.deepEqual(r.model.origin_bng,c.origin_bng);assert.equal(r.model.points.length,e.controls);}
    const g=c.regular_grid,r=await loadSourceModel(`/research/source-native-bands-v1/${c.id}/${g.filename}`,g.bytes,g.sha256,c.origin_bng,new AbortController().signal);assert.equal(r.kind,'grid');assert.equal(r.model.values.length,4225);
  }finally{globalThis.fetch=previous;}
});
test('invalid paths and receipts reject before issuing requests',async()=>{
  const previous=globalThis.fetch;try{globalThis.fetch=()=>assert.fail('Invalid descriptor must not fetch');for(const path of ['https://example.com/ruled.bin','/api/city/current','/research/source-native-bands-v1/manchester-centre/../../ruled.bin'])await assert.rejects(loadSourceModel(path,e.binary_bytes,e.binary_sha256,c.origin_bng,new AbortController().signal),/回执无效/);
    for(const bytes of [NaN,-1,2000001])await assert.rejects(loadSourceModel(url,bytes,e.binary_sha256,c.origin_bng,new AbortController().signal),/回执无效/);
  }finally{globalThis.fetch=previous;}
});
test('length, hash, valid-hash wrong origins and wrong family files cannot enter the query demo',async()=>{
  const previous=globalThis.fetch;try{
    globalThis.fetch=async()=>new Response(body.subarray(1));await assert.rejects(loadSourceModel(url,e.binary_bytes,e.binary_sha256,c.origin_bng,new AbortController().signal),/长度不符/);
    const wrong=Buffer.from(body);wrong[80]^=1;globalThis.fetch=async()=>new Response(wrong);await assert.rejects(loadSourceModel(url,e.binary_bytes,e.binary_sha256,c.origin_bng,new AbortController().signal),/SHA-256/);
    globalThis.fetch=async()=>new Response(body);await assert.rejects(loadSourceModel(url,e.binary_bytes,e.binary_sha256,[...c.origin_bng].map(v=>v+1),new AbortController().signal),/坐标或覆盖域/);
    const p1=c.models[1],b=await readFile(f(`../public/research/source-native-bands-v1/${c.id}/${p1.binary_filename}`));globalThis.fetch=async()=>new Response(b);await assert.rejects(loadSourceModel(url,b.length,sha(b),c.origin_bng,new AbortController().signal),/函数类型/);
    const controller=new AbortController();controller.abort();globalThis.fetch=async()=>new Response(body);await assert.rejects(loadSourceModel(url,e.binary_bytes,e.binary_sha256,c.origin_bng,controller.signal),{name:'AbortError'});
  }finally{globalThis.fetch=previous;}
});
