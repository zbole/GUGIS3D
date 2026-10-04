import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const file=p=>new URL(p,import.meta.url),hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await readFile(file('../../shared/bristol-viewer-models.json')));
const pending=[];let mounts=0,unmounts=0;
globalThis.__bristolViewerHarness={load:(...args)=>new Promise((resolve,reject)=>pending.push({args,resolve,reject})),mount:()=>mounts++,unmount:()=>unmounts++};
const outfile=fileURLToPath(file('../node_modules/.cache/gugis-tests/bristol-viewer-ui.mjs'));
await build({entryPoints:[fileURLToPath(file('../src/compare/BristolTerrainViewer.tsx'))],outfile,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},plugins:[{name:'mock-scene-and-loader',setup(b){
  b.onResolve({filter:/\/studio\/CityScene$/},()=>({path:'scene',namespace:'harness'}));
  b.onResolve({filter:/^\.\/loadResearchTerrain$/},()=>({path:'loader',namespace:'harness'}));
  b.onResolve({filter:/^react$/,namespace:'harness'},()=>({path:'react',external:true}));
  b.onLoad({filter:/.*/,namespace:'harness'},({path})=>({loader:'js',contents:path==='loader'?'export const loadBristolResearchTerrain=(...args)=>globalThis.__bristolViewerHarness.load(...args);':`import React,{useEffect,forwardRef} from 'react'; export default forwardRef((props,ref)=>{useEffect(()=>{globalThis.__bristolViewerHarness.mount();return()=>globalThis.__bristolViewerHarness.unmount();},[]);return React.createElement('mock-scene',props);});`}));
}}]});
const Viewer=(await import(pathToFileURL(outfile).href)).default;
const loaderfile=fileURLToPath(file('../node_modules/.cache/gugis-tests/bristol-viewer-loader.mjs'));
await build({entryPoints:[fileURLToPath(file('../src/compare/loadResearchTerrain.ts'))],outfile:loaderfile,bundle:true,platform:'node',format:'esm',packages:'external'});
const {loadBristolResearchTerrain}=await import(pathToFileURL(loaderfile).href);
const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
const terrainFor=async request=>JSON.parse(await readFile(file('../public'+request.args[0])));

test('all 18 published Bristol viewer models bind to their original certified report and native coordinates',async()=>{
  assert.deepEqual(JSON.parse(await readFile(file('../public/research/bristol-viewer/models.json'))),manifest);
  assert.equal(manifest.models.length,18);
  assert.equal(manifest.publisher_sha256,hash((await readFile(file('../../data-pipeline/publish_bristol_viewer_models.py'),'utf8')).replace(/\r\n/g,'\n')));
  const reports={};for(const [name,sha] of Object.entries(manifest.parents)){const bytes=await readFile(file('../../shared/'+name));assert.equal(hash(bytes),sha);reports[name]=JSON.parse(bytes);}
  for(const m of manifest.models){
    const bytes=await readFile(file(`../public/research/bristol-viewer/models/${m.case_id}/${m.filename}`));
    assert.equal(bytes.length,m.bytes);assert.equal(hash(bytes),m.sha256);
    const terrain=JSON.parse(bytes);assert.equal(terrain.points.length,m.points);assert.equal(terrain.demonstration,false);assert.equal(terrain.vertical_datum,'ODN');
    assert.ok(terrain.patches.every(p=>['ruled-strip','triangle-strip'].includes(p.kind)));
    const report=reports[m.family==='local_compact'?'bristol-local-partition.json':'bristol-certified-terrain.json'];
    const data=report.cases.find(c=>c.id===m.case_id),pair=data.variants.find(p=>p.target_m===m.target_m);
    const model=pair[{local_compact:'compact_local_hybrid',global_compact:'compact_hybrid',local_triangles:'local_triangles'}[m.family]];
    assert.equal(model.sha256,m.sha256);assert.equal(model.continuous_bound_m,m.continuous_bound_m);assert.equal(data.download.sha256,m.source_package_sha256);
  }
});

