import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
import {restoreCompactPrincipal} from '../src/compare/compactPrincipalBinary.ts';
import {decodePrincipalBinary,encodePrincipalBinary} from '../src/compare/principalRuledMath.ts';
const f=p=>new URL(p,import.meta.url),out=fileURLToPath(f('../node_modules/.cache/gugis-tests/load-compact-projection.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/loadCompactProjectionModel.ts')),out);
const {loadCompactProjectionModel:load}=await import(pathToFileURL(out).href);
const report=JSON.parse(await readFile(f('../../shared/paper-coordinate-sharing-display-v1.json'))),site=report.cases.find(c=>c.id===report.defaults.default_case),row=site.error_rows.find(r=>r.target_e2_m2===.1);
const sha=b=>createHash('sha256').update(b).digest('hex');
const entry=site.models[row.selected.fitted],url=`/research/paper-coordinate-sharing-v1/native/${site.id}/${entry.binary_filename}`,raw=await readFile(f('../public'+url)),signal=()=>new AbortController().signal;

test('compact loader binds local paths, bounded lengths and both hashes before fetching',async()=>{
  const old=globalThis.fetch;globalThis.fetch=()=>assert.fail('Invalid request fetched');
  try{
    for(const invalid of [url+'?extra',url.replace('-30/','-31/'),url.replace('native/',''),url.replace('fitted--','other--'),'https://other.example'+url])await assert.rejects(load(invalid,raw.length,sha(raw),entry.original.binary_sha256,signal()),/回执无效/);
    for(const bytes of [63,2_000_001,NaN,64.5])await assert.rejects(load(url,bytes,sha(raw),entry.original.binary_sha256,signal()),/回执无效/);
    await assert.rejects(load(url,raw.length,sha(raw),'0',signal()),/回执无效/);
    const controller=new AbortController();controller.abort();await assert.rejects(load(url,raw.length,sha(raw),entry.original.binary_sha256,controller.signal),{name:'AbortError'});
  }finally{globalThis.fetch=old;}
});

test('compact loader rejects overflow, incomplete files, corruption and a forged restoration receipt; a later retry succeeds',async()=>{
  const old=globalThis.fetch;let cancelled=false;
  try{
    globalThis.fetch=async()=>new Response(null,{status:503});await assert.rejects(load(url,raw.length,sha(raw),entry.original.binary_sha256,signal()),/503/);
    globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(raw);c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}}));await assert.rejects(load(url,raw.length,sha(raw),entry.original.binary_sha256,signal()),/超过公开长度/);assert.equal(cancelled,true);
    globalThis.fetch=async()=>new Response(raw.subarray(0,-1));await assert.rejects(load(url,raw.length,sha(raw),entry.original.binary_sha256,signal()),/不完整/);
    const broken=Buffer.from(raw);broken[100]^=1;globalThis.fetch=async()=>new Response(broken);await assert.rejects(load(url,raw.length,sha(raw),entry.original.binary_sha256,signal()),/SHA-256/);
    globalThis.fetch=async()=>new Response(raw);await assert.rejects(load(url,raw.length,sha(raw),'0'.repeat(64),signal()),/原始模型 SHA-256/);
    const controller=new AbortController();globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(raw.subarray(0,100));controller.abort();}}));await assert.rejects(load(url,raw.length,sha(raw),entry.original.binary_sha256,controller.signal),{name:'AbortError'});
    globalThis.fetch=async()=>new Response(raw);assert.deepEqual(await load(url,raw.length,sha(raw),entry.original.binary_sha256,signal()),decodePrincipalBinary(restoreCompactPrincipal(raw)));
  }finally{globalThis.fetch=old;}
});

test('all three displayed native models restore the exact archived file, including independent PT heights',async()=>{
  const old=globalThis.fetch;const fetched=[];
  try{
    globalThis.fetch=async url=>{fetched.push(url);return new Response(await readFile(f('../public'+url)));};
    for(const method of ['adaptive_pt','fitted','p2']){
      const e=site.models[row.selected[method]],u=`/research/paper-coordinate-sharing-v1/native/${site.id}/${e.binary_filename}`,model=await load(u,e.binary_bytes,e.binary_sha256,e.original.binary_sha256,signal());
      assert.equal(sha(Buffer.from(encodePrincipalBinary(model))),e.original.binary_sha256);
    }
    assert.equal(fetched.length,3);assert.ok(fetched.every(u=>u.includes('/native/')));
  }finally{globalThis.fetch=old;}
});
