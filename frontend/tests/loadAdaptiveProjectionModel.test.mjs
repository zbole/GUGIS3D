import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
import {decodePrincipalBinary,encodePrincipalBinary} from '../src/compare/principalRuledMath.ts';
const f=p=>new URL(p,import.meta.url),out=fileURLToPath(f('../node_modules/.cache/gugis-tests/load-adaptive-projection.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/compare/loadAdaptiveProjectionModel.ts')),out);
const {loadAdaptiveProjectionModel:load}=await import(pathToFileURL(out).href),url='/research/paper-adaptive-projection-v1/anisotropic-quartic-30/adaptive-pt-2048.bin',raw=await readFile(f('../public'+url)),sha=b=>createHash('sha256').update(b).digest('hex');
test('adaptive loader rejects unbound paths and pre-cancelled requests before fetching',async()=>{
  const old=globalThis.fetch;globalThis.fetch=()=>assert.fail('Invalid request fetched');try{for(const invalid of [url.replace('2048','4096'),url.replace('-30/','-31/'),'https://other.example'+url,url+'?ignored',url.replace('adaptive-pt','pt-paper-p1')])await assert.rejects(load(invalid,raw.length,sha(raw),new AbortController().signal),/回执无效/);const c=new AbortController();c.abort();await assert.rejects(load(url,raw.length,sha(raw),c.signal),/取消/);}finally{globalThis.fetch=old;}
});
test('adaptive loader checks status, complete bytes, hash, unchanged domain and exact face count',async()=>{
  const old=globalThis.fetch;try{globalThis.fetch=async()=>new Response(null,{status:503});await assert.rejects(load(url,raw.length,sha(raw),new AbortController().signal),/503/);globalThis.fetch=async()=>new Response(raw);await assert.rejects(load(url,raw.length+1,sha(raw),new AbortController().signal),/长度/);await assert.rejects(load(url,raw.length,'0'.repeat(64),new AbortController().signal),/SHA-256/);assert.equal((await load(url,raw.length,sha(raw),new AbortController().signal)).patches.length,2048);
    const altered=decodePrincipalBinary(raw);altered.clip_bounds[0]=-49;const b=Buffer.from(encodePrincipalBinary(altered));globalThis.fetch=async()=>new Response(b);await assert.rejects(load(url,b.length,sha(b),new AbortController().signal),/空间或三角形数量/);
  }finally{globalThis.fetch=old;}
});
