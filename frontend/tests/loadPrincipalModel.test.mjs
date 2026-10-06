import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),out=fileURLToPath(f('../node_modules/.cache/gugis-tests/load-principal-model.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/loadPrincipalModel.ts')),out);const {loadPrincipalModel}=await import(pathToFileURL(out).href);
const report=JSON.parse(await readFile(f('../../shared/principal-ruled-display-v1.json'))),c=report.cases.find(c=>c.angle_degrees===30),e=c.pairs.at(-1).principal,url=`/research/principal-ruled-v1/${c.id}/${e.binary_filename}`,body=await readFile(f(`../public${url}`)),sha=b=>createHash('sha256').update(b).digest('hex');
test('native loader validates complete receipts and shared square before returning a model',async()=>{
  const previous=globalThis.fetch;try{globalThis.fetch=async()=>new Response(body);const m=await loadPrincipalModel(url,e.binary_bytes,e.binary_sha256,new AbortController().signal);assert.equal(m.points.length,e.controls);assert.deepEqual(m.clip_bounds,[-50,-50,50,50]);}finally{globalThis.fetch=previous;}
});
test('untrusted locations and invalid receipt capacity are rejected without network access',async()=>{
  const previous=globalThis.fetch;try{globalThis.fetch=()=>assert.fail('Invalid receipt must not issue request');for(const p of ['https://example.com/model.bin','/api/city/current','/research/principal-ruled-v1/angle-30/../../private.bin'])await assert.rejects(loadPrincipalModel(p,e.binary_bytes,e.binary_sha256,new AbortController().signal),/回执无效/);
    for(const bytes of [NaN,-1,2000001])await assert.rejects(loadPrincipalModel(url,bytes,e.binary_sha256,new AbortController().signal),/回执无效/);
  }finally{globalThis.fetch=previous;}
});
test('truncation, checksum failure, changed clipping, and cancellation never return an invalid native model',async()=>{
  const previous=globalThis.fetch;try{
    globalThis.fetch=async()=>new Response(body.subarray(0,-1));await assert.rejects(loadPrincipalModel(url,e.binary_bytes,e.binary_sha256,new AbortController().signal),/长度不符/);
    globalThis.fetch=async()=>new Response(body);await assert.rejects(loadPrincipalModel(url,e.binary_bytes,'0'.repeat(64),new AbortController().signal),/SHA-256/);
    const changed=Buffer.from(body);changed.writeDoubleLE(-51,16);globalThis.fetch=async()=>new Response(changed);await assert.rejects(loadPrincipalModel(url,changed.length,sha(changed),new AbortController().signal),/覆盖域已改变/);
    const abort=new AbortController();globalThis.fetch=async()=>{abort.abort();return new Response(body);};await assert.rejects(loadPrincipalModel(url,e.binary_bytes,e.binary_sha256,abort.signal),e=>e.name==='AbortError');
  }finally{globalThis.fetch=previous;}
});
