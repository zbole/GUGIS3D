import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
const bundle=fileURLToPath(new URL('../node_modules/.cache/gugis-tests/evidence-totals.mjs',import.meta.url));
await build({entryPoints:[fileURLToPath(new URL('../src/compare/terrainEvidenceTotals.ts',import.meta.url))],outfile:bundle,bundle:true,platform:'node',format:'esm'});
const {terrainEvidenceTotals}=await import(pathToFileURL(bundle).href);
const fixture=(id,bytes,mp,hybridBytes,error,hError,q=0)=>({id,city_id:id,models:[
 {family:'local_triangles',target_m:.1,bytes,e2_m2:error,target_met:true,integrated_area_m2:4096,ruled_quads:0,multipatch:{five_component_bytes:mp,exact_xyz_and_parts:true,files:[{bytes:mp-4},{bytes:1},{bytes:1},{bytes:1},{bytes:1}]}},
 {family:'hybrid',target_m:.1,bytes:hybridBytes,e2_m2:hError,target_met:true,integrated_area_m2:4096,ruled_quads:q}]});
test('cost totals weight actual file bytes and keep precision tradeoffs separate',()=>{
 const report={cases:[fixture('small',100,200,80,2,1,1),fixture('large',900,1000,1000,3,2)]};
 const t=terrainEvidenceTotals([report],.1);
 assert.equal(t.triangleBytes,1000);assert.equal(t.multipatchBytes,1200);
 assert.ok(Math.abs(t.formatSavingPercent-100/6)<1e-12);assert.notEqual(t.formatSavingPercent,30);
 assert.equal(t.mixedDominates,1);assert.equal(t.tradeoffs,1);assert.equal(t.trianglesDominate,0);
 assert.equal(t.withRuled,1);assert.equal(t.ruledQuads,1);assert.equal(t.siteCount,2);
});
test('incomplete, duplicated or unverified evidence cannot enter a headline total',()=>{
 const r={cases:[fixture('one',100,200,90,2,1)]};
 for(const alter of [x=>x.cases[0].models.pop(),x=>x.cases[0].models[0].multipatch.exact_xyz_and_parts=false,x=>x.cases[0].models[0].multipatch.files.pop(),x=>x.cases[0].models[0].multipatch.five_component_bytes++,x=>x.cases[0].models[1].target_met=false,x=>x.cases[0].models[1].e2_m2=NaN,x=>x.cases[0].models[0].integrated_area_m2=1024]){
  const corrupt=structuredClone(r);alter(corrupt);assert.throws(()=>terrainEvidenceTotals([corrupt],.1));
 }
 assert.throws(()=>terrainEvidenceTotals([r,r],.1),/Duplicate/);
 assert.throws(()=>terrainEvidenceTotals([r],.2),/Unsupported/);
 assert.throws(()=>terrainEvidenceTotals([],.1),/No evidence/);
});
test('all saved cross-city reports contribute every fixed site exactly once at all targets',async()=>{
 const reports=[];
 for(const name of ['multicity','oxford','cambridge','liverpool','sheffield','leeds'])reports.push(JSON.parse(await readFile(new URL(`../../shared/${name}-terrain-benchmark.json`,import.meta.url))));
 for(const target of [.1,.25,.5]){
  const t=terrainEvidenceTotals(reports,target);assert.equal(t.siteCount,16);assert.equal(t.cityCount,8);
  const models=reports.flatMap(r=>r.cases.flatMap(c=>c.models.filter(m=>m.target_m===target)));
  const native=models.filter(m=>m.family==='local_triangles'),mp=native.flatMap(m=>m.multipatch.files);
  assert.equal(t.triangleBytes,native.reduce((n,m)=>n+m.bytes,0));assert.equal(t.multipatchBytes,mp.reduce((n,f)=>n+f.bytes,0));
  assert.equal(t.mixedDominates+t.trianglesDominate+t.tradeoffs+t.equal,16);
  assert.equal(t.ruledQuads,models.filter(m=>m.family==='hybrid').reduce((n,m)=>n+m.ruled_quads,0));
 }
});