test('Bristol bounded loader rejects mismatched, oversized, cancelled and foreign archives',async()=>{
  const m=manifest.models[0],url=`/research/bristol-viewer/models/${m.case_id}/${m.filename}`;
  const bytes=await readFile(file('../public'+url)),original=globalThis.fetch,signal=new AbortController().signal;
  try{
    globalThis.fetch=async()=>new Response(bytes);
    assert.equal((await loadBristolResearchTerrain(url,m.bytes,m.sha256,signal)).points.length,m.points);
    await assert.rejects(loadBristolResearchTerrain(url,m.bytes-1,m.sha256,signal),/超出/);
    await assert.rejects(loadBristolResearchTerrain(url,m.bytes+1,m.sha256,signal),/不完整/);
    await assert.rejects(loadBristolResearchTerrain(url,m.bytes,'0'.repeat(64),signal),/修订不匹配/);
    const c=new AbortController();c.abort();await assert.rejects(loadBristolResearchTerrain(url,m.bytes,m.sha256,c.signal),{name:'AbortError'});
    for(const bad of [url.replace('bristol-harbour','../secret'),url.replace('0.1m','0.05m'),'https://example.com'+url])await assert.rejects(loadBristolResearchTerrain(bad,m.bytes,m.sha256,signal),/receipt/);
    await assert.rejects(loadBristolResearchTerrain(url,1024*1024+1,m.sha256,signal),/receipt/);
  }finally{globalThis.fetch=original;}
});

test('viewer keeps one scene and identifies the last validated model while stale loads, failures and retries cannot return wrong queries',async()=>{
  let r;act(()=>r=create(React.createElement(Viewer,{target:.1})));
  const first=pending.shift(),terrain=await terrainFor(first),before=JSON.stringify(terrain);
  await act(async()=>first.resolve(terrain));
  const scene=()=>r.root.findByType('mock-scene');
  assert.equal(mounts,1);assert.equal(scene().props.queryTerrain,true);
  assert.equal(scene().props.city.environment.terrain.longitude,0);assert.deepEqual(scene().props.city.environment.terrain.points,terrain.points);
  assert.equal(JSON.stringify(terrain),before);assert.equal(scene().props.city.instances.length,0);
  act(()=>r.root.findByProps({'aria-label':'Bristol 三维研究表示'}).props.onChange({target:{value:'global_compact'}}));
  const stale=pending.shift();assert.equal(scene().props.queryTerrain,false);
  assert.match(text(r.toJSON()),/当前显示：布里斯托港区 · 新局部紧凑混合/);
  act(()=>r.root.findByProps({'aria-label':'Bristol 三维研究样区'}).props.onChange({target:{value:'bristol-brandon-hill'}}));
  const latest=pending.shift();assert.equal(stale.args[3].aborted,true);
  await act(async()=>stale.resolve(await terrainFor(stale)));assert.equal(scene().props.queryTerrain,false);
  await act(async()=>latest.reject(new Error('断网')));assert.match(text(r.toJSON()),/不会冒充新结果/);
  act(()=>r.root.findAllByType('button').find(b=>text(b)==='重试 Bristol 三维模型').props.onClick());
  const retry=pending.shift();await act(async()=>retry.resolve(await terrainFor(retry)));
  assert.equal(scene().props.queryTerrain,true);assert.match(text(r.toJSON()),/当前显示：布兰登山坡 · 原全局紧凑混合/);
  assert.equal(mounts,1);assert.equal(unmounts,0);
  act(()=>scene().props.onTerrainQuery({kind:'ruled-strip',patch:'test-patch',x:2,y:3,height:17,slope:10,aspect:180,u:.2,v:.3}));
  assert.match(text(r.toJSON()),/ODN 高程 17.0000/);
  act(()=>scene().props.onRetry());assert.equal(mounts,2);assert.equal(unmounts,1);assert.doesNotMatch(text(r.toJSON()),/ODN 高程 17.0000/);
  act(()=>r.update(React.createElement(Viewer,{target:.05})));assert.equal(scene().props.queryTerrain,false);assert.match(text(r.toJSON()),/不能借用其他档位/);
  act(()=>r.unmount());
});
