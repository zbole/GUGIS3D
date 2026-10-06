import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
const f=p=>new URL(p,import.meta.url),out=fileURLToPath(f('../node_modules/.cache/gugis-tests/ruled-tile-query.mjs'));
await bundleWorkspaceModule(fileURLToPath(f('../src/datasets/ruledTileQuery.ts')),out);const {createRuledTileQuery}=await import(pathToFileURL(out).href);
const report=JSON.parse(await readFile(f('../../shared/ruled-terrain-tiles-v1.json'))),body=await readFile(f('../public/research/ruled-terrain-tiles-v1/reference-grid.f32')),dv=new DataView(body.buffer,body.byteOffset,body.byteLength);
const reference=(e,n)=>{const fx=e-report.bounds_bng[0],fy=n-report.bounds_bng[1],i=Math.min(511,Math.max(0,Math.ceil(fx)-1)),j=Math.min(511,Math.max(0,Math.ceil(fy)-1)),u=fx-i,v=fy-j,z=(i,j)=>dv.getFloat32(4*(j*513+i),true),a=z(i,j),b=z(i+1,j),c=z(i,j+1),d=z(i+1,j+1),mixed=a-b-c+d;return {height:a+(b-a)*u+(c-a)*v+mixed*u*v,gradient:[b-a+mixed*v,c-a+mixed*u]};};
const fetcher=async url=>{const b=await readFile(f('../public'+url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
test('queries load only the hit tile, share original source derivatives at seams and use bounded LRU caching',async()=>{
  const calls=[],manager=createRuledTileQuery(report,{limit:2,fetcher:async(url,signal)=>{calls.push(url);return fetcher(url);}}),[west,south,east,north]=report.bounds_bng;
  for(const [x,y] of [[.27,.41],[64,64],[64.01,64.01],[128.2,128.4],[0,0],[512,512]]){const q=await manager.query(west+x,south+y),ref=reference(west+x,south+y);assert.ok(Math.abs(q.height-ref.height)<1e-8);q.gradient.forEach((v,i)=>assert.ok(Math.abs(v-ref.gradient[i])<1e-8));assert.ok(manager.stats().ready_tiles<=2);}
  assert.equal(calls[0],'/research/ruled-terrain-tiles-v1/tiles/row-00-col-00.bin');assert.equal(calls.length,5);assert.equal(manager.stats().ready_file_bytes,271056);assert.equal(manager.tileFor(west+64,south+64).id,'r0c0');
  const before=calls.length;assert.equal(await manager.query(east+.1,north),null);assert.equal(await manager.query(NaN,south),null);assert.equal(calls.length,before);manager.dispose();assert.equal(manager.stats().ready_tiles,0);await assert.rejects(manager.query(west,south),{name:'AbortError'});
});
test('index snapshots reject hostile layouts before requests and are not changed by caller mutation',async()=>{
  for(const change of [r=>r.tiles[0].filename='../private.bin',r=>r.tiles[1].column=0,r=>r.bounds_bng[2]+=1,r=>r.tiles[0].sha256='x']){const bad=structuredClone(report);change(bad);assert.throws(()=>createRuledTileQuery(bad),/索引无效|布局或回执无效/);}
  const copy=structuredClone(report),manager=createRuledTileQuery(copy,{fetcher});copy.bounds_bng[0]=0;copy.tiles[0].origin_bng[0]=0;assert.ok(await manager.query(report.bounds_bng[0]+.5,report.bounds_bng[1]+.5));manager.dispose();
});
test('aborted or disposed delayed loads never populate ready cache; corruption is retryable',async()=>{
  let release;const pending=new Promise(r=>release=r),controller=new AbortController(),manager=createRuledTileQuery(report,{fetcher:async url=>{await pending;return fetcher(url);}}),[e,n]=report.bounds_bng,q=manager.query(e+.5,n+.5,controller.signal);controller.abort();release();await assert.rejects(q,{name:'AbortError'});assert.equal(manager.stats().ready_tiles,0);manager.dispose();
  let corrupt=true;const retry=createRuledTileQuery(report,{fetcher:async url=>{const b=await fetcher(url);if(corrupt)new Uint8Array(b)[80]^=1;return b;}});
  await assert.rejects(retry.query(e+.5,n+.5),/SHA-256/);assert.equal(retry.stats().ready_tiles,0);corrupt=false;assert.ok(await retry.query(e+.5,n+.5));assert.equal(retry.stats().ready_tiles,1);retry.dispose();
  let done;const waiting=new Promise(r=>done=r),disposed=createRuledTileQuery(report,{fetcher:async url=>{await waiting;return fetcher(url);}}),late=disposed.query(e+.5,n+.5);disposed.dispose();done();await assert.rejects(late,{name:'AbortError'});assert.equal(disposed.stats().ready_tiles,0);
});
