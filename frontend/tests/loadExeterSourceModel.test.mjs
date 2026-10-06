import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),out=fileURLToPath(f('../node_modules/.cache/gugis-tests/load-exeter-source.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/loadExeterSourceModel.ts')),out);
const {loadExeterSourceModel:load}=await import(pathToFileURL(out).href),report=JSON.parse(await readFile(f('../../shared/exeter-source-fit-v1.json'))),site=report.cases[0],row=site.byte_pairs.find(r=>r.byte_ceiling===8192),e=site.models[row['hybrid-fit']],url=`/research/exeter-source-fit-v1/${site.id}/${e.binary_filename}`,raw=await readFile(f('../public'+url)),sha=b=>createHash('sha256').update(b).digest('hex'),signal=()=>new AbortController().signal;
test('new source loader rejects unrelated paths, invalid sizes and pre-aborted requests before fetching',async()=>{
  const old=globalThis.fetch;try{globalThis.fetch=()=>assert.fail('Invalid request fetched');for(const u of [url+'?extra',url.replace('exeter-centre','exeter-west'),url.replace('fit-','fit-3'),url.replace('exeter-source-fit-v1','source-global-fit-v1'),'https://other.example'+url])await assert.rejects(load(u,raw.length,sha(raw),site.origin_bng,signal()),/回执无效/);for(const bytes of [79,2_000_001,NaN])await assert.rejects(load(url,bytes,sha(raw),site.origin_bng,signal()),/回执无效/);const c=new AbortController();c.abort();await assert.rejects(load(url,raw.length,sha(raw),site.origin_bng,c.signal),{name:'AbortError'});}finally{globalThis.fetch=old;}
});
test('stream overflow, short files, SHA mismatch and wrong origin are rejected; pending readers cancel immediately',async()=>{
  const old=globalThis.fetch;let cancelled=false;
  try{globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(raw);c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}}));await assert.rejects(load(url,raw.length,sha(raw),site.origin_bng,signal()),/超过公开长度/);assert.equal(cancelled,true);
    globalThis.fetch=async()=>new Response(raw.subarray(0,-1));await assert.rejects(load(url,raw.length,sha(raw),site.origin_bng,signal()),/不完整/);globalThis.fetch=async()=>new Response(raw);await assert.rejects(load(url,raw.length,'0'.repeat(64),site.origin_bng,signal()),/SHA-256/);await assert.rejects(load(url,raw.length,sha(raw),[0,0],signal()),/坐标或范围改变/);
    cancelled=false;const controller=new AbortController();globalThis.fetch=async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}));const pending=load(url,raw.length,sha(raw),site.origin_bng,controller.signal);await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,true);
  }finally{globalThis.fetch=old;}
});
test('the actual three new models and both original grids decode with their published lengths, hashes and BNG frames',async()=>{
  const old=globalThis.fetch;
  try{globalThis.fetch=async u=>new Response(await readFile(f('../public'+u)));for(const s of report.cases){const r=s.byte_pairs.find(r=>r.byte_ceiling===8192);for(const m of ['p1-fit','ruled-fit','hybrid-fit']){const e=s.models[r[m]];assert.equal((await load(`/research/exeter-source-fit-v1/${s.id}/${e.binary_filename}`,e.binary_bytes,e.binary_sha256,s.origin_bng,signal())).kind,'surface');}const g=s.regular_grid;assert.equal((await load(`/research/exeter-source-fit-v1/${s.id}/${g.filename}`,g.bytes,g.sha256,s.origin_bng,signal())).kind,'grid');}}finally{globalThis.fetch=old;}
});
