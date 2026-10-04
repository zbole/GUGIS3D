import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {act,create} from 'react-test-renderer';
const source=p=>fileURLToPath(new URL(p,import.meta.url));
const report=JSON.parse(await readFile(source('../../shared/local-triangle-benchmark.json'),'utf8'));
const outfile=source('../node_modules/.cache/gugis-tests/local-triangle-ui.mjs');
await build({entryPoints:[source('../src/compare/LocalTriangleComparison.tsx')],bundle:true,platform:'node',format:'esm',packages:'external',outfile});
const {default:Comparison,localTriangleOutcome}=await import(pathToFileURL(outfile).href);
const text=n=>typeof n==='string'?n:(n.children??[]).map(text).join('');
const digest=b=>createHash('sha256').update(b).digest('hex');

test('all stronger baseline selections show measured signed outcomes, actual topology and resource limits',()=>{
  let renderer;act(()=>{renderer=create(React.createElement(Comparison,{caseId:report.cases[0].id,target:.1}));});
  for(const c of report.cases)for(const p of c.variants){
    act(()=>renderer.update(React.createElement(Comparison,{caseId:c.id,target:p.target_m})));
    const result=text(renderer.root.findByProps({className:'local-triangle-result'}));
    assert.ok(result.includes(localTriangleOutcome(c.id,p.target_m)));
    assert.ok(result.includes((p.local_triangles.bytes/1000).toFixed(2)));
    const faces=text(renderer.root.findByProps({className:'local-triangle-models'}));
    assert.ok(faces.includes(p.local_triangles.triangles.toLocaleString()));
    assert.ok(renderer.root.findAllByType('img').some(i=>i.props.src.endsWith(`${c.id}-local-triangles-${p.target_m}m.png`)));
    assert.match(text(renderer.root),/部分控制点不在原 65 × 65 源网格/);
    assert.match(text(renderer.root),/未运行 ArcGIS Pro/);
    assert.equal(renderer.root.findByType('section').props.className.includes('has-loss'),p.native_file_saving_percent<0);
  }
  assert.match(localTriangleOutcome('convex-bowl',.1),/增加 113.5%/);
  assert.match(localTriangleOutcome('rotating-direction',.1),/增加 16.0%/);
  assert.match(localTriangleOutcome('steep-plane',.1),/一样大/);
  act(()=>renderer.update(React.createElement(Comparison,{caseId:'swiss-dem-crop',target:.1})));
  assert.match(text(renderer.root),/待补齐真实 DEM/);
  assert.equal(renderer.root.findAllByType('img').length,0);
  act(()=>renderer.unmount());
});

test('paired published archives have equal metadata and preserve the original hybrid geometry exactly',async()=>{
  const parentBytes=await readFile(source('../../shared/hybrid-terrain-research.json'));
  assert.equal(digest(parentBytes),report.parent_sha256);
  assert.deepEqual(JSON.parse(await readFile(source('../public/research/hybrid-terrain/local-triangle-results.json'),'utf8')),report);
  const parent=JSON.parse(parentBytes);let count=0;
  for(const c of report.cases)for(const p of c.variants){
    assert.equal(p.comparison_eligible,[p.hybrid,p.local_triangles].every(v=>v.target_met&&v.offgrid.meets_sampled_target));
    assert.ok(Math.abs(p.native_file_saving_percent-100*(1-p.hybrid.bytes/p.local_triangles.bytes))<1e-8);
    const models=[];
    for(const v of [p.hybrid,p.local_triangles]){
      count++;const bytes=await readFile(source(`../public/research/hybrid-terrain/models/${c.id}/${v.filename}`));
      assert.equal(bytes.length,v.bytes);assert.equal(digest(bytes),v.sha256);
      const model=JSON.parse(bytes);models.push(model);
      assert.equal(model.points.length,v.points);assert.equal(model.patches.length,v.patches);
      assert.equal(v.offgrid.samples,4096);assert.equal(v.source_grid.samples,4225);
      assert.ok(v.offgrid.decoded_kernel_max_difference_m<1e-10);
    }
    const [hybrid,local]=models;
    const meta=model=>Object.fromEntries(Object.entries(model).filter(([k])=>!['points','patches'].includes(k)));
    assert.deepEqual(meta(hybrid),meta(local));
    const original=parent.cases.find(v=>v.id===c.id).variants.find(v=>v.target_m===p.target_m).hybrid;
    assert.equal(p.hybrid.origin_archive_sha256,original.sha256);
    const originalModel=JSON.parse(await readFile(source(`../public/research/hybrid-terrain/models/${c.id}/${original.filename}`),'utf8'));
    assert.deepEqual(hybrid.points,originalModel.points);assert.deepEqual(hybrid.patches,originalModel.patches);
    assert.equal(local.patches.reduce((total,p)=>total+p.indices.length-2,0),p.local_triangles.triangles);
    const png=await readFile(source(`../public/research/hybrid-terrain/${c.id}-local-triangles-${p.target_m}m.png`));
    assert.equal(png.subarray(1,4).toString(),'PNG');
  }
  assert.equal(count,48);
});
