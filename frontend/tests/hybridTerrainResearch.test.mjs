import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {create,act} from 'react-test-renderer';
const source=(p)=>fileURLToPath(new URL(p,import.meta.url));
async function bundle(name,path){
  const outfile=source(`../node_modules/.cache/gugis-tests/${name}.mjs`);
  await build({entryPoints:[source(path)],bundle:true,platform:'node',format:'esm',packages:'external',outfile,loader:{'.css':'empty'}});
  return import(pathToFileURL(outfile).href);
}
const {researchTerrainMeshes,shareResearchVertices}=await bundle('research-mesh','../src/compare/researchTerrainMesh.ts');
const {loadResearchTerrain}=await bundle('research-loader','../src/compare/loadResearchTerrain.ts');
const Lab=(await bundle('hybrid-lab','../src/compare/HybridTerrainLab.tsx')).default;
const report=JSON.parse(await readFile(source('../../shared/hybrid-terrain-research.json'),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const text=n=>typeof n==='string'?n:(n.children??[]).map(text).join('');
const modelPath=(c,v)=>source(`../public/research/hybrid-terrain/models/${c}/${v.filename}`);

test('all published models and displayed comparisons match their actual archive receipts',async()=>{
  assert.deepEqual(JSON.parse(await readFile(source('../public/research/hybrid-terrain/results.json'),'utf8')),report);
  let models=0,eligible=0;
  for(const c of report.cases)for(const pair of c.variants){
    const valid=[pair.hybrid,pair.triangles].every(v=>v.target_met&&v.offgrid.meets_sampled_target);
    assert.equal(pair.comparison_eligible,valid);
    if(valid){eligible++;assert.ok(Math.abs(pair.native_file_saving_percent-100*(1-pair.hybrid.bytes/pair.triangles.bytes))<1e-8);}
    else assert.equal(pair.native_file_saving_percent,null);
    for(const v of [pair.hybrid,pair.triangles]){
      models++;const bytes=await readFile(modelPath(c.id,v));assert.equal(bytes.length,v.bytes);assert.equal(hash(bytes),v.sha256);
      const terrain=JSON.parse(bytes);assert.equal(terrain.points.length,v.points);assert.equal(terrain.patches.length,v.patches);
      assert.ok(terrain.patches.every(p=>['ruled-strip','triangle-strip'].includes(p.kind)));
      assert.equal(v.offgrid.samples,4096);assert.ok(v.offgrid.decoded_kernel_max_difference_m<1e-10);
      assert.equal(v.offgrid.meets_sampled_target,v.offgrid.max_absolute_m<=pair.target_m+1e-8);
      const image=await readFile(source(`../public/research/hybrid-terrain/${c.id}-${v.mode}-${pair.target_m}m.png`));
      assert.equal(image.subarray(1,4).toString(),'PNG');
    }
  }
  assert.equal(models,56);assert.equal(eligible,25);
});

test('selectors expose zero advantages and failed targets alongside positive results',()=>{
  let renderer;act(()=>{renderer=create(React.createElement(Lab));});
  for(const c of report.cases){
    act(()=>renderer.root.findByProps({'aria-label':'混合研究地形'}).props.onChange({target:{value:c.id}}));
    for(const p of c.variants){
      act(()=>renderer.root.findByProps({'aria-label':'混合研究误差目标'}).props.onChange({target:{value:String(p.target_m)}}));
      const kpis=text(renderer.root.findByProps({className:'hybrid-kpis'}));
      assert.ok(kpis.includes(p.hybrid.points.toLocaleString()));
      assert.ok(kpis.includes(p.comparison_eligible?'可比较':'暂不可比较'));
      assert.ok(kpis.includes(p.native_file_saving_percent===null?'—':`${Math.abs(p.native_file_saving_percent).toFixed(1)}%`));
      assert.ok(renderer.root.findAllByType('img').some(i=>i.props.src.endsWith(`${c.id}-hybrid-${p.target_m}m.png`)));
    }
  }
  assert.match(text(renderer.root),/不是最佳任意三角网或 ArcGIS 软件结果/);
  assert.match(text(renderer.root),/不是独立实测高程/);
  assert.equal(renderer.root.findAllByProps({'aria-label':'混合地形研究三维视图'}).length,0);
  act(()=>renderer.unmount());
});

test('four native saddle controls render a bounded curved surface without modifying the archive',async()=>{
  const c=report.cases.find(c=>c.id==='bilinear-saddle'),v=c.variants.find(p=>p.target_m===.1).hybrid;
  const terrain=JSON.parse(await readFile(modelPath(c.id,v),'utf8')),before=JSON.stringify(terrain);
  const result=researchTerrainMeshes(terrain,.01);
  assert.equal(terrain.points.length,4);assert.ok(result.vertices>4);assert.ok(result.displayBound<=.01);
  for(const [x,y,z] of result.meshes['ruled-strip'].vertices)assert.ok(Math.abs(z-(20+.004*x*y))<1e-9);
  for(const [a,b,c] of result.meshes['ruled-strip'].triangles){
    const [p,q,r]=[a,b,c].map(i=>result.meshes['ruled-strip'].vertices[i]);
    assert.ok((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])>0);
  }
  assert.equal(JSON.stringify(terrain),before);
  assert.ok(researchTerrainMeshes(terrain,.00001,100).capped);
  assert.throws(()=>researchTerrainMeshes(terrain,.01,3),/预算/);
  const invalid=structuredClone(terrain);invalid.points[0][0]+=.1;
  assert.throws(()=>researchTerrainMeshes(invalid,.01),/平行四边形/);
});

test('display sharing preserves exact oriented faces and never merges nearby coordinates',()=>{
  const mesh={vertices:[[0,0,0],[1,0,0],[0,1,0],[0,0,0],[1,0,0],[1,1,0],[1+1e-12,0,0]],
    triangles:[[0,1,2],[3,5,4],[6,2,0]]};
  const original=JSON.stringify(mesh),shared=shareResearchVertices(mesh);
  assert.equal(shared.vertices.length,5);
  assert.deepEqual(shared.triangles.map(face=>face.map(i=>shared.vertices[i])),mesh.triangles.map(face=>face.map(i=>mesh.vertices[i])));
  assert.equal(JSON.stringify(mesh),original);
});

test('real Swiss display sharing preserves tessellation bounds, budgets and native archive bytes',async()=>{
  const raster=JSON.parse(await readFile(source('../../shared/raster-triangle-benchmark.json'),'utf8'));
  const variant=raster.cases[0].variants.find(v=>v.target_m===.1);
  for(const family of ['hybrid','local_triangles','compact_hybrid']){
    const receipt=variant[family],raw=await readFile(modelPath('swiss-dem-crop',receipt)),terrain=JSON.parse(raw);
    const before=JSON.stringify(terrain),expanded=researchTerrainMeshes(terrain,.05,180000,false),shared=researchTerrainMeshes(terrain,.05);
    assert.ok(shared.vertices<expanded.vertices/2);
    assert.equal(shared.expandedVertices,expanded.vertices);
    assert.equal(shared.displayBound,expanded.displayBound);
    assert.equal(shared.capped,expanded.capped);
    for(const kind of Object.keys(expanded.meshes)){
      const a=expanded.meshes[kind],b=shared.meshes[kind];
      assert.equal(a.triangles.length,b.triangles.length);
      assert.deepEqual(b.triangles.map(face=>face.map(i=>b.vertices[i])),a.triangles.map(face=>face.map(i=>a.vertices[i])));
    }
    assert.equal(JSON.stringify(terrain),before);assert.equal(hash(raw),receipt.sha256);
  }
});

test('research loading checks lengths, hash, cancellation and restricts the local data path',async()=>{
  const c=report.cases[0],v=c.variants[0].hybrid,data=await readFile(modelPath(c.id,v));
  const url=`/research/hybrid-terrain/models/${c.id}/${v.filename}`,signal=new AbortController().signal;
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response(data);
    assert.equal((await loadResearchTerrain(url,data.length,v.sha256,signal)).points.length,v.points);
    await assert.rejects(loadResearchTerrain(url,data.length-1,v.sha256,signal),/超出/);
    await assert.rejects(loadResearchTerrain(url,data.length+1,v.sha256,signal),/不完整/);
    await assert.rejects(loadResearchTerrain(url,data.length,'0'.repeat(64),signal),/修订不匹配/);
    const controller=new AbortController();controller.abort();
    await assert.rejects(loadResearchTerrain(url,data.length,v.sha256,controller.signal),{name:'AbortError'});
    await assert.rejects(loadResearchTerrain(url.replace(c.id,'../secret'),data.length,v.sha256,signal),/receipt/);
  }finally{globalThis.fetch=original;}
});
